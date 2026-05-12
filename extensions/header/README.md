# pi-header

Private custom startup header for Pi.

## Behavior

This extension replaces Pi's built-in header on `session_start` with a compact centered panel.

It renders:

- A centered `π` mark
- Tool, extension, prompt, and context-file counts
- Starter command hints
- A two-column layout on wide terminals
- A stacked layout on narrow terminals

## Local usage

This extension is loaded from this setup repository through the root Pi package manifest:

```json
{
  "pi": {
    "extensions": ["./extensions"]
  }
}
```

For a quick manual test, run:

```bash
pi -e ./extensions/header/index.ts
```

## Pi APIs used

- `ctx.ui.setHeader()`
- `pi.getAllTools()`
- `pi.getActiveTools()`
- `pi.getCommands()`
- `ctx.getSystemPrompt()`

## Notes

- This package is private and is not prepared for npm publishing.
- The header is only installed when Pi has an interactive UI.
- The extension clears its custom header during session shutdown.
