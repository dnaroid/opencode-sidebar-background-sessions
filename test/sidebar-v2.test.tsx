/** @jsxImportSource @opentui/solid */
import { afterEach, expect, test } from "bun:test";
import type { SessionInfo } from "@opencode/client";
import type { Context } from "@opencode/plugin/tui/context";
import { testRender } from "@opentui/solid";
import { createComponent, createSignal, Show } from "solid-js";
import plugin from "../dist/index.js";

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

function session(id: string, title = `Session ${id}`, parentID?: string): SessionInfo {
	return {
		id, title, parentID, projectID: "project-1", location: { directory: "/project" },
		cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
		time: { created: 1, updated: 1 },
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

async function renderSidebar(options: {
	sessions?: SessionInfo[];
	list?: (input: any) => Promise<{ data: SessionInfo[]; cursor: { next?: string | null } }>;
	sync?: (id: string) => Promise<void>;
	attentionSync?: (kind: "permission" | "form", id: string) => Promise<number>;
	remountOnNavigate?: boolean;
	animate?: boolean;
} = {}) {
	const data = options.sessions ?? [session("parent")];
	const [currentSessions, setSessions] = createSignal(data);
	const [statuses, setStatuses] = createSignal<Record<string, "idle" | "running">>({});
	const [permissions, setPermissions] = createSignal<Record<string, unknown[]>>({});
	const [forms, setForms] = createSignal<Record<string, unknown[]>>({});
	const [sessionID, setSessionID] = createSignal("parent");
	const events = new Map<string, Set<(event: any) => void>>();
	const calls: any[] = [];
	const navigations: any[] = [];
	const attentionCalls: string[] = [];
	const invalidations: string[] = [];
	const root = (id: string) => {
		let current = id;
		const seen = new Set<string>();
		while (!seen.has(current)) {
			seen.add(current);
			const parent = currentSessions().find((item) => item.id === current)?.parentID;
			if (!parent) break;
			current = parent;
		}
		return current;
	};
	const resource = (kind: "permission" | "form") => ({
		list: (id: string) => (kind === "permission" ? permissions() : forms())[id],
		sync: async (id: string) => {
			attentionCalls.push(`${kind}:${id}`);
			const count = await (options.attentionSync?.(kind, id) ?? Promise.resolve(0));
			const update = (previous: Record<string, unknown[]>) => ({ ...previous, [id]: Array(count).fill({}) });
			if (kind === "permission") setPermissions(update);
			else setForms(update);
		},
		invalidate: (id: string) => { invalidations.push(`${kind}:${id}`); },
	});
	let claim: { append: string; render: (props: { sessionID: string }) => unknown } | undefined;
	let unregisters = 0;
	const context = {
		options: { animate: options.animate },
		theme: { hue: { accent: { 200: "#00aaff" } }, text: { base: "#ffffff", muted: "#888888", feedback: { success: { base: "#00ff00" }, warning: { base: "#ffff00" }, error: { base: "#ff0000" } } } },
		client: { session: { list: async (input: any) => {
			calls.push(input);
			return options.list ? options.list(input) : { data: data.filter((item) => !item.parentID), cursor: {} };
		} } },
		data: {
			session: {
				list: currentSessions,
				get: (id: string) => currentSessions().find((item) => item.id === id),
				family: (id: string) => currentSessions().filter((item) => root(item.id) === root(id)).map((item) => item.id),
				status: (id: string) => statuses()[id] ?? "idle",
				sync: options.sync ?? (async () => {}),
				permission: resource("permission"),
				form: resource("form"),
			},
			on: (type: string, fn: (event: any) => void) => {
				const listeners = events.get(type) ?? new Set();
				listeners.add(fn);
				events.set(type, listeners);
				return () => { listeners.delete(fn); unregisters++; };
			},
		},
		ui: {
			slot: (value: typeof claim) => { claim = value; return () => {}; },
			router: { navigate: (destination: { sessionID: string }) => {
				navigations.push(destination);
				if (options.remountOnNavigate) setSessionID(destination.sessionID);
			} },
		},
	};
	plugin.setup(context as unknown as Context);
	if (!claim || claim.append !== "sidebar.content") throw new Error("missing appended sidebar slot");
	const render = claim.render;
	const setup = await testRender(() => options.remountOnNavigate
		? createComponent(Show, {
			get when() { return sessionID(); },
			keyed: true,
			children: (id: string) => render({ sessionID: id }),
		})
		: render({ get sessionID() { return sessionID(); } }), { width: 70, height: 28 });
	cleanup.push(() => setup.renderer.destroy());
	return {
		...setup, calls, navigations, attentionCalls, invalidations, setSessions, setStatuses, setPermissions, setForms, setSessionID,
		emit: (type: string, event?: any) => events.get(type)?.forEach((fn) => fn(event)),
		unregisters: () => unregisters,
		frame: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); await setup.renderOnce(); return setup.captureCharFrame(); },
	};
}

test("V2 renders a project-scoped, paginated sessions accordion and navigates", async () => {
	const sidebar = await renderSidebar({ sessions: [session("parent", "Current"), ...Array.from({ length: 16 }, (_, i) => session(`s${i + 1}`))] });
	let frame = await sidebar.frame();
	expect(frame).toContain("▶ Sessions");
	expect(sidebar.calls).toEqual([{ project: "project-1", parentID: null, archived: false, order: "desc", limit: 100 }]);
	await sidebar.mockMouse.click(2, 0);
	frame = await sidebar.frame();
	expect(frame).toContain("▼ Sessions");
	expect(frame).toContain("← 1/2 →");
	expect(frame).toContain("Current");
	expect(frame).not.toContain("Session s16");
	const header = frame.split("\n").find((line) => line.includes("▼ Sessions"))!;
	await sidebar.mockMouse.click(header.indexOf("→"), 0);
	frame = await sidebar.frame();
	expect(frame).toContain("← 2/2 →");
	expect(frame).toContain("Session s16");
	await sidebar.mockMouse.click(2, 2);
	expect(sidebar.navigations).toContainEqual({ type: "session", sessionID: "s16" });
});

test("V2 keeps the accordion state when navigating remounts the sidebar", async () => {
	const sidebar = await renderSidebar({
		sessions: [session("parent", "Current"), session("other", "Other")],
		remountOnNavigate: true,
	});
	expect(await sidebar.frame()).toContain("▶ Sessions");
	await sidebar.mockMouse.click(2, 0);
	expect(await sidebar.frame()).toContain("▼ Sessions");
	await sidebar.mockMouse.click(2, 2);
	const frame = await sidebar.frame();
	expect(sidebar.navigations).toContainEqual({ type: "session", sessionID: "other" });
	expect(sidebar.unregisters()).toBe(15);
	expect(frame).toContain("▼ Sessions");
	expect(frame).toContain("Other");

	await sidebar.mockMouse.click(2, 0);
	expect(await sidebar.frame()).toContain("▶ Sessions");
	sidebar.setSessionID("parent");
	expect(await sidebar.frame()).toContain("▶ Sessions");
});

test("V2 tracks only active child sessions and removes them when they finish", async () => {
	const parent = session("parent");
	const child = { ...session("child", "A long task description", "parent"), agent: "explore", model: { id: "provider/model", providerID: "provider", variant: "high" } };
	const sidebar = await renderSidebar({ sessions: [parent, child, session("other-child", "Other parent", "other")] });
	let frame = await sidebar.frame();
	expect(frame).not.toContain("Running Agents");
	sidebar.setStatuses({ child: "running", "other-child": "running" });
	frame = await sidebar.frame();
	expect(frame).toContain("Running Agents");
	expect(frame).toContain("A long task description");
	expect(frame).toContain("explore model:high");
	expect(frame).not.toContain("Other parent");
	sidebar.setPermissions({ child: [{}] });
	expect(await sidebar.frame()).toContain("! A long task description");
	await sidebar.mockMouse.click(2, 1);
	expect(sidebar.navigations).toContainEqual({ type: "session", sessionID: "child" });
	sidebar.setPermissions({});
	sidebar.setStatuses({ child: "idle" });
	frame = await sidebar.frame();
	expect(frame).not.toContain("Running Agents");
});

test("V2 shows live session activity and gives approvals and questions precedence", async () => {
	const failed = { ...session("failed", "Failed"), outcome: "failed" as const, time: { created: 1, updated: 2, idle: 2 } };
	const sidebar = await renderSidebar({ sessions: [session("parent", "Current"), session("other", "Other"), failed] });
	await sidebar.frame();
	await sidebar.mockMouse.click(2, 0);
	let frame = await sidebar.frame();
	expect(frame).toContain("○ Current");
	expect(frame).toContain("○ Other");
	expect(frame).toContain("× Failed");

	sidebar.setStatuses({ parent: "running", other: "running", failed: "running" });
	frame = await sidebar.frame();
	expect(frame).toContain("● Current");
	expect(frame).toContain("● Other");
	expect(frame).toContain("● Failed");

	sidebar.setForms({ parent: [{}], other: [{}] });
	sidebar.setPermissions({ parent: [{}] });
	frame = await sidebar.frame();
	expect(frame).toContain("! Current");
	expect(frame).toContain("? Other");
	sidebar.setPermissions({});
	expect(await sidebar.frame()).toContain("? Current");
	sidebar.setForms({});
	expect(await sidebar.frame()).toContain("● Current");
	sidebar.setStatuses({});
	expect(await sidebar.frame()).toContain("○ Current");
});

test("V2 refreshes the last execution result after failure and success", async () => {
	let outcome: "failed" | "succeeded" = "failed";
	let viewed: number | undefined;
	const sidebar = await renderSidebar({ list: async () => ({
		data: [{ ...session("parent", "Current"), outcome, time: { created: 1, updated: 2, idle: 2, viewed } }],
		cursor: {},
	}) });
	await sidebar.frame();
	await sidebar.mockMouse.click(2, 0);
	expect(await sidebar.frame()).toContain("× Current");
	sidebar.setStatuses({ parent: "running" });
	expect(await sidebar.frame()).toContain("● Current");
	outcome = "succeeded";
	sidebar.setStatuses({});
	sidebar.emit("session.execution.succeeded");
	await new Promise((resolve) => setTimeout(resolve, 200));
	expect(await sidebar.frame()).toContain("◆ Current");
	viewed = 2;
	sidebar.emit("session.viewed");
	await new Promise((resolve) => setTimeout(resolve, 200));
	expect(await sidebar.frame()).toContain("○ Current");
});

test("V2 uses the newest viewed watermark even when cached and listed idle times match", async () => {
	const other = { ...session("other", "Other"), time: { created: 1, updated: 10, idle: 10, viewed: 5 } };
	const sidebar = await renderSidebar({ sessions: [session("parent", "Current"), other] });
	await sidebar.frame();
	await sidebar.mockMouse.click(2, 0);
	expect(await sidebar.frame()).toContain("◆ Other");
	sidebar.setSessions([session("parent", "Current"), { ...other, time: { ...other.time, viewed: 10 } }]);
	expect(await sidebar.frame()).toContain("○ Other");
	sidebar.setSessions([session("parent", "Current"), { ...other, outcome: "failed", time: { ...other.time, idle: 11, viewed: 10 } }]);
	expect(await sidebar.frame()).toContain("× Other");
	sidebar.setSessions([session("parent", "Current"), { ...other, outcome: "failed", time: { ...other.time, idle: 11, viewed: 11 } }]);
	expect(await sidebar.frame()).toContain("○ Other");
});

test("V2 includes known active descendants in their root's status", async () => {
	const sidebar = await renderSidebar({ sessions: [
		session("parent", "Current"), session("other", "Other"),
		session("child", "Child", "other"), session("grandchild", "Grandchild", "child"),
	] });
	await sidebar.frame();
	await sidebar.mockMouse.click(2, 0);
	sidebar.setStatuses({ grandchild: "running" });
	expect(await sidebar.frame()).toContain("● Other");
	expect(sidebar.attentionCalls).toContain("form:grandchild");
	sidebar.setForms({ grandchild: [{}] });
	expect(await sidebar.frame()).toContain("? Other");
	sidebar.setPermissions({ child: [{}] });
	expect(await sidebar.frame()).toContain("! Other");
	sidebar.setForms({});
	sidebar.setPermissions({});
	sidebar.setStatuses({});
	expect(await sidebar.frame()).toContain("○ Other");
});

test("V2 blinks working indicators and can disable animation", async () => {
	const sidebar = await renderSidebar();
	await sidebar.frame();
	await sidebar.mockMouse.click(2, 0);
	sidebar.setStatuses({ parent: "running" });
	await sidebar.frame();
	const color = () => sidebar.captureSpans().lines.flatMap((line) => line.spans)
		.find((span) => span.text.includes("●"))!.fg.toInts();
	const first = color();
	await new Promise((resolve) => setTimeout(resolve, 750));
	await sidebar.frame();
	expect(color()).not.toEqual(first);
	await new Promise((resolve) => setTimeout(resolve, 700));
	await sidebar.frame();
	expect(color()).toEqual(first);

	const still = await renderSidebar({ animate: false });
	await still.frame();
	await still.mockMouse.click(2, 0);
	still.setStatuses({ parent: "running" });
	await still.frame();
	const stillColor = () => still.captureSpans().lines.flatMap((line) => line.spans)
		.find((span) => span.text.includes("●"))!.fg.toInts();
	const steady = stillColor();
	await new Promise((resolve) => setTimeout(resolve, 750));
	await still.frame();
	expect(stillColor()).toEqual(steady);
});

test("V2 hydrates visible rows and active agents without fetching every session", async () => {
	const sidebar = await renderSidebar({
		sessions: [session("parent", "Current"), ...Array.from({ length: 16 }, (_, i) => session(`s${i + 1}`)), session("child", "Child", "parent")],
		attentionSync: async (kind, id) => kind === "form" && id === "s16" ? 1 : 0,
	});
	sidebar.setStatuses({ child: "running" });
	let frame = await sidebar.frame();
	expect(frame).toContain("● Child");
	expect(sidebar.attentionCalls).toEqual(["permission:child", "form:child"]);
	await sidebar.mockMouse.click(2, 3);
	frame = await sidebar.frame();
	expect(sidebar.attentionCalls).toContain("permission:parent");
	expect(sidebar.attentionCalls).not.toContain("form:s16");
	const lines = frame.split("\n");
	const header = lines.findIndex((line) => line.includes("▼ Sessions"));
	await sidebar.mockMouse.click(lines[header].indexOf("→"), header);
	frame = await sidebar.frame();
	expect(sidebar.attentionCalls).toContain("form:s16");
	expect(frame).toContain("? Session s16");
});

test("V2 revalidates a pending attention read if an event overtakes it", async () => {
	const first = deferred<number>();
	const second = deferred<number>();
	let permissionReads = 0;
	const sidebar = await renderSidebar({ attentionSync: (kind, id) => {
		if (kind !== "permission" || id !== "parent") return Promise.resolve(0);
		return ++permissionReads === 1 ? first.promise : second.promise;
	} });
	await sidebar.frame();
	await sidebar.mockMouse.click(2, 0);
	expect(await sidebar.frame()).toContain("· Session parent");
	sidebar.setPermissions({ parent: [{}] });
	sidebar.emit("permission.asked", { data: { sessionID: "parent" } });
	expect(await sidebar.frame()).toContain("! Session parent");
	expect(sidebar.invalidations).toContain("permission:parent");
	expect(permissionReads).toBe(2);
	first.resolve(0);
	await sidebar.frame();
	second.resolve(1);
	expect(await sidebar.frame()).toContain("! Session parent");
});

test("V2 marks failed attention reads unknown and retries after reconnect", async () => {
	let connected = false;
	const sidebar = await renderSidebar({ attentionSync: async (kind) => {
		if (kind === "form" && !connected) throw new Error("unavailable");
		return kind === "form" ? 1 : 0;
	} });
	await sidebar.frame();
	await sidebar.mockMouse.click(2, 0);
	expect(await sidebar.frame()).toContain("· Session parent");
	connected = true;
	sidebar.emit("server.connected");
	expect(await sidebar.frame()).toContain("? Session parent");
	expect(sidebar.invalidations).toContain("form:parent");
});

test("V2 follows server cursors and ignores stale requests", async () => {
	const first = deferred<{ data: SessionInfo[]; cursor: { next?: string } }>();
	let count = 0;
	const sidebar = await renderSidebar({ list: async (input) => {
		count++;
		if (count === 1) return first.promise;
		if (input.cursor) return { data: [session("later", "Second page")], cursor: {} };
		return { data: [session("parent", "Newest")], cursor: { next: "next-page" } };
	} });
	await sidebar.frame();
	sidebar.emit("session.created");
	await new Promise((resolve) => setTimeout(resolve, 200));
	first.resolve({ data: [session("old", "Stale")], cursor: {} });
	await sidebar.mockMouse.click(2, 0);
	const frame = await sidebar.frame();
	expect(frame).toContain("Newest");
	expect(frame).toContain("Second page");
	expect(frame).not.toContain("Stale");
	expect(sidebar.calls[2]).toEqual({ cursor: "next-page", limit: 100 });
});

test("V2 reports list errors and unregisters event listeners on cleanup", async () => {
	const sidebar = await renderSidebar({ list: async () => { throw new Error("unavailable"); } });
	await sidebar.frame();
	await sidebar.mockMouse.click(2, 0);
	expect(await sidebar.frame()).toContain("Unable to load sessions");
	sidebar.renderer.destroy();
	expect(sidebar.unregisters()).toBe(15);
});

test("V2 ignores a previous project's response while the new session hydrates", async () => {
	const old = deferred<{ data: SessionInfo[]; cursor: { next?: string } }>();
	const next = { ...session("new", "New project"), projectID: "project-2" };
	const sidebar = await renderSidebar({ list: async (input) =>
		input.project === "project-1" ? old.promise : { data: [next], cursor: {} },
	});
	sidebar.setSessionID("new");
	old.resolve({ data: [session("old", "Wrong project")], cursor: { next: "old-cursor" } });
	await sidebar.frame();
	expect(sidebar.calls.some((call) => call.cursor === "old-cursor")).toBe(false);
	sidebar.setSessions([next]);
	await sidebar.frame();
	await sidebar.mockMouse.click(2, 0);
	const frame = await sidebar.frame();
	expect(frame).toContain("New project");
	expect(frame).not.toContain("Wrong project");
});

test("V2 stops when the server repeats a pagination cursor", async () => {
	const sidebar = await renderSidebar({ list: async () => ({ data: [], cursor: { next: "repeat" } }) });
	await sidebar.frame();
	await sidebar.mockMouse.click(2, 0);
	expect(await sidebar.frame()).toContain("Unable to load sessions");
	expect(sidebar.calls).toHaveLength(2);
});

test("V2 refreshes sessions after reconnecting", async () => {
	let version = 0;
	const sidebar = await renderSidebar({ list: async () => ({ data: [session("parent", `Version ${++version}`)], cursor: {} }) });
	await sidebar.frame();
	await sidebar.mockMouse.click(2, 0);
	expect(await sidebar.frame()).toContain("Version 1");
	sidebar.emit("server.connected");
	await new Promise((resolve) => setTimeout(resolve, 200));
	expect(await sidebar.frame()).toContain("Version 2");
});
