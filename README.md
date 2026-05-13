# opencode-sidebar-background-sessions

OpenCode TUI plugin that shows running background sub-agents in the session sidebar.

It adds a `Running Agents` section above the normal sidebar content and lists background task agents while their sub-agent session is still busy. As a fallback, completed task entries are also removed once their matching `background_output` is collected.

![demo](demo.png)

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

Before publishing, replace the placeholder GitHub URLs in `package.json`, then run:

```bash
bun install
bun run typecheck
bun run build
npm publish --access public
```
