# Installation Guide

Install `opencode-sidebar-background-sessions` as an OpenCode TUI plugin.

## Goal

Configure OpenCode so the TUI sidebar shows a `Running Agents` section while background task agents are active.

## Important

This package is a TUI plugin, not a server plugin.

- Use your TUI config file:
  - **macOS / Linux**: `~/.config/opencode/tui.json`
  - **Windows**: `%APPDATA%\opencode\tui.json`
- Do not add this package to `~/.config/opencode/opencode.json`.
- Do not use `opencode plugin -g opencode-sidebar-background-sessions` if that command writes to `opencode.json` in the installed OpenCode version.

## Steps

1. Verify OpenCode is installed:

   ```bash
   opencode --version
   ```

2. Open or create your TUI config file:
   - **macOS / Linux**: `~/.config/opencode/tui.json`
   - **Windows**: `%APPDATA%\opencode\tui.json`

3. Install the package into your OpenCode config directory:

   ```bash
   cd ~/.config/opencode
   bun add opencode-sidebar-background-sessions
   ```

   If Bun reports peer dependency warnings for `@opencode-ai/plugin` or `@opencode-ai/sdk`, install versions that match your OpenCode binary:

   ```bash
   opencode --version
   bun add @opencode-ai/plugin@<opencode-version> @opencode-ai/sdk@<opencode-version>
   ```

4. Ensure `tui.json` has the TUI schema and a `plugin` array pointing at the installed package directory.

   Minimal config:

   ```jsonc
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": ["./node_modules/opencode-sidebar-background-sessions"],
   }
   ```

   If `plugin` already exists, append the package path without removing existing plugins.

5. Ensure `~/.config/opencode/opencode.json` does **not** list `opencode-sidebar-background-sessions` in its `plugin` array. This package is TUI-only and should load from `tui.json`, not the server plugin config.

6. Restart OpenCode.

7. Start any background task agent. The sidebar should show `Running Agents` above the normal sidebar content.

## Local development install

When installing from a local checkout instead of npm:

```bash
bun install
bun run build
```

Then add the package root to your TUI config (opencode resolves the `./tui` export from `package.json`):

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/opencode-sidebar-background-sessions"],
}
```

## Validation

After editing `tui.json`:

1. Run `opencode`.
2. Launch a background task/sub-agent.
3. Confirm `Running Agents` appears in the sidebar.
4. Confirm long task titles wrap instead of clipping.
