import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ToastOptions, ToastInput } from "./types.js";
import { DEFAULT_TOAST_OPTIONS, ANIMATION, WIDTH } from "./constants.js";
import { createToastComponent } from "./component.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const clampWidth = (w: number): number => Math.max(WIDTH.min, Math.min(WIDTH.max, Math.floor(w)));

/** Resolve a string-or-object input into fully-qualified ToastOptions. */
export const resolveOptions = (input: string | ToastInput): ToastOptions => {
  const partial = typeof input === "string" ? { message: input } : input;
  return {
    ...DEFAULT_TOAST_OPTIONS,
    ...partial,
    width: clampWidth(partial.width ?? DEFAULT_TOAST_OPTIONS.width),
  };
};

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Show a toast notification in the TUI.
 *
 * Call this from any extension that has access to an `ExtensionContext`:
 *
 * ```ts
 * import { showToast } from "./path/to/toast/src/api";
 *
 * await showToast(ctx, { message: "Hello!", variant: "success" });
 * ```
 *
 * Accepts a plain string (message only) or a `ToastInput` object.
 * Throws on overlay rendering failures.
 */
export const showToast = async (
  ctx: ExtensionContext,
  input: string | ToastInput,
): Promise<void> => {
  const options = resolveOptions(input);

  try {
    await ctx.ui.custom<void>(
      (tui, theme, _keybindings, done) => {
        const toast = createToastComponent(options, theme);
        const { maxFrame, frameMs } = ANIMATION;
        let frame = 0;

        // ── Animate in ──────────────────────────────────────────────────────
        const animateIn = setInterval(() => {
          frame += 1;
          toast.setAnimation("in", frame);
          tui.requestRender();

          if (frame >= maxFrame) {
            clearInterval(animateIn);
            toast.setAnimation("hold", 0);
            tui.requestRender();
          }
        }, frameMs);
        animateIn.unref?.();

        // ── Hold + animate out ─────────────────────────────────────────────
        const holdTimer = setTimeout(() => {
          frame = 0;

          const animateOut = setInterval(() => {
            frame += 1;
            toast.setAnimation("out", frame);
            tui.requestRender();

            if (frame >= maxFrame) {
              clearInterval(animateOut);
              done(undefined);
            }
          }, frameMs);
          animateOut.unref?.();
        }, options.durationMs);
        holdTimer.unref?.();

        return toast;
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: options.position,
          width: options.width,
          minWidth: WIDTH.min,
          offsetX: 0,
          offsetY: options.position === "bottom-right" ? -3 : 1,
          visible: (termWidth: number, termHeight: number) => termWidth >= 30 && termHeight >= 8,
        },
      },
    );
  } catch (error) {
    // Swallow overlay failures silently — the TUI may not support overlays
    // in the current mode (e.g. print/JSON mode).
    if (typeof error === "object" && error !== null && "message" in error) {
      const msg = (error as Error).message;
      // Only log non-trivial failures
      if (!msg.includes("overlay") && !msg.includes("no UI")) {
        console.error(`[pi-toast] showToast failed: ${msg}`);
      }
    }
  }
};
