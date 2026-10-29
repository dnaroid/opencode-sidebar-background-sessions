# Installation Guide

Install `opencode-sidebar-background-sessions` as an OpenCode TUI plugin. Preserve unrelated settings and existing plugins when editing configuration.

Check your OpenCode version first:

```bash
opencode --version
```

## OpenCode V2

V2 support requires a release containing this port. The published npm package `0.5.0` supports V1 only. Until a V2-compatible release is published, use the local checkout below.

For a V2-compatible release, add the package to the global TUI configuration at `~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`):

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["opencode-sidebar-background-sessions"]
}
```

This is a TUI-only plugin. Do not add it to the server's `opencode.json`. Valid changes to `cli.json` reload automatically.

## OpenCode V1

Install the package into the OpenCode config directory:

```bash
cd ~/.config/opencode
bun add opencode-sidebar-background-sessions
```

Add the installed package to `~/.config/opencode/tui.json` on macOS/Linux or `%APPDATA%\opencode\tui.json` on Windows:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["./node_modules/opencode-sidebar-background-sessions"]
}
```

Restart the V1 TUI after installing. Do not use `opencode plugin -g` if it writes to the server plugin configuration instead of `tui.json`.

## Local development install

Clone the repository, then build it:

```bash
git clone https://github.com/dnaroid/opencode-sidebar-background-sessions.git
cd opencode-sidebar-background-sessions
bun install
bun run build
```

Add the absolute checkout directory to the appropriate config. For V2:

```jsonc
// ~/.config/opencode/cli.json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/opencode-sidebar-background-sessions"]
}
```

For V1, use `tui.json` and the `plugin` array instead. Rebuild after changing the source. Use `/reload` in V2 if needed to load the rebuilt bundle.

## Updates

The V1 plugin checks npm for updates only when installed under the OpenCode config directory's `node_modules`. Set `OPENCODE_SIDEBAR_BACKGROUND_SESSIONS_AUTO_UPDATE=0` to disable this behavior. Restart V1 after an update.

V2 does not run this self-updater. Update the package through OpenCode or rebuild the local checkout.

## Validation

1. Open an existing session in a sufficiently wide terminal with the sidebar enabled.
2. Expand `Sessions` and confirm the current project's sessions appear.
3. Start a subagent and confirm `Running Agents` appears while it runs and disappears when it finishes. V2 shows both foreground and background active child sessions.
4. Click a session or agent row to navigate to it. Long titles should wrap.

If a local checkout reports a missing `dist/index.js`, run `bun install` and `bun run build` in the checkout, then reload the plugin.
