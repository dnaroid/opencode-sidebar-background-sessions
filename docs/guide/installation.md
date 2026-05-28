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

   The npm package includes the pre-built `dist/` files. End users should not need to clone this repository or run `bun run build` when installing from npm.

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

## Automatic updates

When installed from npm under `~/.config/opencode/node_modules`, the plugin checks the npm registry on OpenCode startup. If a newer version exists, it runs this command in the OpenCode config directory:

```bash
bun add opencode-sidebar-background-sessions@latest
```

The currently running TUI keeps the old plugin bundle loaded. After the update finishes, restart OpenCode when the sidebar shows the update notice.

Disable automatic updates by setting:

```bash
OPENCODE_SIDEBAR_BACKGROUND_SESSIONS_AUTO_UPDATE=0
```

## Troubleshooting missing `dist/`

If OpenCode reports that `dist/index.js` is missing, the installed package is incomplete or stale. Reinstall the latest npm package first:

```bash
cd ~/.config/opencode
bun remove opencode-sidebar-background-sessions
bun add opencode-sidebar-background-sessions@latest
test -f node_modules/opencode-sidebar-background-sessions/dist/index.js
```

Only build from source as a temporary workaround for a broken local checkout or a broken npm publish:

```bash
git clone https://github.com/dnaroid/opencode-sidebar-background-sessions.git /tmp/opencode-sidebar-bg-build
cd /tmp/opencode-sidebar-bg-build
bun install
bun run build
cp -R dist ~/.config/opencode/node_modules/opencode-sidebar-background-sessions/
rm -rf /tmp/opencode-sidebar-bg-build
```

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
