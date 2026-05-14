/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test";
import type { TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui";
import { testRender } from "@opentui/solid";
import plugin from "../dist/index.js";

const cleanupRenderers: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanupRenderers.splice(0)) cleanup();
});

type SessionFixture = {
	id: string;
	title: string;
	agent?: string;
	model?: {
		id: string;
		providerID: string;
		variant?: string;
	};
	parentID?: string;
	time?: {
		created: number;
		updated: number;
	};
};

type ToolPartFixture = {
	id: string;
	type: "tool";
	tool: "task" | "background_output";
	state: {
		status: "pending" | "running" | "completed" | "error";
		input: Record<string, string>;
		metadata?: Record<string, string>;
	};
};

type HarnessOptions = {
	initialSessionID?: string;
	sessions?: SessionFixture[];
	listSessions?: () => Promise<{
		data?: SessionFixture[];
		error?: { message: string };
	}>;
	listError?: boolean;
	messagesBySession?: Map<string, { id: string }[]>;
	partsByMessage?: Map<string, ToolPartFixture[]>;
	statusBySession?: Map<string, { type: string }>;
	getSession?: (sessionID: string) => Promise<{ data?: SessionFixture }>;
};

function session(id: string, title = `Session ${id}`): SessionFixture {
	return {
		id,
		title,
		time: { created: 1, updated: 1 },
	};
}

function taskPart(
	sessionID: string,
	status: ToolPartFixture["state"]["status"],
	metadata: Record<string, string> = {},
): ToolPartFixture {
	return {
		id: `task-${sessionID}-${status}`,
		type: "tool",
		tool: "task",
		state: {
			status,
			input: {
				description: `Task for ${sessionID}`,
				subagent_type: "quick",
			},
			metadata: {
				sessionId: sessionID,
				backgroundTaskId: `bg-${sessionID}`,
				...metadata,
			},
		},
	};
}

function backgroundOutputPart(backgroundTaskID: string): ToolPartFixture {
	return {
		id: `background-output-${backgroundTaskID}`,
		type: "tool",
		tool: "background_output",
		state: {
			status: "completed",
			input: {},
			metadata: {
				backgroundTaskId: backgroundTaskID,
			},
		},
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolver) => {
		resolve = resolver;
	});
	return { promise, resolve };
}

async function renderSidebar(options: HarnessOptions = {}) {
	const initialSessionID = options.initialSessionID ?? "s1";
	const listCalls: unknown[] = [];
	const getCalls: string[] = [];
	const navigations: Array<{ name: string; params: { sessionID: string } }> =
		[];
	const eventHandlers = new Map<string, Array<() => void>>();
	let slot:
		| ((ctx: unknown, props: { session_id: string }) => unknown)
		| undefined;

	const route = {
		current: { name: "session", params: { sessionID: initialSessionID } },
		navigate(name: string, params: { sessionID: string }) {
			this.current = { name, params };
			navigations.push({ name, params });
		},
	};

	const api = {
		theme: {
			current: {
				text: "#ffffff",
				textMuted: "#888888",
				success: "#00ff00",
				error: "#ff0000",
				warning: "#ffff00",
			},
		},
		route,
		client: {
			session: {
				list: async (parameters: unknown) => {
					listCalls.push(parameters);
					if (options.listSessions) return options.listSessions();
					if (options.listError) return { error: { message: "boom" } };
					return { data: options.sessions ?? [session(initialSessionID)] };
				},
				get: async ({ sessionID }: { sessionID: string }) => {
					getCalls.push(sessionID);
					if (options.getSession) return options.getSession(sessionID);
					return {
						data: options.sessions?.find((item) => item.id === sessionID),
					};
				},
			},
		},
		state: {
			session: {
				messages: (sessionID: string) =>
					options.messagesBySession?.get(sessionID) ?? [],
				status: (sessionID: string) => options.statusBySession?.get(sessionID),
			},
			part: (messageID: string) => options.partsByMessage?.get(messageID) ?? [],
		},
		event: {
			on(type: string, handler: () => void) {
				const handlers = eventHandlers.get(type) ?? [];
				handlers.push(handler);
				eventHandlers.set(type, handlers);
				return () => {
					eventHandlers.set(
						type,
						(eventHandlers.get(type) ?? []).filter((item) => item !== handler),
					);
				};
			},
		},
		renderer: { requestRender() {} },
		slots: {
			register(registration: {
				slots: {
					sidebar_content: (
						ctx: unknown,
						props: { session_id: string },
					) => unknown;
				};
			}) {
				slot = registration.slots.sidebar_content;
			},
		},
	};

	await plugin.tui(api as unknown as TuiPluginApi, {}, {
		id: "test",
		source: "file",
		spec: "test",
		target: "test",
		first_time: 0,
		last_time: 0,
		time_changed: 0,
		load_count: 1,
		fingerprint: "test",
		state: "first",
	} as TuiPluginMeta);
	const sidebarSlot = slot;
	if (!sidebarSlot) throw new Error("sidebar slot was not registered");

	const setup = await testRender(
		() => sidebarSlot({}, { session_id: initialSessionID }),
		{
			width: 70,
			height: 28,
		},
	);
	cleanupRenderers.push(() => setup.renderer.destroy());

	const frame = async () => {
		await new Promise((resolve) => setTimeout(resolve, 10));
		await setup.renderOnce();
		return setup.captureCharFrame();
	};

	return {
		...setup,
		frame,
		listCalls,
		getCalls,
		navigations,
		emit(type: string) {
			for (const handler of eventHandlers.get(type) ?? []) handler();
		},
	};
}

test("sessions accordion loads project sessions collapsed, filters subagents, paginates in the right-aligned header", async () => {
	const sessions = [
		...Array.from({ length: 17 }, (_, index) =>
			session(`s${index + 1}`, `Session ${index + 1}`),
		),
		{ ...session("sub-parent", "Subagent by parent"), parentID: "s1" },
		session("sub-title", "Task (@build subagent)"),
	];
	const sidebar = await renderSidebar({ sessions });

	let frame = await sidebar.frame();
	expect(frame).toContain("▶ Sessions");
	expect(frame).not.toContain("Session 2");
	expect(sidebar.listCalls).toEqual([{ limit: 1000, scope: "project" }]);

	await sidebar.mockMouse.click(2, 0);
	frame = await sidebar.frame();
	const header = frame.split("\n").find((line) => line.includes("▼ Sessions"));
	expect(header).toContain("← 1/2 →");
	expect(header?.indexOf("←")).toBeGreaterThan(35);
	expect(frame.match(/1\/2/g)?.length).toBe(1);
	expect(frame).toContain("Session 15");
	expect(frame).not.toContain("Session 16");
	expect(frame).not.toContain("Subagent by parent");
	expect(frame).not.toContain("Task (@build subagent)");

	await sidebar.mockMouse.click(header?.indexOf("→") ?? 65, 0);
	frame = await sidebar.frame();
	expect(frame).toContain("▼ Sessions");
	expect(frame).toContain("← 2/2 →");
	expect(frame).toContain("Session 16");
	expect(frame).toContain("Session 17");
	expect(frame).not.toContain("Session 15");

	await sidebar.mockMouse.click(2, 0);
	frame = await sidebar.frame();
	expect(frame).toContain("▶ Sessions");
	expect(frame).not.toContain("02/02");
	expect(frame).not.toContain("Session 16");
});

test("header pagination pads the current page when total pages have multiple digits", async () => {
	const sidebar = await renderSidebar({
		sessions: Array.from({ length: 151 }, (_, index) =>
			session(`s${index + 1}`, `Session ${index + 1}`),
		),
	});

	await sidebar.frame();
	await sidebar.mockMouse.click(2, 0);
	let frame = await sidebar.frame();
	let header = frame.split("\n").find((line) => line.includes("▼ Sessions"));
	expect(header).toContain("← 01/11 →");
	expect(frame).toContain("Session 15");
	expect(frame).not.toContain("Session 16");

	await sidebar.mockMouse.click(header?.indexOf("→") ?? 65, 0);
	frame = await sidebar.frame();
	header = frame.split("\n").find((line) => line.includes("▼ Sessions"));
	expect(header).toContain("← 02/11 →");
	expect(frame).toContain("Session 16");
	expect(frame).toContain("Session 30");

	await sidebar.mockMouse.click(header?.indexOf("←") ?? 55, 0);
	frame = await sidebar.frame();
	expect(frame).toContain("← 01/11 →");
	expect(frame).toContain("Session 1");
	expect(frame).not.toContain("Session 16");
});

test("session rows navigate only for non-current sessions and current selection updates", async () => {
	const sidebar = await renderSidebar({
		initialSessionID: "s1",
		sessions: [
			session("s1", "Current session"),
			session("s2", "Target session"),
		],
	});

	await sidebar.frame();
	await sidebar.mockMouse.click(2, 0);
	let frame = await sidebar.frame();
	expect(frame).toContain("Current session");
	expect(frame).toContain("Target session");

	await sidebar.mockMouse.click(2, 1);
	await sidebar.frame();
	expect(sidebar.navigations).toEqual([]);

	await sidebar.mockMouse.click(2, 2);
	frame = await sidebar.frame();
	expect(sidebar.navigations).toEqual([
		{ name: "session", params: { sessionID: "s2" } },
	]);
	expect(frame).toContain("Target session");
});

test("recent sessions shows loading result states for empty and failed lists", async () => {
	const pendingList = deferred<{ data?: SessionFixture[] }>();
	const loadingSidebar = await renderSidebar({
		listSessions: () => pendingList.promise,
	});
	await loadingSidebar.frame();
	await loadingSidebar.mockMouse.click(2, 0);
	let frame = await loadingSidebar.frame();
	expect(frame).toContain("▼ Sessions");
	expect(frame).toContain("loading sessions...");
	pendingList.resolve({ data: [session("s1", "Loaded session")] });
	frame = await loadingSidebar.frame();
	expect(frame).toContain("Loaded session");

	const emptySidebar = await renderSidebar({ sessions: [] });
	await emptySidebar.frame();
	await emptySidebar.mockMouse.click(2, 0);
	frame = await emptySidebar.frame();
	expect(frame).toContain("▼ Sessions");
	expect(frame).toContain("no recent sessions");

	const errorSidebar = await renderSidebar({ listError: true });
	await errorSidebar.frame();
	await errorSidebar.mockMouse.click(2, 0);
	frame = await errorSidebar.frame();
	expect(frame).toContain("▼ Sessions");
	expect(frame).toContain("Unable to load sessions");
});

test("retro completed task records do not render as running agents unless their child session is live-active", async () => {
	const messagesBySession = new Map([["retro", [{ id: "m1" }]]]);
	const completedTask = taskPart("child", "completed");

	const hiddenSidebar = await renderSidebar({
		initialSessionID: "retro",
		sessions: [session("retro", "Retro")],
		messagesBySession,
		partsByMessage: new Map([["m1", [completedTask]]]),
	});
	let frame = await hiddenSidebar.frame();
	expect(frame).not.toContain("Running Agents");
	expect(frame).not.toContain("Task for child");
	await hiddenSidebar.mockMouse.click(2, 0);
	frame = await hiddenSidebar.frame();
	expect(frame).not.toContain("Running Agents");

	const idleSidebar = await renderSidebar({
		initialSessionID: "retro",
		sessions: [session("retro", "Retro")],
		messagesBySession,
		partsByMessage: new Map([["m1", [completedTask]]]),
		statusBySession: new Map([["child", { type: "idle" }]]),
	});
	frame = await idleSidebar.frame();
	expect(frame).not.toContain("Running Agents");

	const backgroundOutputSidebar = await renderSidebar({
		initialSessionID: "retro",
		sessions: [session("retro", "Retro")],
		messagesBySession,
		partsByMessage: new Map([
			["m1", [completedTask, backgroundOutputPart("bg-child")]],
		]),
		statusBySession: new Map([["child", { type: "running" }]]),
	});
	frame = await backgroundOutputSidebar.frame();
	expect(frame).not.toContain("Running Agents");

	const activeSidebar = await renderSidebar({
		initialSessionID: "retro",
		sessions: [session("retro", "Retro")],
		messagesBySession,
		partsByMessage: new Map([["m1", [completedTask]]]),
		statusBySession: new Map([["child", { type: "running" }]]),
	});
	frame = await activeSidebar.frame();
	expect(frame).toContain("Running Agents");
	expect(frame).toContain("Task for child");
});

test("running agent rows enrich with child session agent and shortened model metadata without repeated fetches", async () => {
	const childDetails = deferred<{ data?: SessionFixture }>();
	const messagesBySession = new Map([["parent", [{ id: "m1" }]]]);
	const sidebar = await renderSidebar({
		initialSessionID: "parent",
		sessions: [session("parent", "Parent")],
		messagesBySession,
		partsByMessage: new Map([["m1", [taskPart("child", "running")]]]),
		statusBySession: new Map([["child", { type: "running" }]]),
		getSession: () => childDetails.promise,
	});

	let frame = await sidebar.frame();
	expect(frame).toContain("Running Agents");
	expect(frame).toContain("Task for child");
	expect(frame).toContain("quick");
	expect(frame).not.toContain("claude-sonnet-4-5");

	childDetails.resolve({
		data: {
			...session("child", "Child"),
			agent: "build",
			model: {
				id: "openrouter/anthropic/claude-sonnet-4-5",
				providerID: "openrouter",
				variant: "thinking",
			},
		},
	});
	frame = await sidebar.frame();
	expect(frame).toContain("build claude-sonnet-4-5:thinking");
	expect(frame).not.toContain("build ·");
	expect(frame).not.toContain("openrouter/");
	expect(frame).not.toContain("anthropic/");
	expect(sidebar.getCalls).toEqual(["child"]);
});

test("running agents and sessions keep separate sections and the sessions header survives collapse toggles", async () => {
	const messagesBySession = new Map([["parent", [{ id: "m1" }]]]);
	const sidebar = await renderSidebar({
		initialSessionID: "parent",
		sessions: [session("parent", "Parent"), session("other", "Other")],
		messagesBySession,
		partsByMessage: new Map([["m1", [taskPart("child", "running")]]]),
		statusBySession: new Map([["child", { type: "running" }]]),
	});

	let frame = await sidebar.frame();
	expect(frame).toContain("Running Agents");
	expect(frame).toContain("Task for child");
	expect(frame).toContain("▶ Sessions");

	const sessionsY = frame
		.split("\n")
		.findIndex((line) => line.includes("▶ Sessions"));
	expect(sessionsY).toBeGreaterThan(2);
	await sidebar.mockMouse.click(2, sessionsY);
	frame = await sidebar.frame();
	expect(frame).toContain("Running Agents");
	expect(frame).toContain("▼ Sessions");
	expect(frame).toContain("Other");
	await sidebar.mockMouse.click(2, sessionsY);
	frame = await sidebar.frame();
	expect(frame).toContain("Running Agents");
	expect(frame).toContain("▶ Sessions");
	expect(frame).not.toContain("Other");

	await sidebar.mockMouse.click(2, 1);
	await sidebar.frame();
	expect(sidebar.navigations).toContainEqual({
		name: "session",
		params: { sessionID: "child" },
	});
});

test("session events refresh the project sessions list", async () => {
	const sidebar = await renderSidebar({ sessions: [session("s1", "Initial")] });
	let frame = await sidebar.frame();
	expect(frame).toContain("▶ Sessions");
	expect(sidebar.listCalls).toHaveLength(1);

	sidebar.emit("session.updated");
	frame = await sidebar.frame();
	expect(frame).toContain("▶ Sessions");
	expect(sidebar.listCalls).toHaveLength(2);

	sidebar.emit("message.updated");
	frame = await sidebar.frame();
	expect(frame).toContain("▶ Sessions");
	expect(sidebar.listCalls).toHaveLength(2);
});
