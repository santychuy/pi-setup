import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { showToast } from "./api.js";
import { parseArgs } from "./parse.js";

export const TOAST_COMMAND_DESCRIPTION =
  "Show a temporary TUI toast: /toast [--type info|success|warning|error] [--position top-right|bottom-right] message";

export const TOAST_COMMAND_USAGE =
  "Usage: /toast [--type success] [--position top-right|bottom-right] message";

/**
 * Handler for the `/toast` extension command.
 */
export const handleToastCommand = async (
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> => {
  try {
    const options = parseArgs(args);

    if (options === undefined) {
      ctx.ui.notify(TOAST_COMMAND_USAGE, "warning");
      return;
    }

    await showToast(ctx, options);
  } catch (error) {
    ctx.ui.notify(`Toast command failed: ${(error as Error).message}`, "error");
  }
};
