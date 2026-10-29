/** @jsxImportSource @opentui/solid */
import type { SessionInfo } from "@opencode/client";
import type { Context } from "@opencode/plugin/tui/context";
import { TextAttributes } from "@opentui/core";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";

const pageSize = 15;
const maxSessions = 1000;
const blinkInterval = 700;
type AttentionKind = "permission" | "form";
type Activity = "idle" | "running" | "permission" | "form" | "unread" | "failed" | "unknown";

function displayTitle(title: string | undefined) {
	return (title || "Untitled session")
		.replace(/^Background: /, "")
		.replace(/^Task: /, "")
		.replace(/ \(@.* subagent\)$/, "");
}

function modelLabel(model: SessionInfo["model"]) {
	if (!model) return "";
	const name = model.id.split("/").at(-1) ?? model.id;
	return `${name}${model.variant ? `:${model.variant}` : ""}`;
}

function View(props: {
	context: Context;
	sessionID: string;
	collapsed: () => boolean;
	toggleCollapsed: () => void;
}) {
	const { context } = props;
	const collapsed = props.collapsed;
	const [page, setPage] = createSignal(0);
	const [sessions, setSessions] = createSignal<SessionInfo[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal(false);
	const [hydrated, setHydrated] = createSignal<Record<string, boolean>>({});
	const [connection, setConnection] = createSignal(0);
	const [bright, setBright] = createSignal(true);
	const attempted = new Set<string>();
	const inFlight = new Map<string, Promise<void>>();
	let request = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	// V2 exposes child sessions and their live execution status directly. Unlike
	// historical tool results, this does not mistake a finished job for a live one.
	const running = createMemo(() =>
		context.data.session.list().filter(
			(session) =>
				session.parentID === props.sessionID &&
				context.data.session.status(session.id) === "running",
		),
	);
	const pages = createMemo(() =>
		Math.max(1, Math.ceil(sessions().length / pageSize)),
	);
	const visible = createMemo(() =>
		sessions().slice(page() * pageSize, (page() + 1) * pageSize),
	);
	const pageLabel = createMemo(
		() => `${String(page() + 1).padStart(String(pages()).length, "0")}/${pages()}`,
	);

	const attentionKey = (kind: AttentionKind, id: string) => `${kind}:${id}`;
	function syncAttention(kind: AttentionKind, id: string, invalidate = false) {
		const key = attentionKey(kind, id);
		if (!invalidate && attempted.has(key)) return;
		attempted.add(key);
		const resource = context.data.session[kind];
		if (invalidate) resource.invalidate(id);
		const pending = resource.sync(id);
		inFlight.set(key, pending);
		void pending.then(
			() => {
				if (!disposed && inFlight.get(key) === pending)
					setHydrated((previous) => ({ ...previous, [key]: true }));
			},
			() => {},
		).finally(() => {
			if (inFlight.get(key) === pending) inFlight.delete(key);
		});
	}

	const members = (id: string) => Array.from(new Set([id, ...context.data.session.family(id)]));
	const hasPermission = (id: string) => (context.data.session.permission.list(id)?.length ?? 0) > 0;
	const hasForm = (id: string) => (context.data.session.form.list(id)?.length ?? 0) > 0;
	const needsHydration = (root: string, id: string) =>
		id === root || context.data.session.status(id) === "running";

	// Only hydrate visible roots and active descendants, not all historical sessions.
	// The host's live event cache updates the rows after these initial reads.
	createEffect(() => {
		connection();
		const ids = new Set(running().map((session) => session.id));
		if (!collapsed()) {
			for (const session of visible()) {
				for (const id of members(session.id)) {
					if (needsHydration(session.id, id)) ids.add(id);
				}
			}
		}
		for (const id of ids) {
			syncAttention("permission", id);
			syncAttention("form", id);
		}
	});

	function activity(session: SessionInfo, includeFamily: boolean): Activity {
		const ids = includeFamily ? members(session.id) : [session.id];
		if (ids.some(hasPermission)) return "permission";
		if (ids.some(hasForm)) return "form";
		if (ids.some((id) => needsHydration(session.id, id) &&
			(!hydrated()[attentionKey("permission", id)] || !hydrated()[attentionKey("form", id)]))) return "unknown";
		if (ids.some((id) => context.data.session.status(id) === "running")) return "running";
		const cached = context.data.session.get(session.id);
		const latest = cached && (cached.time.idle ?? -1) > (session.time.idle ?? -1) ? cached : session;
		const viewed = Math.max(session.time.viewed ?? -1, cached?.time.viewed ?? -1);
		if (latest.time.idle !== undefined && latest.time.idle > viewed)
			return latest.outcome === "failed" ? "failed" : "unread";
		return "idle";
	}

	const hasWorking = createMemo(() =>
		running().some((session) => activity(session, false) === "running") ||
		(!collapsed() && visible().some((session) => activity(session, true) === "running")),
	);
	createEffect(() => {
		if (!hasWorking() || context.options.animate === false) {
			setBright(true);
			return;
		}
		const interval = setInterval(() => setBright((previous) => !previous), blinkInterval);
		onCleanup(() => clearInterval(interval));
	});

	function indicator(state: Activity) {
		switch (state) {
			case "running": return { symbol: "●", color: bright() ? context.theme.text.feedback.success.base : context.theme.text.muted };
			case "permission": return { symbol: "!", color: context.theme.text.feedback.warning.base };
			case "form": return { symbol: "?", color: context.theme.text.feedback.warning.base };
			case "unread": return { symbol: "◆", color: context.theme.hue.accent[200] };
			case "failed": return { symbol: "×", color: context.theme.text.feedback.error.base };
			case "unknown": return { symbol: "·", color: context.theme.text.muted };
			case "idle": return { symbol: "○", color: context.theme.text.muted };
		}
	}

	async function refresh(projectID: string) {
		const current = ++request;
		setLoading(true);
		setError(false);
		try {
			const found: SessionInfo[] = [];
			const seenCursors = new Set<string>();
			let cursor: string | null | undefined;
			do {
				const result = await context.client.session.list(
					cursor
						? { cursor, limit: Math.min(100, maxSessions - found.length) }
						: {
								project: projectID,
								parentID: null,
								archived: false,
								order: "desc",
								limit: 100,
							},
				);
				if (disposed || current !== request) return;
				found.push(...result.data);
				cursor = result.cursor.next;
				if (cursor && seenCursors.has(cursor))
					throw new Error("Repeated session cursor");
				if (cursor) seenCursors.add(cursor);
			} while (cursor && found.length < maxSessions);
			const recent = found
				.filter((session) => !session.parentID && session.time.archived === undefined)
				.slice(0, maxSessions);
			setSessions(recent);
			setPage((previous) =>
				Math.min(previous, Math.max(0, Math.ceil(recent.length / pageSize) - 1)),
			);
		} catch {
			if (disposed || current !== request) return;
			setError(true);
		} finally {
			if (!disposed && current === request) setLoading(false);
		}
	}

	// Hydrate the current session if the sidebar mounts before its info arrives.
	createEffect(() => {
		const sessionID = props.sessionID;
		const settled = () => {
			if (
				!disposed &&
				props.sessionID === sessionID &&
				!context.data.session.get(sessionID)?.projectID
			) {
				setError(true);
				setLoading(false);
			}
		};
		void context.data.session.sync(sessionID).then(settled, settled);
	});

	const projectID = createMemo(
		() => context.data.session.get(props.sessionID)?.projectID,
	);
	createEffect(() => {
		const sessionID = props.sessionID;
		const project = projectID();
		// Invalidate an older project's request even when the new session is not hydrated yet.
		request++;
		setSessions([]);
		setPage(0);
		setLoading(true);
		setError(false);
		if (!sessionID || !project) {
			return;
		}
		void refresh(project);
	});

	const refreshLater = () => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			const projectID = context.data.session.get(props.sessionID)?.projectID;
			if (projectID) void refresh(projectID);
		}, 150);
	};
	// A live event can overtake an initial read. Revalidate that read so an old
	// snapshot cannot permanently overwrite the event in the host's cache.
	const revalidateInFlight = (kind: AttentionKind, id: string) => {
		if (inFlight.has(attentionKey(kind, id))) syncAttention(kind, id, true);
	};
	const reconnect = () => {
		for (const key of attempted) {
			const separator = key.indexOf(":");
			const kind = key.slice(0, separator) as AttentionKind;
			context.data.session[kind].invalidate(key.slice(separator + 1));
		}
		attempted.clear();
		inFlight.clear();
		setHydrated({});
		setConnection((previous) => previous + 1);
		refreshLater();
	};
	const unsubscribers = [
		context.data.on("session.created", refreshLater),
		context.data.on("session.deleted", refreshLater),
		context.data.on("session.renamed", refreshLater),
		context.data.on("session.archived", refreshLater),
		context.data.on("session.unarchived", refreshLater),
		context.data.on("session.execution.succeeded", refreshLater),
		context.data.on("session.execution.failed", refreshLater),
		context.data.on("session.execution.interrupted", refreshLater),
		context.data.on("session.viewed", refreshLater),
		context.data.on("permission.asked", (event) => revalidateInFlight("permission", event.data.sessionID)),
		context.data.on("permission.replied", (event) => revalidateInFlight("permission", event.data.sessionID)),
		context.data.on("form.created", (event) => revalidateInFlight("form", event.data.form.sessionID)),
		context.data.on("form.replied", (event) => revalidateInFlight("form", event.data.sessionID)),
		context.data.on("form.cancelled", (event) => revalidateInFlight("form", event.data.sessionID)),
		context.data.on("server.connected", reconnect),
	];
	onCleanup(() => {
		disposed = true;
		request++;
		clearTimeout(timer);
		unsubscribers.forEach((unsubscribe) => unsubscribe());
	});

	const navigate = (sessionID: string) => {
		if (sessionID !== props.sessionID)
			context.ui.router.navigate({ type: "session", sessionID });
	};
	const color = () => context.theme.text;

	return (
		<box flexDirection="column">
			<Show when={running().length > 0}>
				<text fg={color().base} attributes={TextAttributes.BOLD}>
					Running Agents
				</text>
				<For each={running()}>
					{(session) => (
						<box
							flexDirection="row"
							gap={1}
							onMouseDown={(event) => {
								event.stopPropagation();
								navigate(session.id);
							}}
						>
							<text fg={indicator(activity(session, false)).color}>{indicator(activity(session, false)).symbol}</text>
							<box flexDirection="column" flexGrow={1} flexShrink={1}>
								<text fg={color().feedback.warning.base} wrapMode="word">
									{displayTitle(session.title)}
								</text>
								<Show when={session.agent || session.model}>
									<text fg={color().muted}>
										{[session.agent, modelLabel(session.model)].filter(Boolean).join(" ")}
									</text>
								</Show>
							</box>
						</box>
					)}
				</For>
				<text> </text>
			</Show>
			<box
				flexDirection="row"
				gap={1}
				width="100%"
				onMouseDown={(event) => {
					event.stopPropagation();
					props.toggleCollapsed();
				}}
			>
				<text fg={color().base}>{collapsed() ? "▶" : "▼"}</text>
				<text fg={color().base} attributes={TextAttributes.BOLD}>
					Sessions
				</text>
				<Show when={!collapsed() && !loading() && !error() && sessions().length > 0}>
					<box flexGrow={1} flexShrink={1} />
					<box flexDirection="row" gap={1}>
						<text
							fg={page() > 0 ? color().base : color().muted}
							onMouseDown={(event) => {
								event.stopPropagation();
								setPage(Math.max(0, page() - 1));
							}}
						>
							←
						</text>
						<text fg={color().muted}>{pageLabel()}</text>
						<text
							fg={page() + 1 < pages() ? color().base : color().muted}
							onMouseDown={(event) => {
								event.stopPropagation();
								setPage(Math.min(pages() - 1, page() + 1));
							}}
						>
							→
						</text>
					</box>
				</Show>
			</box>
			<Show when={!collapsed()}>
				<Show when={error()}>
					<text fg={color().feedback.error.base}>• Unable to load sessions</text>
				</Show>
				<Show when={!error() && loading() && sessions().length === 0}>
					<text fg={color().muted}>• loading sessions...</text>
				</Show>
				<Show when={!error() && !loading() && sessions().length === 0}>
					<text fg={color().muted}>• no recent sessions</text>
				</Show>
				<Show when={!error()}>
					<For each={visible()}>
						{(session) => (
							<box
								flexDirection="row"
								onMouseDown={(event) => {
									event.stopPropagation();
									navigate(session.id);
								}}
							>
								<text
									width={2}
									fg={indicator(activity(session, true)).color}
								>
									{indicator(activity(session, true)).symbol}
								</text>
								<text
									fg={session.id === props.sessionID ? color().base : color().muted}
									attributes={session.id === props.sessionID ? TextAttributes.BOLD : undefined}
									wrapMode="word"
								>
									{displayTitle(session.title)}
								</text>
							</box>
						)}
					</For>
				</Show>
			</Show>
		</box>
	);
}

export function setupV2(context: Context) {
	// The host remounts the sidebar on navigation, so keep this at plugin scope.
	const [collapsed, setCollapsed] = createSignal(true);
	const toggleCollapsed = () => setCollapsed((previous) => !previous);
	return context.ui.slot({
		append: "sidebar.content",
		render: (props) => (
			<View
				context={context}
				sessionID={props.sessionID}
				collapsed={collapsed}
				toggleCollapsed={toggleCollapsed}
			/>
		),
	});
}
