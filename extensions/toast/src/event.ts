import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ToastShowEvent } from "./types.js";
import { showToast } from "./api.js";

/**
 * Register the `toast:show` event bus listener.
 *
 * Other extensions can trigger toasts without a direct import:
 *
 * ```ts
 * pi.events.emit("toast:show", { message: "Hello!", variant: "success" });
 * ```
 *
 * Must be called during `session_start` so an active `ExtensionContext` is available.
 */
export const registerToastEvent = (pi: ExtensionAPI, ctx: ExtensionContext): void => {
  const handler = (data: unknown): void => {
    try {
      const payload = data as ToastShowEvent;

      if (payload === undefined || payload === null || typeof payload.message !== "string") {
        console.warn("[pi-toast] Ignored invalid toast:show event payload", data);
        return;
      }

      // Fire-and-forget: the toast lifecycle is self-contained.
      showToast(ctx, payload).catch((error: unknown) => {
        console.error(`[pi-toast] Event-triggered toast failed: ${(error as Error).message}`);
      });
    } catch (error) {
      console.error(`[pi-toast] Event handler error: ${(error as Error).message}`);
    }
  };

  pi.events.on("toast:show", handler);
};
