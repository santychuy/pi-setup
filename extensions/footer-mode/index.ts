import type { Component, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { spinners } from "unicode-animations";
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

/** Snapshot of the repository state shown in the dev footer. */
type GitInfo = {
  branch?: string;
  changedFiles: number;
  isRepo: boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var piCodexLimit: CodexLimitUsage | undefined;
}

const STATE_TYPE = "footer-mode-state";
const SHORTCUT = "alt+f";
const TURN_DURATION_UPDATE_INTERVAL_MS = 250;
const WORKING_SPINNER = spinners.columns;

/** Hides Pi's default footer while keeping the custom below-editor widgets active. */
class EmptyFooter implements Component {
  render(): string[] {
    return [];
  }

  invalidate(): void {}
}

/**
 * Keeps the editor border color stable across renders while highlighting bash mode.
 *
 * When the prompt starts with `!`, Pi will run it as a bash command. This wrapper
 * uses the warning/yellow border in that state and falls back to the muted base border otherwise.
 */
class BashAwareBorderEditor extends CustomEditor {
  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly baseBorder: (text: string) => string,
    private readonly bashBorder: (text: string) => string,
  ) {
    super(tui, { ...theme, borderColor: baseBorder }, keybindings);
  }

  private getBorderColor(): (text: string) => string {
    return this.getText().startsWith("!") ? this.bashBorder : this.baseBorder;
  }

  handleInput(data: string): void {
    super.handleInput(data);
    this.borderColor = this.getBorderColor();
  }

  setText(text: string): void {
    super.setText(text);
    this.borderColor = this.getBorderColor();
  }

  insertTextAtCursor(text: string): void {
    super.insertTextAtCursor(text);
    this.borderColor = this.getBorderColor();
  }

  render(width: number): string[] {
    this.borderColor = this.getBorderColor();
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

/** Compact cwd for narrow footer space while preserving the useful tail path. */
function formatCwd(cwd: string): string {
  const home = process.env.HOME;
  const compact = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
  const parts = compact.split("/").filter(Boolean);
  if (compact.startsWith("~/") && parts.length > 2) return `~/${parts.slice(-2).join("/")}`;
  if (!compact.startsWith("~") && parts.length > 3) return `…/${parts.slice(-3).join("/")}`;
  return compact;
}

/** Format Unix reset timestamps into short quota-reset labels. */
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

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function isOpenAICodexProvider(provider: string | undefined): boolean {
  return /^openai-codex(-\d+)?$/.test(provider ?? "");
}

function formatCompactTokens(count: number): string {
  const abs = Math.abs(count);
  if (abs >= 1_000_000) return `${Number((count / 1_000_000).toFixed(1))}m`;
  if (abs >= 1_000) return `${Number((count / 1_000).toFixed(1))}k`;
  return `${Math.round(count)}`;
}

function formatEstimatedCost(cost: number): string {
  if (cost >= 10) return `$${cost.toFixed(1)}`;
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(2)}`;
}

function formatSessionTokenTotals(
  ctx: ExtensionContext,
  colorToken: (text: string) => string,
): string {
  let input = 0;
  let output = 0;
  let cost = 0;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    input += entry.message.usage?.input ?? 0;
    output += entry.message.usage?.output ?? 0;
    cost += entry.message.usage?.cost?.total ?? 0;
  }

  return colorToken(
    `↑${formatCompactTokens(input)} ↓${formatCompactTokens(output)}  ${formatEstimatedCost(cost)}`,
  );
}

/** Compact braille-style bar showing the context window percentage already filled. */
function formatContextBar(
  ctx: ExtensionContext,
  modelConfig: ExtensionContext["model"],
  colorToken: (text: string) => string,
  colorBar: (percentUsed: number, text: string) => string,
): string {
  const usage = ctx.getContextUsage();
  const contextWindow = usage?.contextWindow ?? modelConfig?.contextWindow ?? 0;
  const usedTokens = usage?.tokens ?? 0;
  const usedPercent =
    usage?.percent ?? (contextWindow > 0 ? (usedTokens / contextWindow) * 100 : null);
  const tokenTotals = formatSessionTokenTotals(ctx, colorToken);
  const tokenLabel = `${formatCompactTokens(usedTokens)}/${formatCompactTokens(contextWindow)}`;
  const prefix = tokenTotals + colorToken(" · ") + colorToken(tokenLabel) + colorToken(" · ");

  if (usedPercent === null) return prefix + colorToken("[??????????] ?%");

  const percentUsed = Math.max(0, Math.min(100, usedPercent));
  const totalCells = 10;
  const filledCells = Math.round((percentUsed / 100) * totalCells);
  const bar = `${"⣿".repeat(filledCells)}${"⣀".repeat(totalCells - filledCells)}`;
  return prefix + colorBar(percentUsed, `[${bar}] ${Math.round(percentUsed)}%`);
}

/** Build the right-side model/footer payload from Pi model state and optional Codex quota globals. */
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

export default function (pi: ExtensionAPI): void {
  let mode: FooterMode = "zen";
  let activeTui: TUI | undefined;
  let currentCtx: ExtensionContext | undefined;
  let currentModel: ExtensionContext["model"];
  let gitInfo: GitInfo = { changedFiles: 0, isRepo: false };
  let turnStartedAt: number | undefined;
  let turnDurationTimer: ReturnType<typeof setInterval> | undefined;
  let lastTurnDuration: number | undefined;

  const rememberMode = () => {
    pi.appendEntry(STATE_TYPE, { mode });
  };

  const requestRender = () => {
    activeTui?.requestRender();
  };

  const clearTurnDurationTimer = () => {
    if (!turnDurationTimer) return;
    clearInterval(turnDurationTimer);
    turnDurationTimer = undefined;
  };

  const renderTurnDuration = () => {
    const elapsed = turnStartedAt ? Date.now() - turnStartedAt : lastTurnDuration;
    return elapsed === undefined ? "" : formatDuration(elapsed);
  };

  const updateTurnDurationDisplay = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;

    ctx.ui.setWorkingVisible(true);
    ctx.ui.setWorkingMessage(renderTurnDuration());
  };

  const startTurnDuration = (ctx: ExtensionContext) => {
    clearTurnDurationTimer();
    turnStartedAt = Date.now();
    lastTurnDuration = undefined;
    requestRender();
    updateTurnDurationDisplay(ctx);

    turnDurationTimer = setInterval(() => {
      updateTurnDurationDisplay(ctx);
    }, TURN_DURATION_UPDATE_INTERVAL_MS);
  };

  const stopTurnDuration = (ctx: ExtensionContext) => {
    if (turnStartedAt === undefined) return;

    lastTurnDuration = Date.now() - turnStartedAt;
    turnStartedAt = undefined;
    clearTurnDurationTimer();

    ctx.ui.setWorkingMessage();
    updateTurnDurationDisplay(ctx);
    requestRender();
  };

  /** Replace the editor with a border-stable wrapper once a TUI is available. */
  const installStableEditor = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      activeTui = tui;
      return new BashAwareBorderEditor(
        tui,
        theme,
        keybindings,
        (text) => ctx.ui.theme.fg("borderMuted", text),
        (text) => ctx.ui.theme.fg("warning", text),
      );
    });
  };

  /**
   * Refresh branch and changed-file count for the dev footer.
   *
   * `git status --porcelain=v1` emits one line per changed path, including
   * staged, unstaged, deleted, renamed, and untracked files.
   */
  const refreshGitInfo = async (ctx: ExtensionContext) => {
    const [branchResult, statusResult] = await Promise.all([
      pi.exec("git", ["branch", "--show-current"], { cwd: ctx.cwd }).catch(() => undefined),
      pi.exec("git", ["status", "--porcelain=v1"], { cwd: ctx.cwd }).catch(() => undefined),
    ]);

    const branch = branchResult?.stdout.trim();
    const changedFiles =
      statusResult?.stdout.split("\n").filter((line) => line.trim().length > 0).length ?? 0;

    gitInfo = {
      branch: branch && branch.length > 0 ? branch : undefined,
      changedFiles,
      isRepo: statusResult !== undefined,
    };
    requestRender();
  };

  /** Avoid paying for git status when the dev footer is hidden. */
  const refreshGitInfoIfVisible = () => {
    if (mode === "dev" && currentCtx) void refreshGitInfo(currentCtx);
  };

  const applyWorkingIndicator = (ctx: ExtensionContext) => {
    ctx.ui.setWorkingIndicator({
      frames: WORKING_SPINNER.frames.map((frame) => ctx.ui.theme.fg("accent", frame)),
      intervalMs: WORKING_SPINNER.interval,
    });
  };

  /** Apply zen/dev UI wiring, including widgets that are only present in dev mode. */
  const applyMode = (ctx: ExtensionContext, notify = false) => {
    if (!ctx.hasUI) return;

    applyWorkingIndicator(ctx);
    ctx.ui.setWorkingVisible(mode === "dev");

    ctx.ui.setWidget("footer-mode-context-bar", undefined);

    if (mode === "zen") {
      ctx.ui.setWidget("footer-mode-dev-info", undefined);
      ctx.ui.setWidget("footer-mode-model-info", undefined);
      ctx.ui.setFooter(() => new EmptyFooter());
    } else {
      void refreshGitInfo(ctx);
      ctx.ui.setWidget("footer-mode-dev-info", (tui, theme) => {
        activeTui = tui;
        return {
          invalidate() {},
          render(width: number): string[] {
            const changeCount = theme.fg(
              gitInfo.changedFiles > 0 ? "warning" : "dim",
              `(${gitInfo.changedFiles}) `,
            );
            const branchLabel = gitInfo.isRepo ? (gitInfo.branch ?? "no branch") : "no git";
            const branch = theme.fg("accent", branchLabel);
            const separator = theme.fg("dim", " · ");
            const directory = theme.fg("dim", formatCwd(ctx.cwd));
            return [truncateToWidth(changeCount + branch + separator + directory, width)];
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
              const duration = lastTurnDuration
                ? theme.fg("dim", `took ${formatDuration(lastTurnDuration)} · `)
                : "";
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
                      (usagePercent >= 80
                        ? theme.fg("error", `${Math.round(usagePercent)}%`)
                        : usagePercent >= 50
                          ? theme.fg("warning", `${Math.round(usagePercent)}%`)
                          : theme.fg("muted", `${Math.round(usagePercent)}%`));
              const thinking = info.thinking
                ? theme.fg("dim", " · ") +
                  theme.getThinkingBorderColor(info.thinking)(info.thinking)
                : "";
              const left = duration + provider + slash + model + usage + thinking;
              const contextBar = formatContextBar(
                ctx,
                currentModel,
                (text) => theme.fg("dim", text),
                (percentUsed, text) => {
                  if (percentUsed >= 90) return theme.fg("error", text);
                  if (percentUsed >= 70) return theme.fg("warning", text);
                  return theme.fg("accent", text);
                },
              );
              const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(contextBar));
              return [truncateToWidth(left + " ".repeat(gap) + contextBar, width)];
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
    currentCtx = ctx;
    currentModel = ctx.model;
    installStableEditor(ctx);
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
      mode = getStoredMode(entry.data) ?? mode;
    }

    applyMode(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    clearTurnDurationTimer();
    ctx.ui.setWorkingMessage();
    ctx.ui.setWorkingIndicator();
    turnStartedAt = undefined;
    activeTui = undefined;
    currentCtx = undefined;
    currentModel = undefined;
    gitInfo = { changedFiles: 0, isRepo: false };
  });

  pi.on("input", (_event, ctx) => {
    startTurnDuration(ctx);
  });

  pi.on("agent_start", requestRender);
  pi.on("message_update", requestRender);
  pi.on("message_end", requestRender);
  pi.on("agent_end", (_event, ctx) => {
    stopTurnDuration(ctx);
    refreshGitInfoIfVisible();
  });
  pi.on("turn_end", () => {
    requestRender();
    refreshGitInfoIfVisible();
  });
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
