import type { Component, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { spinners } from "unicode-animations";
import { complete } from "@earendil-works/pi-ai";
import type { Model, Api } from "@earendil-works/pi-ai";
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { isBashInput, resolveEditorBorder } from "../shared/editor-border-resolver";

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
const createEmptyFooter = (): Component => ({
  render: () => [],
  invalidate: () => {},
});

/**
 * Keeps the editor border color stable across renders while highlighting bash mode.
 *
 * When the prompt starts with `!`, Pi will run it as a bash command. This wrapper
 * uses the warning/yellow border and input text in that state, and falls back to
 * the muted base border with normal input rendering otherwise.
 */
const createBashAwareBorderEditor = (
  tui: TUI,
  theme: EditorTheme,
  keybindings: KeybindingsManager,
  baseBorder: (text: string) => string,
  bashBorder: (text: string) => string,
  bashInput: (text: string) => string,
): CustomEditor => {
  const editor = new CustomEditor(tui, { ...theme, borderColor: baseBorder }, keybindings);
  const isBashMode = (): boolean => isBashInput(editor.getText());
  const getBorderColor = (): ((text: string) => string) =>
    resolveEditorBorder({
      text: editor.getText(),
      baseBorder,
      bashBorder,
    });

  const originalHandleInput = editor.handleInput.bind(editor);
  editor.handleInput = (data: string): void => {
    originalHandleInput(data);
    editor.borderColor = getBorderColor();
  };

  const originalSetText = editor.setText.bind(editor);
  editor.setText = (text: string): void => {
    originalSetText(text);
    editor.borderColor = getBorderColor();
  };

  const originalInsertTextAtCursor = editor.insertTextAtCursor.bind(editor);
  editor.insertTextAtCursor = (text: string): void => {
    originalInsertTextAtCursor(text);
    editor.borderColor = getBorderColor();
  };

  const originalRender = editor.render.bind(editor);
  editor.render = (width: number): string[] => {
    editor.borderColor = getBorderColor();
    const lines = originalRender(width);

    if (!isBashMode() || lines.length <= 2) return lines;

    const lastEditorLineIndex = lines.length - 1;
    return lines.map((line, index) => {
      const isEditorBorder = index === 0 || index === lastEditorLineIndex;
      return isEditorBorder ? line : bashInput(line);
    });
  };

  return editor;
};

const isFooterMode = (value: unknown): value is FooterMode => {
  return value === "zen" || value === "dev";
};

const getStoredMode = (data: unknown): FooterMode | undefined => {
  if (!data || typeof data !== "object" || !("mode" in data)) return undefined;
  const value = (data as { mode?: unknown }).mode;
  return isFooterMode(value) ? value : undefined;
};

/** Compact cwd for narrow footer space while preserving the useful tail path. */
const formatCwd = (cwd: string): string => {
  const home = process.env.HOME;
  const compact = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
  const parts = compact.split("/").filter(Boolean);
  if (compact.startsWith("~/") && parts.length > 2) return `~/${parts.slice(-2).join("/")}`;
  if (!compact.startsWith("~") && parts.length > 3) return `…/${parts.slice(-3).join("/")}`;
  return compact;
};

/** Format Unix reset timestamps into short quota-reset labels. */
const formatResetShort = (resetAt: number | undefined): string => {
  if (!resetAt) return "unknown";

  const minutes = Math.max(0, Math.round((resetAt * 1000 - Date.now()) / 60000));
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = minutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};

const formatDuration = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

const formatTokensPerSecond = (tokensPerSecond: number): string => {
  if (tokensPerSecond >= 100) return `${Math.round(tokensPerSecond)} tok/s`;
  return `${tokensPerSecond.toFixed(1)} tok/s`;
};

const isOpenAICodexProvider = (provider: string | undefined): boolean => {
  return /^openai-codex(-\d+)?$/.test(provider ?? "");
};

const formatCompactTokens = (count: number): string => {
  const abs = Math.abs(count);
  if (abs >= 1_000_000) return `${Number((count / 1_000_000).toFixed(1))}m`;
  if (abs >= 1_000) return `${Number((count / 1_000).toFixed(1))}k`;
  return `${Math.round(count)}`;
};

const formatEstimatedCost = (cost: number): string => {
  if (cost >= 10) return `$${cost.toFixed(1)}`;
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(2)}`;
};

const formatSessionTokenTotals = (
  ctx: ExtensionContext,
  colorToken: (text: string) => string,
): string => {
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
};

/** Compact braille-style bar showing the context window percentage already filled. */
const formatContextBar = (
  ctx: ExtensionContext,
  modelConfig: ExtensionContext["model"],
  colorToken: (text: string) => string,
  colorBar: (percentUsed: number, text: string) => string,
): string => {
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
};

/** Build the right-side model/footer payload from Pi model state and optional Codex quota globals. */
const formatModelInfo = (
  pi: ExtensionAPI,
  modelConfig: ExtensionContext["model"],
): {
  provider: string;
  model: string;
  thinking?: PiThinkingLevel;
  usage?: CodexLimitUsage["fiveHour"];
} => {
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
};

const TITLE_GENERATION_PROMPT =
  "Generate a very short title (max 6 words, no quotes, no punctuation) for a coding session that starts with this message. Reply with ONLY the title:";

const MAX_TITLE_LENGTH = 50;

/** Extract the first user message text from the session branch. */
const getFirstUserMessage = (
  entries: Iterable<{ type: string; message?: { role?: string; content?: unknown } }>,
): string | undefined => {
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message?.role !== "user") continue;
    const content = entry.message.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        block.type === "text" &&
        typeof block.text === "string"
      )
        return block.text;
    }
  }
  return undefined;
};

export default (pi: ExtensionAPI): void => {
  let mode: FooterMode = "zen";
  let activeTui: TUI | undefined;
  let currentCtx: ExtensionContext | undefined;
  let currentModel: ExtensionContext["model"];
  let gitInfo: GitInfo = { changedFiles: 0, isRepo: false };
  let turnStartedAt: number | undefined;
  let turnDurationTimer: ReturnType<typeof setInterval> | undefined;
  let lastTurnDuration: number | undefined;
  let lastTurnTokensPerSecond: number | undefined;
  let sessionTitle: string | undefined;
  let titleGenerationStarted = false;

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
    lastTurnTokensPerSecond = undefined;
    requestRender();
    updateTurnDurationDisplay(ctx);

    turnDurationTimer = setInterval(() => {
      updateTurnDurationDisplay(ctx);
    }, TURN_DURATION_UPDATE_INTERVAL_MS);
  };

  const stopTurnDuration = (ctx: ExtensionContext): number | undefined => {
    if (turnStartedAt === undefined) return undefined;

    lastTurnDuration = Date.now() - turnStartedAt;
    turnStartedAt = undefined;
    clearTurnDurationTimer();

    ctx.ui.setWorkingMessage();
    updateTurnDurationDisplay(ctx);
    requestRender();
    return lastTurnDuration;
  };

  /** Replace the editor with a border-stable wrapper once a TUI is available. */
  const installStableEditor = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      activeTui = tui;
      return createBashAwareBorderEditor(
        tui,
        theme,
        keybindings,
        (text) => ctx.ui.theme.fg("borderMuted", text),
        (text) => ctx.ui.theme.fg("warning", text),
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
    ctx.ui.setWidget("footer-mode-dev-info", undefined);
    ctx.ui.setWidget("footer-mode-model-info", undefined);
    ctx.ui.setWidget("footer-mode-session-title", undefined);

    if (mode === "zen") {
      ctx.ui.setFooter(createEmptyFooter);
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
            const left = changeCount + branch + separator + directory;
            const displayTitle = pi.getSessionName() ?? sessionTitle;
            const right = displayTitle ? theme.fg("muted", displayTitle) : "";
            if (!right) return [truncateToWidth(left, width)];
            const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
            return [truncateToWidth(left + " ".repeat(gap) + right, width)];
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
              const speed = lastTurnTokensPerSecond
                ? theme.fg("dim", `${formatTokensPerSecond(lastTurnTokensPerSecond)} · `)
                : "";
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
              const left = speed + duration + provider + slash + model + usage + thinking;
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

      ctx.ui.setFooter(createEmptyFooter);
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
    ctx.ui.setWidget("footer-mode-session-title", undefined);
    turnStartedAt = undefined;
    lastTurnDuration = undefined;
    lastTurnTokensPerSecond = undefined;
    sessionTitle = undefined;
    titleGenerationStarted = false;
    activeTui = undefined;
    currentCtx = undefined;
    currentModel = undefined;
    gitInfo = { changedFiles: 0, isRepo: false };
  });

  pi.on("input", (_event, ctx) => {
    startTurnDuration(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    requestRender();

    if (titleGenerationStarted || pi.getSessionName()) return;

    const userMessage = getFirstUserMessage(ctx.sessionManager.getBranch());
    if (!userMessage?.trim()) return;

    // Skip slash commands
    if (userMessage.trim().startsWith("/")) return;

    const model = currentModel as Model<Api> | undefined;
    if (!model) return;

    try {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth?.ok || !auth.apiKey) return;

      titleGenerationStarted = true;

      const response = await complete(
        model,
        {
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `${TITLE_GENERATION_PROMPT}\n\n${userMessage.slice(0, 500)}`,
                },
              ],
              timestamp: Date.now(),
            },
          ],
        },
        { apiKey: auth.apiKey, headers: auth.headers },
      );

      const title = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim()
        .replace(/^["']+|["']+$/g, "")
        .replace(/[.!?;:]+$/, "")
        .slice(0, MAX_TITLE_LENGTH);

      if (title) {
        sessionTitle = title;
        pi.setSessionName(title);
        if (currentCtx) applyMode(currentCtx);
        requestRender();
      }
    } catch {
      // Silently fail — the session simply won't get a title
    } finally {
      titleGenerationStarted = false;
    }
  });
  pi.on("message_update", requestRender);
  pi.on("message_end", requestRender);
  pi.on("agent_end", (event, ctx) => {
    const elapsed = stopTurnDuration(ctx);
    const outputTokens = event.messages.reduce((total, message) => {
      if (message.role !== "assistant") return total;
      return total + (message.usage?.output ?? 0);
    }, 0);

    lastTurnTokensPerSecond =
      elapsed && outputTokens > 0 ? outputTokens / (elapsed / 1000) : undefined;
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
};
