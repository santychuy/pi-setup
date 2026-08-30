import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type ChillState = { enabled: boolean };

export default function chill(pi: ExtensionAPI): void {
  let enabled = false;

  function apply(ctx: ExtensionContext): void {
    ctx.ui.setToolsExpanded(false);
    ctx.ui.setHiddenThinkingLabel(enabled ? "" : undefined);
    ctx.ui.setStatus(
      "chill",
      enabled ? "Chill: ON — thinking hidden, tools collapsed" : "Chill: OFF",
    );
  }

  function restore(ctx: ExtensionContext): void {
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === "chill-mode") {
        const state = entry.data as ChillState;
        if (typeof state?.enabled === "boolean") enabled = state.enabled;
      }
    }
    apply(ctx);
  }

  pi.registerMarkdownTransformer((markdown, { messageType }) =>
    enabled && messageType === "assistant-thinking" ? "" : markdown,
  );

  pi.on("session_start", (_event, ctx) => restore(ctx));

  pi.registerCommand("chill", {
    description: "Toggle reduced transcript noise",
    handler: async (_args, ctx) => {
      enabled = !enabled;
      pi.appendEntry<ChillState>("chill-mode", { enabled });
      apply(ctx);
      ctx.ui.notify(
        enabled ? "Chill is ON: thinking hidden, tools collapsed." : "Chill is OFF.",
        "info",
      );
    },
  });
}
