# Pi Modes

Private Pi extension that adds a simple default/plan mode switcher.

## Modes

- **default**: restores the tool set that was active when the session started.
- **plan**: read-only planning and research mode.

## Switching

- `Alt+M`: cycle between default and plan mode.
- `Ctrl+Shift+M`: fallback cycle shortcut.

## Plan mode tools

Plan mode enables only tools that are present in the session from this allowlist:

- `read`
- `grep`
- `find`
- `ls`
- `web_search`
- `fetch_content`

All other tools are blocked as a safety backstop. This intentionally disables `bash`, `edit`, `write`, and process-management tools.

## Behavior

Plan mode injects instructions that keep the agent in read-only planning mode, encourage local codebase exploration with read/search/list tools, and require web tools for current or external research.

The editor border changes to the accent color and a small `mode: plan` status appears while plan mode is active.
