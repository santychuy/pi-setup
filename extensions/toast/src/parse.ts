import type { ToastOptions, ToastVariant, ToastPosition } from "./types.js";
import { DEFAULT_TOAST_OPTIONS } from "./constants.js";

// ─── Guards ─────────────────────────────────────────────────────────────────

const isToastVariant = (value: string): value is ToastVariant =>
  value === "info" || value === "success" || value === "warning" || value === "error";

const isToastPosition = (value: string): value is ToastPosition =>
  value === "top-right" || value === "bottom-right";

// ─── Parser ─────────────────────────────────────────────────────────────────

/**
 * Parse a CLI-style argument string into `ToastOptions`.
 *
 * Supports:
 *   --type info|success|warning|error
 *   --variant (alias for --type)
 *   --pos top-right|bottom-right
 *   --position (alias for --pos)
 *   --duration <ms>  /  --duration-ms <ms>
 *   --width <cols>
 *
 * Returns `undefined` when no message text is found.
 */
export const parseArgs = (args: string): ToastOptions | undefined => {
  const tokens = args.trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) return undefined;

  const messageParts: string[] = [];
  // Start from defaults so any unspecified option stays at the default value
  const options: ToastOptions = { message: "", ...DEFAULT_TOAST_OPTIONS };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1];

    if (
      (token === "--type" || token === "--variant") &&
      next !== undefined &&
      isToastVariant(next)
    ) {
      options.variant = next;
      i++;
      continue;
    }

    if (
      (token === "--pos" || token === "--position") &&
      next !== undefined &&
      isToastPosition(next)
    ) {
      options.position = next;
      i++;
      continue;
    }

    if ((token === "--duration" || token === "--duration-ms") && next !== undefined) {
      const parsed = Number(next);
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.durationMs = parsed;
      }
      i++;
      continue;
    }

    if (token === "--width" && next !== undefined) {
      const parsed = Number(next);
      if (Number.isFinite(parsed)) {
        options.width = Math.max(20, Math.min(80, Math.floor(parsed)));
      }
      i++;
      continue;
    }

    messageParts.push(token);
  }

  const message = messageParts.join(" ").trim();
  return message.length > 0 ? { ...options, message } : undefined;
};
