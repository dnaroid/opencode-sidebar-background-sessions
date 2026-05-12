/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Part } from "@opencode-ai/sdk/v2";
import { createMemo, For, Show } from "solid-js";

const id = "opencode-sidebar-background-sessions";

type TaskItem = {
	sessionID: string;
	title: string;
	subagent?: string;
	modelID?: string;
};

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

function partModelID(part: Part) {
	if (part.type !== "tool") return;
	if (part.state.status === "pending") return;
	if (!part.state.metadata) return;
	if (
		!part.state.metadata.model ||
		typeof part.state.metadata.model !== "object"
	)
		return;
	if (
		!("modelID" in part.state.metadata.model) ||
		typeof part.state.metadata.model.modelID !== "string"
	)
		return;
	return part.state.metadata.model.modelID;
}

function taskMetaLine(item: TaskItem) {
	return [item.subagent, item.modelID].filter(Boolean).join(" ");
}

function taskItem(
	part: Part,
	completedBackgroundTaskIDs: Set<string>,
): TaskItem | undefined {
	if (part.type !== "tool") return;
	if (part.tool !== "task") return;
	const sessionID = partMetadataString(part, "sessionId");
	if (!sessionID) return;

	if (part.state.status === "completed") {
		const backgroundTaskID = partMetadataString(part, "backgroundTaskId");
		if (!backgroundTaskID) return;
		if (completedBackgroundTaskIDs.has(backgroundTaskID)) return;
	}

	if (part.state.status !== "running" && part.state.status !== "completed")
		return;

	return {
		sessionID,
		title:
			part.state.title ?? partInputString(part, "description") ?? sessionID,
		subagent: partInputString(part, "subagent_type"),
		modelID: partModelID(part),
	};
}

function View(props: { api: TuiPluginApi; session_id: string }) {
	const theme = () => props.api.theme.current;
	const parts = createMemo(() =>
		props.api.state.session
			.messages(props.session_id)
			.flatMap((message) => props.api.state.part(message.id)),
	);
	const list = createMemo(() => {
		const completedBackgroundTaskIDs = new Set(
			parts()
				.filter(
					(part) =>
						part.type === "tool" &&
						part.tool === "background_output" &&
						part.state.status !== "running",
				)
				.map((part) => partMetadataString(part, "backgroundTaskId"))
				.filter((backgroundTaskID) => backgroundTaskID !== undefined),
		);
		return parts()
			.map((part) => taskItem(part, completedBackgroundTaskIDs))
			.filter((item): item is TaskItem => item !== undefined)
			.reverse();
	});

	return (
		<Show when={list().length > 0}>
			<box>
				<box flexDirection="row" gap={1}>
					<text fg={theme().text}>
						<b>Running Agents</b>
					</text>
				</box>
				<For each={list()}>
					{(item) => {
						const metaLine = taskMetaLine(item);
						return (
							<box>
								<box flexDirection="row" gap={1}>
									<text fg={theme().success}>•</text>
									<text fg={theme().warning} wrapMode="none" flexGrow={1}>
										{displayTitle(item.title)}
									</text>
								</box>
								<Show when={metaLine}>
									<text fg={theme().textMuted} wrapMode="none">
										{"  "}
										{metaLine}
									</text>
								</Show>
							</box>
						);
					}}
				</For>
			</box>
		</Show>
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
