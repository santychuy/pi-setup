import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "bash-block";

export default function bashBlockExtension(pi: ExtensionAPI): void {
  let blocked = false;

  const updateStatus = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI) return;

    ctx.ui.setStatus(STATUS_KEY, blocked ? ctx.ui.theme.fg("warning", "bash: blocked") : undefined);
  };

  const toggle = (ctx: ExtensionContext): void => {
    blocked = !blocked;
    updateStatus(ctx);

    if (ctx.hasUI) {
      ctx.ui.notify(blocked ? "Bash tool blocked" : "Bash tool allowed", "info");
    }
  };

  pi.on("session_start", (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.on("tool_call", (event) => {
    if (!blocked || event.toolName !== "bash") return undefined;

    return {
      block: true,
      reason: "Bash tool is blocked. Run /bash-block to allow it.",
    };
  });

  pi.registerCommand("bash-block", {
    description: "Toggle blocking of the bash tool",
    handler: async (_args, ctx) => {
      toggle(ctx);
    },
  });
}
