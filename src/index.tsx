/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Part, Session } from "@opencode-ai/sdk/v2";
import { BoxRenderable, TextAttributes, TextRenderable } from "@opentui/core";
import { onCleanup } from "solid-js";

const id = "opencode-sidebar-background-sessions";

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

function sessionMetaLine(session: RecentSessionItem, currentSessionID: string) {
	if (session.id === currentSessionID) return "current";
	return session.agent ?? "";
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
	let recentSessionsLoading = false;
	let recentSessionsError = "";
	let recentSessions: RecentSessionItem[] = [];
	let recentSessionsRequest = 0;

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
			limit: 20,
			scope: "project",
		});
		if (request !== recentSessionsRequest) return;

		recentSessionsLoading = false;
		if (response.error) {
			recentSessionsError = "Unable to load sessions";
			renderSidebar();
			return;
		}

		recentSessions = (response.data ?? []).slice(0, 20);
		renderSidebar();
	};
	const renderSidebar = () => {
		if (!container) return;
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
				renderSidebar();
			},
		});
		recentHeader.add(
			new TextRenderable(ctx, {
				content: recentSessionsCollapsed ? "▸" : "▾",
				fg: currentTheme.textMuted,
			}),
		);
		recentHeader.add(
			new TextRenderable(ctx, {
				content: "Recent Sessions",
				fg: currentTheme.text,
				attributes: TextAttributes.BOLD,
			}),
		);
		recentHeader.add(
			new TextRenderable(ctx, {
				content: recentSessionsLoading
					? "loading"
					: `${recentSessions.length}/20`,
				fg: currentTheme.textMuted,
			}),
		);
		container.add(recentHeader);

		if (!recentSessionsCollapsed) {
			if (recentSessionsError) {
				container.add(
					new TextRenderable(ctx, {
						content: recentSessionsError,
						fg: currentTheme.error,
						wrapMode: "word",
					}),
				);
			} else if (recentSessionsLoading && recentSessions.length === 0) {
				container.add(
					new TextRenderable(ctx, {
						content: "Loading sessions...",
						fg: currentTheme.textMuted,
					}),
				);
			} else if (recentSessions.length === 0) {
				container.add(
					new TextRenderable(ctx, {
						content: "No recent sessions",
						fg: currentTheme.textMuted,
					}),
				);
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
							content: current ? "•" : "›",
							fg: current ? currentTheme.success : currentTheme.textMuted,
						}),
					);

					const metaLine = sessionMetaLine(session, props.session_id);
					row.add(
						new TextRenderable(ctx, {
							content: metaLine
								? `${displayTitle(session.title)} ${metaLine}`
								: displayTitle(session.title),
							fg: current ? currentTheme.textMuted : currentTheme.warning,
							wrapMode: "word",
						}),
					);
					container.add(row);
				}
			}
		}

		container.requestRender();
		props.api.renderer.requestRender();
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
