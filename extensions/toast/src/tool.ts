import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ToastVariant, ToastPosition } from "./types.js";
import { showToast } from "./api.js";

/**
 * Register the `show_toast` LLM tool.
 *
 * The tool lets the agent display temporary notification toasts in the TUI.
 */
export const registerToastTool = (pi: ExtensionAPI): void => {
  pi.registerTool({
    name: "show_toast",
    label: "Show Toast",
    description:
      "Display a temporary notification toast in the terminal UI. " +
      "Use this to highlight important information, success messages, warnings, or errors to the user.",
    promptSnippet: "Display a temporary toast notification in the terminal UI",
    promptGuidelines: [
      "Use show_toast to draw attention to important information, confirmations, warnings, or errors instead of burying them in text.",
    ],
    parameters: Type.Object({
      message: Type.String({ description: "The toast message to display" }),
      variant: Type.Optional(
        Type.Union([
          Type.Literal("info"),
          Type.Literal("success"),
          Type.Literal("warning"),
          Type.Literal("error"),
        ]),
      ),
      durationMs: Type.Optional(
        Type.Number({ description: "How long to show in milliseconds (default 2500)" }),
      ),
      position: Type.Optional(
        Type.Union([Type.Literal("top-right"), Type.Literal("bottom-right")]),
      ),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) => {
      try {
        await showToast(ctx, {
          message: params.message,
          variant: params.variant as ToastVariant | undefined,
          durationMs: params.durationMs,
          position: params.position as ToastPosition | undefined,
        });

        return {
          content: [{ type: "text", text: `Toast displayed: "${params.message}"` }],
          details: { variant: params.variant ?? "info" },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to show toast: ${(error as Error).message}` }],
          details: { error: true, variant: "error" },
        };
      }
    },
  });
};
