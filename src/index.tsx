/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Part, Session } from "@opencode-ai/sdk/v2";
import { BoxRenderable, TextAttributes, TextRenderable } from "@opentui/core";
import { onCleanup } from "solid-js";

const id = "opencode-sidebar-background-sessions";
const recentSessionsPageSize = 15;
const recentSessionsFetchLimit = 1000;

type TaskItem = {
	sessionID?: string;
	title: string;
	agent?: string;
	model?: Session["model"];
	subagent?: string;
};

type RecentSessionItem = Pick<
	Session,
	"id" | "title" | "agent" | "model" | "parentID" | "time"
>;

type SessionDetails = Pick<Session, "id" | "agent" | "model">;

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

type BackgroundTaskState = "active" | "terminal";

function backgroundOutputTaskState(
	part: Part,
): BackgroundTaskState | undefined {
	if (part.type !== "tool") return;
	if (part.tool !== "background_output") return;
	if (part.state.status === "pending" || part.state.status === "running")
		return "active";
	const output = (part.state as { output?: unknown }).output;
	if (typeof output !== "string") return;
	const statusMatch =
		output.match(
			/\|\s*Status\s*\|\s*\*\*(running|queued|pending|completed|failed|error|cancelled|canceled)\*\*\s*\|/i,
		) ??
		output.match(
			/\bStatus\s*:\s*(running|queued|pending|completed|failed|error|cancelled|canceled)\b/i,
		);
	const status = statusMatch?.[1]?.toLowerCase();
	if (status === "running" || status === "queued" || status === "pending")
		return "active";
	if (
		status === "completed" ||
		status === "failed" ||
		status === "error" ||
		status === "cancelled" ||
		status === "canceled"
	)
		return "terminal";
	if (
		/(?:^|\n)\s*#?\s*Task Result\b/i.test(output) ||
		/Task\s+\d+\s+(?:completed|failed|error|cancelled|canceled)/i.test(output)
	)
		return "terminal";
	if (/still\s+running/i.test(output)) return "active";
}

function modelLabel(model: Session["model"] | undefined) {
	if (!model) return;
	const name = model.id.split("/").at(-1) ?? model.id;
	const variant = model.variant ? `:${model.variant}` : "";
	return `${name}${variant}`;
}

function taskMetaLine(item: TaskItem) {
	const details = [item.agent ?? item.subagent, modelLabel(item.model)].filter(
		(value) => value !== undefined && value !== "",
	);
	return details.join(" ");
}

function isSubagentSession(session: RecentSessionItem) {
	return (
		session.parentID !== undefined || /\(@.* subagent\)$/.test(session.title)
	);
}

function taskItem(
	part: Part,
	terminalBackgroundTaskIDs: Set<string>,
	activeBackgroundTaskIDs: Set<string>,
	isSessionActive: (sessionID: string) => boolean,
	sessionDetails: SessionDetails | undefined,
): TaskItem | undefined {
	if (part.type !== "tool") return;
	if (part.tool !== "task") return;
	const sessionID = partMetadataString(part, "sessionId");

	if (part.state.status === "completed") {
		const backgroundTaskID = partMetadataString(part, "backgroundTaskId");
		if (backgroundTaskID && terminalBackgroundTaskIDs.has(backgroundTaskID))
			return;
		if (backgroundTaskID && activeBackgroundTaskIDs.has(backgroundTaskID)) {
			// The task tool completes as soon as the sub-agent is spawned. A
			// background_output call can also complete while only reporting that the
			// task is still running, so keep the item visible until a terminal
			// background_output result arrives.
		} else if (!sessionID || !isSessionActive(sessionID)) return;
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
		agent: sessionDetails?.agent,
		model: sessionDetails?.model,
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
	let allRecentSessions: RecentSessionItem[] = [];
	let recentSessions: RecentSessionItem[] = [];
	let recentSessionsRequest = 0;
	let sessionDetailsByID = new Map<string, SessionDetails>();
	let sessionDetailRequests = new Set<string>();
	let renderScheduled = false;
	let activeSessionID = props.session_id;

	const currentSessionID = () => {
		const currentRoute = props.api.route.current;
		if (
			currentRoute.name === "session" &&
			typeof currentRoute.params?.sessionID === "string"
		) {
			activeSessionID = currentRoute.params.sessionID;
		}
		return activeSessionID;
	};

	const parts = () =>
		props.api.state.session
			.messages(currentSessionID())
			.flatMap((message) => props.api.state.part(message.id));
	const requestSessionDetails = (sessionID: string) => {
		if (sessionDetailsByID.has(sessionID)) return;
		if (sessionDetailRequests.has(sessionID)) return;
		sessionDetailRequests.add(sessionID);
		void props.api.client.session
			.get({ sessionID })
			.then((response) => {
				if (response.data) {
					sessionDetailsByID = new Map(sessionDetailsByID).set(sessionID, {
						id: response.data.id,
						agent: response.data.agent,
						model: response.data.model,
					});
					scheduleRenderSidebar();
				}
			})
			.finally(() => {
				sessionDetailRequests.delete(sessionID);
			});
	};
	const list = () => {
		const currentParts = parts();
		const terminalBackgroundTaskIDs = new Set<string>();
		const activeBackgroundTaskIDs = new Set<string>();
		for (const part of currentParts) {
			const backgroundTaskID = partMetadataString(part, "backgroundTaskId");
			if (!backgroundTaskID) continue;
			const state = backgroundOutputTaskState(part);
			if (state === "terminal") terminalBackgroundTaskIDs.add(backgroundTaskID);
			else if (state === "active")
				activeBackgroundTaskIDs.add(backgroundTaskID);
		}
		return currentParts
			.map((part) => {
				const sessionID = partMetadataString(part, "sessionId");
				if (sessionID) requestSessionDetails(sessionID);
				return taskItem(
					part,
					terminalBackgroundTaskIDs,
					activeBackgroundTaskIDs,
					(sessionID) => {
						const status = props.api.state.session.status(sessionID)?.type;
						return status !== undefined && status !== "idle";
					},
					sessionID ? sessionDetailsByID.get(sessionID) : undefined,
				);
			})
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
		activeSessionID = item.sessionID;
		props.api.route.navigate("session", { sessionID: item.sessionID });
		scheduleRenderSidebar();
	};
	const openRecentSession = (session: RecentSessionItem) => {
		if (session.id === currentSessionID()) return;
		activeSessionID = session.id;
		props.api.route.navigate("session", { sessionID: session.id });
		scheduleRenderSidebar();
	};
	const applyRecentSessionsPage = () => {
		const maxPage = Math.max(
			0,
			Math.ceil(allRecentSessions.length / recentSessionsPageSize) - 1,
		);
		recentSessionsPage = Math.min(recentSessionsPage, maxPage);
		const start = recentSessionsPage * recentSessionsPageSize;
		recentSessions = allRecentSessions.slice(
			start,
			start + recentSessionsPageSize,
		);
		recentSessionsHasNext =
			start + recentSessionsPageSize < allRecentSessions.length;
	};
	const recentSessionsPageCount = () => {
		return Math.max(
			1,
			Math.ceil(allRecentSessions.length / recentSessionsPageSize),
		);
	};
	const recentSessionsPageLabel = () => {
		const total = allRecentSessions.length;
		if (total === 0) return "0/0";
		const pageCount = recentSessionsPageCount();
		return `${String(recentSessionsPage + 1).padStart(String(pageCount).length, "0")}/${pageCount}`;
	};
	const refreshRecentSessions = async () => {
		const request = ++recentSessionsRequest;
		recentSessionsLoading = true;
		recentSessionsError = "";
		renderSidebar();

		const response = await props.api.client.session.list({
			limit: recentSessionsFetchLimit,
			scope: "project",
		});
		if (request !== recentSessionsRequest) return;

		recentSessionsLoading = false;
		if (response.error) {
			recentSessionsError = "Unable to load sessions";
			renderSidebar();
			return;
		}

		sessionDetailsByID = new Map(sessionDetailsByID);
		for (const session of response.data ?? []) {
			sessionDetailsByID.set(session.id, {
				id: session.id,
				agent: session.agent,
				model: session.model,
			});
		}
		allRecentSessions = (response.data ?? []).filter(
			(session) => !isSubagentSession(session),
		);
		applyRecentSessionsPage();
		renderSidebar();
	};
	const goToRecentSessionsPage = (page: number) => {
		if (page < 0) return;
		const maxPage = Math.max(
			0,
			Math.ceil(allRecentSessions.length / recentSessionsPageSize) - 1,
		);
		if (page > maxPage) return;
		recentSessionsPage = page;
		applyRecentSessionsPage();
		recentSessionsLoading = false;
		recentSessionsError = "";
		scheduleRenderSidebar();
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
					? (event) => {
							event.stopPropagation();
							openSubagentSession(item);
						}
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

		if (items.length > 0) {
			container.add(
				new TextRenderable(ctx, {
					content: " ",
					fg: currentTheme.textMuted,
				}),
			);
		}

		const recentHeader = new BoxRenderable(ctx, {
			id: `${id}-recent-sessions-header`,
			flexDirection: "row",
			gap: 1,
			width: "100%",
			onMouseDown: (event) => {
				event.stopPropagation();
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
		if (
			!recentSessionsCollapsed &&
			!recentSessionsError &&
			!recentSessionsLoading &&
			allRecentSessions.length > 0
		) {
			const previousEnabled = recentSessionsPage > 0;
			const nextEnabled = recentSessionsHasNext;
			const label = recentSessionsPageLabel();
			recentHeader.add(
				new BoxRenderable(ctx, {
					flexGrow: 1,
					flexShrink: 1,
				}),
			);
			const controls = new BoxRenderable(ctx, {
				id: `${id}-recent-pagination`,
				flexDirection: "row",
				onMouseDown: function (event) {
					event.stopPropagation();
					const localX = event.x - this.x;
					if (previousEnabled && localX < 2) {
						goToRecentSessionsPage(recentSessionsPage - 1);
						return;
					}
					if (nextEnabled && localX >= label.length + 3) {
						goToRecentSessionsPage(recentSessionsPage + 1);
					}
				},
			});
			controls.add(
				new TextRenderable(ctx, {
					content: "←",
					fg: previousEnabled ? currentTheme.text : currentTheme.textMuted,
					width: 2,
				}),
			);
			controls.add(
				new TextRenderable(ctx, {
					content: label,
					fg: currentTheme.textMuted,
				}),
			);
			controls.add(
				new TextRenderable(ctx, {
					content: "→",
					fg: nextEnabled ? currentTheme.text : currentTheme.textMuted,
					marginLeft: 1,
				}),
			);
			recentHeader.add(controls);
		}
		container.add(recentHeader);

		if (!recentSessionsCollapsed) {
			if (recentSessionsError) {
				const row = new BoxRenderable(ctx, {
					flexDirection: "row",
				});
				row.add(
					new TextRenderable(ctx, {
						content: "•",
						fg: currentTheme.error,
						width: 2,
					}),
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
				});
				row.add(
					new TextRenderable(ctx, {
						content: "•",
						fg: currentTheme.success,
						width: 2,
					}),
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
				});
				row.add(
					new TextRenderable(ctx, {
						content: "•",
						fg: currentTheme.textMuted,
						width: 2,
					}),
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
					const current = session.id === currentSessionID();
					const row = new BoxRenderable(ctx, {
						id: `${id}-recent-row-${session.id}`,
						flexDirection: "row",
						onMouseDown: current
							? undefined
							: (event) => {
									event.stopPropagation();
									openRecentSession(session);
								},
					});
					row.add(
						new TextRenderable(ctx, {
							content: "•",
							fg: current ? currentTheme.text : currentTheme.success,
							width: 2,
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
		}

		container.requestRender();
		props.api.renderer.requestRender();
	};
	const scheduleRenderSidebar = () => {
		if (renderScheduled) return;
		renderScheduled = true;
		setTimeout(renderSidebar, 0);
	};
	const refreshSidebar = () => renderSidebar();
	const refreshSessions = () => {
		void refreshRecentSessions();
	};
	const refreshIdleSession = () => {
		renderSidebar();
		void refreshRecentSessions();
	};

	onCleanup(props.api.event.on("message.updated", refreshSidebar));
	onCleanup(props.api.event.on("message.removed", refreshSidebar));
	onCleanup(props.api.event.on("message.part.updated", refreshSidebar));
	onCleanup(props.api.event.on("message.part.removed", refreshSidebar));
	onCleanup(props.api.event.on("session.updated", refreshSessions));
	onCleanup(props.api.event.on("session.status", refreshSidebar));
	onCleanup(props.api.event.on("session.idle", refreshIdleSession));

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
