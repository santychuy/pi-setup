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
} from "./src/types.js";
import { DEFAULT_TOAST_OPTIONS } from "./src/constants.js";
import { showToast } from "./src/api.js";
import { handleToastCommand, TOAST_COMMAND_DESCRIPTION } from "./src/command.js";
import { registerToastTool } from "./src/tool.js";
import { registerToastEvent } from "./src/event.js";

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
