import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type {
  ToastOptions,
  ToastInput,
  ToastShowEvent,
  ToastVariant,
  ToastPosition,
} from "./src/types";
import { DEFAULT_TOAST_OPTIONS } from "./src/constants";
import { showToast } from "./src/api";
import { handleToastCommand, TOAST_COMMAND_DESCRIPTION } from "./src/command";
import { registerToastTool } from "./src/tool";
import { registerToastEvent } from "./src/event";

// ─── Re-exports ─────────────────────────────────────────────────────────────

export type { ToastVariant, ToastPosition, ToastOptions, ToastInput, ToastShowEvent };
export { DEFAULT_TOAST_OPTIONS };
export { showToast };

// ─── Extension Entry Point ──────────────────────────────────────────────────

export default (pi: ExtensionAPI): void => {
  // ── Command: /toast ────────────────────────────────────────────────────
  pi.registerCommand("toast", {
    description: TOAST_COMMAND_DESCRIPTION,
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      await handleToastCommand(args, ctx);
    },
  });

  // ── Event bus listener: toast:show ─────────────────────────────────────
  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    registerToastEvent(pi, ctx);
  });

  // ── LLM tool: show_toast ──────────────────────────────────────────────
  registerToastTool(pi);
};
