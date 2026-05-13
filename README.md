# opencode-sidebar-background-sessions

OpenCode TUI plugin that shows running background sub-agents in the session sidebar.

It adds a `Running Agents` section above the normal sidebar content and lists background task agents while their sub-agent session is still busy. As a fallback, completed task entries are also removed once their matching `background_output` is collected.

![demo](demo.png)

## Install

This is an OpenCode TUI plugin. It belongs in `tui.json`, not `opencode.json`.

Use OpenCode's plugin installer:

```bash
opencode plugin -g opencode-sidebar-background-sessions
```

If you install manually, add the package to `~/.config/opencode/tui.json`:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-sidebar-background-sessions"]
}
```

Restart OpenCode after installing. When background task agents are running, the sidebar shows a `Running Agents` section above the normal sidebar content.

## LLM installation task

Give this to an LLM/agent when you want it to install the plugin for you:

```text
Install the npm package `opencode-sidebar-background-sessions` as an OpenCode TUI plugin.

Important: this is a TUI plugin, not a server plugin. Configure it in `~/.config/opencode/tui.json`, not `opencode.json`.

Steps:
1. Run `opencode plugin -g opencode-sidebar-background-sessions` if the OpenCode CLI supports plugin installation.
2. Verify `~/.config/opencode/tui.json` contains `"plugin": ["opencode-sidebar-background-sessions"]` or add the package name to the existing `plugin` array without removing other plugins.
3. Do not add it to `~/.config/opencode/opencode.json`.
4. Restart OpenCode and confirm the sidebar shows `Running Agents` when background task agents are active.
```

## Local development install

From this package directory:

```bash
bun install
bun run build
```

Then point OpenCode at the built module:

```jsonc
// ~/.config/opencode/tui.json
{
  "plugin": [
    "/absolute/path/to/opencode-sidebar-background-sessions/dist/index.js",
  ],
}
```

## Notes

- This is a TUI plugin, so it is configured in `tui.json`, not `opencode.json`.
- The normal OpenCode Status dialog lists server plugins; TUI plugins may not appear there.
- The plugin intentionally does not mutate session titles. It reads the current TUI session state and renders only in the sidebar.

## Publish

Run:

```bash
bun install
bun run typecheck
bun run build
npm publish --access public
```
