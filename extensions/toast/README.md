<div align="left">
  <img src="https://raw.githubusercontent.com/santychuy/pi-setup/main/.github/assets/santychuyISO.png" alt="santychuyISO" width="120" style="vertical-align: middle; margin-bottom: 16px;" />
</div>

# pi-toast

Ephemeral toast overlays for the Pi TUI. Shows a short message at a fixed terminal position and automatically dismisses it after a timeout.

## Install

### Global

```bash
pi install npm:pi-toast
```

### Project-local

```bash
pi install -l npm:pi-toast
```

## Usage

### Interactive command

```text
/toast Hello from Pi Toast
/toast --type success Saved successfully
/toast --type warning --position bottom-right Check your config
/toast --duration 5000 This stays for five seconds
```

### LLM tool

The LLM can trigger toasts via the `show_toast` tool. This is useful when the agent wants to draw attention to something.

### Programmatic API (other extensions)

**Direct import:**

```ts
import { showToast } from "./relative/path/to/toast/index.ts";

// Simple string message
await showToast(ctx, "Processing complete");

// With options
await showToast(ctx, {
  message: "Build succeeded!",
  variant: "success",
  durationMs: 3000,
  position: "top-right",
});
```

**Event bus** (no direct import needed):

```ts
pi.events.emit("toast:show", {
  message: "Operation complete",
  variant: "success",
  // durationMs, position, width are optional
});
```

## Command

`/toast [options] message`

Options:

| Option                        | Values                                | Default     |
| ----------------------------- | ------------------------------------- | ----------- |
| `--type`, `--variant`         | `info`, `success`, `warning`, `error` | `info`      |
| `--position`, `--pos`         | `top-right`, `bottom-right`           | `top-right` |
| `--duration`, `--duration-ms` | milliseconds                          | `2500`      |
| `--width`                     | columns, clamped 20–80                | `26`        |

## Scope

- Single toast overlay
- Themed border and icon
- Auto dismiss
- Position via Pi overlay anchors
- `top-right` slides from right to left
- `bottom-right` appears close above the input area and reveals from bottom to top
- Safe truncation for narrow terminals
- **Programmatic API:** direct import (`showToast`), event bus (`toast:show`), and LLM tool (`show_toast`)

## How It Works

Pi Toast uses Pi's built-in overlay API:

```ts
ctx.ui.custom(component, {
  overlay: true,
  overlayOptions: { anchor: "top-right" },
});
```

This keeps the implementation inside Pi's renderer instead of writing raw ANSI escape sequences directly to stdout.

## Links

- [Source](https://github.com/santychuy/pi-setup/tree/main/extensions/toast)
- [Issues](https://github.com/santychuy/pi-setup/issues)
