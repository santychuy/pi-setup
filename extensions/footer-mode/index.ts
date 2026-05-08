import type { Component, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";

type FooterMode = "zen" | "dev";
type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type CodexLimitUsage = {
  provider?: string;
  fiveHour?: {
    usedPercent?: number;
    windowSeconds?: number;
    resetAt?: number;
  };
  weekly?: {
    usedPercent?: number;
    windowSeconds?: number;
    resetAt?: number;
  };
  fetchedAt?: number;
};

declare global {
  // eslint-disable-next-line no-var
  var piCodexLimit: CodexLimitUsage | undefined;
}

const STATE_TYPE = "footer-mode-state";
const SHORTCUT = "alt+f";

class EmptyFooter implements Component {
  render(): string[] {
    return [];
  }

  invalidate(): void {}
}

class StableBorderEditor extends CustomEditor {
  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly stableBorder: (text: string) => string,
  ) {
    super(tui, { ...theme, borderColor: stableBorder }, keybindings);
  }

  render(width: number): string[] {
    this.borderColor = this.stableBorder;
    return super.render(width);
  }
}

function isFooterMode(value: unknown): value is FooterMode {
  return value === "zen" || value === "dev";
}

function getStoredMode(data: unknown): FooterMode | undefined {
  if (!data || typeof data !== "object" || !("mode" in data)) return undefined;
  const value = (data as { mode?: unknown }).mode;
  return isFooterMode(value) ? value : undefined;
}

function formatCwd(cwd: string): string {
  const home = process.env.HOME;
  const compact = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
  const parts = compact.split("/").filter(Boolean);
  if (compact.startsWith("~/") && parts.length > 2) return `~/${parts.slice(-2).join("/")}`;
  if (!compact.startsWith("~") && parts.length > 3) return `…/${parts.slice(-3).join("/")}`;
  return compact;
}

function formatResetShort(resetAt: number | undefined): string {
  if (!resetAt) return "unknown";

  const minutes = Math.max(0, Math.round((resetAt * 1000 - Date.now()) / 60000));
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = minutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function isOpenAICodexProvider(provider: string | undefined): boolean {
  return /^openai-codex(-\d+)?$/.test(provider ?? "");
}

function formatModelInfo(
  pi: ExtensionAPI,
  modelConfig: ExtensionContext["model"],
): {
  provider: string;
  model: string;
  thinking?: PiThinkingLevel;
  usage?: CodexLimitUsage["fiveHour"];
} {
  const provider = modelConfig?.provider ?? "no-provider";
  const model = modelConfig?.id ?? "no-model";
  const thinking = pi.getThinkingLevel() as PiThinkingLevel;
  const codexLimit = globalThis.piCodexLimit;
  return {
    provider,
    model,
    thinking: thinking === "off" ? undefined : thinking,
    usage:
      isOpenAICodexProvider(provider) && codexLimit?.provider === provider
        ? codexLimit.fiveHour
        : undefined,
  };
}

export default function (pi: ExtensionAPI) {
  let mode: FooterMode = "zen";
  let activeTui: TUI | undefined;
  let currentModel: ExtensionContext["model"];
  let gitBranch: string | undefined;

  const rememberMode = () => {
    pi.appendEntry(STATE_TYPE, { mode });
  };

  const requestRender = () => {
    activeTui?.requestRender();
  };

  const installStableEditor = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      activeTui = tui;
      return new StableBorderEditor(tui, theme, keybindings, (text) =>
        ctx.ui.theme.fg("borderMuted", text),
      );
    });
  };

  const refreshGitBranch = async (ctx: ExtensionContext) => {
    const result = await pi
      .exec("git", ["branch", "--show-current"], { cwd: ctx.cwd })
      .catch(() => undefined);
    const branch = result?.stdout.trim();
    gitBranch = branch && branch.length > 0 ? branch : undefined;
    requestRender();
  };

  const applyMode = (ctx: ExtensionContext, notify = false) => {
    if (!ctx.hasUI) return;

    ctx.ui.setWorkingVisible(mode === "dev");

    if (mode === "zen") {
      ctx.ui.setWidget("footer-mode-dev-info", undefined);
      ctx.ui.setWidget("footer-mode-model-info", undefined);
      ctx.ui.setFooter(() => new EmptyFooter());
    } else {
      void refreshGitBranch(ctx);
      ctx.ui.setWidget("footer-mode-dev-info", (tui, theme) => {
        activeTui = tui;
        return {
          invalidate() {},
          render(width: number): string[] {
            const branch = theme.fg("accent", gitBranch ?? "no git");
            const separator = theme.fg("dim", " · ");
            const directory = theme.fg("dim", formatCwd(ctx.cwd));
            return [truncateToWidth(branch + separator + directory, width)];
          },
        };
      });

      ctx.ui.setWidget(
        "footer-mode-model-info",
        (tui, theme) => {
          activeTui = tui;
          return {
            invalidate() {},
            render(width: number): string[] {
              const info = formatModelInfo(pi, currentModel);
              const provider = theme.fg("dim", info.provider);
              const slash = theme.fg("dim", "/");
              const model = theme.fg("muted", info.model);
              const usagePercent = info.usage?.usedPercent;
              const usage =
                usagePercent === undefined
                  ? ""
                  : usagePercent >= 100
                    ? theme.fg("dim", " · resets in ") +
                      theme.fg("error", formatResetShort(info.usage?.resetAt))
                    : theme.fg("dim", " · ") +
                      (usagePercent >= 90
                        ? theme.fg("error", `${Math.round(usagePercent)}%`)
                        : usagePercent >= 70
                          ? theme.fg("warning", `${Math.round(usagePercent)}%`)
                          : theme.fg("success", `${Math.round(usagePercent)}%`));
              const thinking = info.thinking
                ? theme.fg("dim", " · ") +
                  theme.getThinkingBorderColor(info.thinking)(info.thinking)
                : "";
              return [truncateToWidth(provider + slash + model + usage + thinking, width)];
            },
          };
        },
        { placement: "belowEditor" },
      );

      ctx.ui.setFooter(() => new EmptyFooter());
    }

    requestRender();
    if (notify) ctx.ui.notify(`Footer mode: ${mode}`, "info");
  };

  const setMode = (ctx: ExtensionContext, nextMode: FooterMode, notify = false) => {
    mode = nextMode;
    rememberMode();
    applyMode(ctx, notify);
  };

  pi.on("session_start", (_event, ctx) => {
    mode = "zen";
    currentModel = ctx.model;
    installStableEditor(ctx);
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
      mode = getStoredMode(entry.data) ?? mode;
    }

    applyMode(ctx);
  });

  pi.on("session_shutdown", () => {
    activeTui = undefined;
    currentModel = undefined;
    gitBranch = undefined;
  });

  pi.on("agent_start", requestRender);
  pi.on("agent_end", requestRender);
  pi.on("turn_end", requestRender);
  pi.on("model_select", (event) => {
    currentModel = event.model;
    requestRender();
  });
  pi.on("thinking_level_select", requestRender);

  pi.registerShortcut(SHORTCUT, {
    description: "Toggle footer mode between zen and dev",
    handler: async (ctx) => {
      setMode(ctx, mode === "zen" ? "dev" : "zen");
    },
  });

  pi.registerCommand("footer", {
    description: `Switch footer mode: /footer [zen|dev|toggle] (${SHORTCUT})`,
    handler: async (args, ctx) => {
      const requested = args.trim().toLowerCase();

      if (requested === "" || requested === "toggle") {
        setMode(ctx, mode === "zen" ? "dev" : "zen");
        return;
      }

      if (isFooterMode(requested)) {
        setMode(ctx, requested);
        return;
      }

      ctx.ui.notify("Usage: /footer [zen|dev|toggle]", "warning");
    },
  });
}
