# Installation Guide

Install `opencode-sidebar-background-sessions` as an OpenCode TUI plugin.

## Goal

Configure OpenCode so the TUI sidebar shows a `Running Agents` section while background task agents are active.

## Important

This package is a TUI plugin, not a server plugin.

- Use `~/.config/opencode/tui.json`.
- Do not add this package to `~/.config/opencode/opencode.json`.
- Do not use `opencode plugin -g opencode-sidebar-background-sessions` if that command writes to `opencode.json` in the installed OpenCode version.

## Steps

1. Verify OpenCode is installed:

   ```bash
   opencode --version
   ```

2. Open or create `~/.config/opencode/tui.json`.

3. Ensure the file has the TUI schema and a `plugin` array containing `opencode-sidebar-background-sessions`.

   Minimal config:

   ```jsonc
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": ["opencode-sidebar-background-sessions"]
   }
   ```

   If `plugin` already exists, append the package name without removing existing plugins.

4. Leave `~/.config/opencode/opencode.json` unchanged unless another unrelated task requires it.

5. Restart OpenCode.

6. Start any background task agent. The sidebar should show `Running Agents` above the normal sidebar content.

## Local development install

When installing from a local checkout instead of npm:

```bash
bun install
bun run build
```

Then add the built file path to `~/.config/opencode/tui.json`:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "/absolute/path/to/opencode-sidebar-background-sessions/dist/index.js"
  ]
}
```

## Validation

After editing `tui.json`:

1. Run `opencode`.
2. Launch a background task/sub-agent.
3. Confirm `Running Agents` appears in the sidebar.
4. Confirm long task titles wrap instead of clipping.
