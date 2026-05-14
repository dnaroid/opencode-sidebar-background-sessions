/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Part, Session } from "@opencode-ai/sdk/v2";
import { BoxRenderable, TextAttributes, TextRenderable } from "@opentui/core";
import { onCleanup } from "solid-js";

const id = "opencode-sidebar-background-sessions";
const recentSessionsPageSize = 20;

type TaskItem = {
	sessionID?: string;
	title: string;
	subagent?: string;
};

type RecentSessionItem = Pick<Session, "id" | "title" | "agent" | "time">;

function displayTitle(title: string) {
	return title
		.replace(/^Background: /, "")
		.replace(/^Task: /, "")
		.replace(/ \(@.* subagent\)$/, "")
		.replace(/^...: /, "");
}

function partMetadataString(part: Part, key: string) {
	if (part.type !== "tool") return;
	if (part.state.status === "pending") return;
	if (!part.state.metadata) return;
	if (typeof part.state.metadata[key] !== "string") return;
	return part.state.metadata[key];
}

function partInputString(part: Part, key: string) {
	if (part.type !== "tool") return;
	if (typeof part.state.input[key] !== "string") return;
	return part.state.input[key];
}

function taskMetaLine(item: TaskItem) {
	return item.subagent ?? "";
}

function taskItem(
	part: Part,
	completedBackgroundTaskIDs: Set<string>,
	isSessionIdle: (sessionID: string) => boolean,
): TaskItem | undefined {
	if (part.type !== "tool") return;
	if (part.tool !== "task") return;
	const sessionID = partMetadataString(part, "sessionId");
	if (sessionID && isSessionIdle(sessionID)) return;

	if (part.state.status === "completed") {
		const backgroundTaskID = partMetadataString(part, "backgroundTaskId");
		if (backgroundTaskID && completedBackgroundTaskIDs.has(backgroundTaskID))
			return;
	}

	if (
		part.state.status !== "pending" &&
		part.state.status !== "running" &&
		part.state.status !== "completed"
	)
		return;

	const title =
		partInputString(part, "description") ??
		partInputString(part, "prompt") ??
		sessionID;
	if (!title) return;

	return {
		sessionID,
		title,
		subagent: partInputString(part, "subagent_type"),
	};
}

function View(props: { api: TuiPluginApi; session_id: string }) {
	const theme = () => props.api.theme.current;
	let container: BoxRenderable | undefined;
	let recentSessionsCollapsed = true;
	let recentSessionsPage = 0;
	let recentSessionsHasNext = false;
	let recentSessionsLoading = false;
	let recentSessionsError = "";
	let recentSessions: RecentSessionItem[] = [];
	let recentSessionsRequest = 0;
	let renderScheduled = false;

	const parts = () =>
		props.api.state.session
			.messages(props.session_id)
			.flatMap((message) => props.api.state.part(message.id));
	const list = () => {
		const currentParts = parts();
		const completedBackgroundTaskIDs = new Set(
			currentParts
				.filter(
					(part) =>
						part.type === "tool" &&
						part.tool === "background_output" &&
						part.state.status !== "running",
				)
				.map((part) => partMetadataString(part, "backgroundTaskId"))
				.filter((backgroundTaskID) => backgroundTaskID !== undefined),
		);
		return currentParts
			.map((part) =>
				taskItem(
					part,
					completedBackgroundTaskIDs,
					(sessionID) =>
						props.api.state.session.status(sessionID)?.type === "idle",
				),
			)
			.filter((item): item is TaskItem => item !== undefined)
			.reverse();
	};
	const clearContainer = () => {
		if (!container) return;
		for (const child of [...container.getChildren()]) {
			container.remove(child.id);
			child.destroyRecursively();
		}
	};
	const openSubagentSession = (item: TaskItem) => {
		if (!item.sessionID) return;
		props.api.route.navigate("session", { sessionID: item.sessionID });
	};
	const openRecentSession = (session: RecentSessionItem) => {
		if (session.id === props.session_id) return;
		props.api.route.navigate("session", { sessionID: session.id });
	};
	const refreshRecentSessions = async () => {
		const request = ++recentSessionsRequest;
		recentSessionsLoading = true;
		recentSessionsError = "";
		renderSidebar();

		const response = await props.api.client.session.list({
			limit: recentSessionsPageSize + 1,
			scope: "project",
			start: recentSessionsPage * recentSessionsPageSize,
		});
		if (request !== recentSessionsRequest) return;

		recentSessionsLoading = false;
		if (response.error) {
			recentSessionsError = "Unable to load sessions";
			renderSidebar();
			return;
		}

		const sessions = response.data ?? [];
		recentSessions = sessions.slice(0, recentSessionsPageSize);
		recentSessionsHasNext = sessions.length > recentSessionsPageSize;
		renderSidebar();
	};
	const goToRecentSessionsPage = (page: number) => {
		recentSessionsPage = page;
		queueMicrotask(() => {
			void refreshRecentSessions();
		});
	};
	const renderSidebar = () => {
		if (!container) return;
		renderScheduled = false;
		clearContainer();

		const items = list();
		const ctx = container.ctx;
		const currentTheme = theme();

		if (items.length > 0) {
			const header = new BoxRenderable(ctx, {
				flexDirection: "row",
				gap: 1,
			});
			header.add(
				new TextRenderable(ctx, {
					content: "Running Agents",
					fg: currentTheme.text,
					attributes: TextAttributes.BOLD,
				}),
			);
			container.add(header);
		}

		for (const item of items) {
			const row = new BoxRenderable(ctx, {
				id: item.sessionID ? `${id}-row-${item.sessionID}` : undefined,
				flexDirection: "row",
				gap: 1,
				onMouseDown: item.sessionID
					? () => openSubagentSession(item)
					: undefined,
			});
			row.add(
				new TextRenderable(ctx, {
					content: "•",
					fg: currentTheme.success,
				}),
			);

			const textColumn = new BoxRenderable(ctx, {
				flexDirection: "column",
				flexGrow: 1,
				flexShrink: 1,
			});
			textColumn.add(
				new TextRenderable(ctx, {
					content: displayTitle(item.title),
					fg: currentTheme.warning,
					wrapMode: "word",
				}),
			);

			const metaLine = taskMetaLine(item);
			if (metaLine) {
				textColumn.add(
					new TextRenderable(ctx, {
						content: metaLine,
						fg: currentTheme.textMuted,
						wrapMode: "none",
					}),
				);
			}

			row.add(textColumn);
			container.add(row);
		}

		const recentHeader = new BoxRenderable(ctx, {
			id: `${id}-recent-sessions-header`,
			flexDirection: "row",
			gap: 1,
			onMouseDown: () => {
				recentSessionsCollapsed = !recentSessionsCollapsed;
				scheduleRenderSidebar();
			},
		});
		recentHeader.add(
			new TextRenderable(ctx, {
				content: recentSessionsCollapsed ? "▶" : "▼",
				fg: currentTheme.text,
			}),
		);
		recentHeader.add(
			new TextRenderable(ctx, {
				content: "Sessions",
				fg: currentTheme.text,
				attributes: TextAttributes.BOLD,
			}),
		);
		container.add(recentHeader);

		if (!recentSessionsCollapsed) {
			if (recentSessionsError) {
				const row = new BoxRenderable(ctx, {
					flexDirection: "row",
					gap: 1,
				});
				row.add(
					new TextRenderable(ctx, { content: "•", fg: currentTheme.error }),
				);
				row.add(
					new TextRenderable(ctx, {
						content: recentSessionsError,
						fg: currentTheme.error,
						wrapMode: "word",
					}),
				);
				container.add(row);
			} else if (recentSessionsLoading && recentSessions.length === 0) {
				const row = new BoxRenderable(ctx, {
					flexDirection: "row",
					gap: 1,
				});
				row.add(
					new TextRenderable(ctx, { content: "•", fg: currentTheme.success }),
				);
				row.add(
					new TextRenderable(ctx, {
						content: "loading sessions...",
						fg: currentTheme.textMuted,
					}),
				);
				container.add(row);
			} else if (recentSessions.length === 0) {
				const row = new BoxRenderable(ctx, {
					flexDirection: "row",
					gap: 1,
				});
				row.add(
					new TextRenderable(ctx, { content: "•", fg: currentTheme.textMuted }),
				);
				row.add(
					new TextRenderable(ctx, {
						content: "no recent sessions",
						fg: currentTheme.textMuted,
					}),
				);
				container.add(row);
			} else {
				for (const session of recentSessions) {
					const current = session.id === props.session_id;
					const row = new BoxRenderable(ctx, {
						id: `${id}-recent-row-${session.id}`,
						flexDirection: "row",
						gap: 1,
						onMouseDown: current ? undefined : () => openRecentSession(session),
					});
					row.add(
						new TextRenderable(ctx, {
							content: "•",
							fg: current ? currentTheme.text : currentTheme.success,
						}),
					);

					row.add(
						new TextRenderable(ctx, {
							content: displayTitle(session.title),
							fg: current ? currentTheme.text : currentTheme.textMuted,
							attributes: current ? TextAttributes.BOLD : undefined,
							wrapMode: "word",
						}),
					);
					container.add(row);
				}
			}

			if (recentSessionsPage > 0 || recentSessionsHasNext) {
				const pagination = new BoxRenderable(ctx, {
					flexDirection: "row",
					gap: 1,
				});

				const previous = new BoxRenderable(ctx, {
					onMouseDown:
						recentSessionsPage > 0
							? () => goToRecentSessionsPage(recentSessionsPage - 1)
							: undefined,
				});
				previous.add(
					new TextRenderable(ctx, {
						content: "‹ Prev",
						fg:
							recentSessionsPage > 0
								? currentTheme.text
								: currentTheme.textMuted,
					}),
				);
				pagination.add(previous);

				pagination.add(
					new TextRenderable(ctx, {
						content: `Page ${recentSessionsPage + 1}`,
						fg: currentTheme.textMuted,
					}),
				);

				const next = new BoxRenderable(ctx, {
					onMouseDown: recentSessionsHasNext
						? () => goToRecentSessionsPage(recentSessionsPage + 1)
						: undefined,
				});
				next.add(
					new TextRenderable(ctx, {
						content: "Next ›",
						fg: recentSessionsHasNext
							? currentTheme.text
							: currentTheme.textMuted,
					}),
				);
				pagination.add(next);

				container.add(pagination);
			}
		}

		container.requestRender();
		props.api.renderer.requestRender();
	};
	const scheduleRenderSidebar = () => {
		if (renderScheduled) return;
		renderScheduled = true;
		queueMicrotask(renderSidebar);
	};
	const refreshSidebar = () => renderSidebar();
	const refreshSessions = () => {
		void refreshRecentSessions();
	};

	onCleanup(props.api.event.on("message.updated", refreshSidebar));
	onCleanup(props.api.event.on("message.removed", refreshSidebar));
	onCleanup(props.api.event.on("message.part.updated", refreshSidebar));
	onCleanup(props.api.event.on("message.part.removed", refreshSidebar));
	onCleanup(props.api.event.on("session.updated", refreshSessions));
	onCleanup(props.api.event.on("session.status", refreshSidebar));
	onCleanup(props.api.event.on("session.idle", refreshSessions));

	return (
		<box
			ref={(ref) => {
				container = ref;
				renderSidebar();
				void refreshRecentSessions();
			}}
		/>
	);
}

const tui: TuiPlugin = async (api) => {
	api.slots.register({
		order: 50,
		slots: {
			sidebar_content(_ctx, props) {
				return <View api={api} session_id={props.session_id} />;
			},
		},
	});
};

export default {
	id,
	tui,
};
