# Pi Toast Design Notes

## Goal

Provide a small, publishable Pi extension that displays temporary toast messages inside the TUI.

## Rendering Strategy

Use Pi overlays rather than raw ANSI writes:

- Pi controls redraws, resize behavior, and input focus.
- The toast does not fight Pi's terminal renderer.
- Overlay anchors provide positioning without manual cursor math.

## MVP Decisions

- One toast per command invocation.
- Auto-dismiss via `setTimeout(done, durationMs)`.
- No keyboard handling; the toast should not be interactive.
- Width is fixed by overlay options and content is truncated with `truncateToWidth`.
- Uses Pi theme colors for variant styling.
- Supported positions are intentionally limited to `top-right` and `bottom-right`.
- `top-right` uses horizontal right-to-left slide animation.
- `bottom-right` is offset above the input area and uses bottom-to-top reveal animation.

## Public API

The extension exposes three ways to trigger toats programmatically:

### 1. Direct import

Extensions can import the `showToast()` function directly:

```ts
import { showToast } from "path/to/extensions/toast/index.ts";

await showToast(ctx, "Hello!");
await showToast(ctx, { message: "Done!", variant: "success" });
```

### 2. Event bus (`pi.events`)

Extensions can emit a `toast:show` event without a direct import:

```ts
pi.events.emit("toast:show", {
  message: "Operation complete",
  variant: "success",
  durationMs: 3000,
});
```

The event handler captures `ExtensionContext` at `session_start` time, so the emitter does not need one.

### 3. LLM tool (`show_toast`)

The LLM can trigger toasts via the registered tool. Parameters mirror `ToastInput` with `message` required and `variant`, `durationMs`, `position` optional.

### 4. Extension command (`/toast`)

Same as before, for interactive use.

## Exported Types

- `ToastVariant` — `"info" | "success" | "warning" | "error"`
- `ToastPosition` — `"top-right" | "bottom-right"`
- `ToastOptions` — Full options interface
- `ToastInput` — Input type with sensible defaults (all fields except `message` optional)
- `ToastShowEvent` — Payload type for the `toast:show` event
- `DEFAULT_TOAST_OPTIONS` — Default values constant

## Future Ideas

- Toast queue/stack manager.
- Animations or fade-like frame changes.
- Optional persistent toast with manual dismissal.
- Multi-line description support.
