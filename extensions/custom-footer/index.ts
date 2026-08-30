import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { relative, resolve, sep } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 10_000) return `${(tokens / 1_000).toFixed(1)}k`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

function formatPath(cwd: string): string {
  const home = resolve(homedir());
  const path = resolve(cwd);
  const relativePath = relative(home, path);
  return relativePath === ""
    ? "~"
    : relativePath && !relativePath.startsWith(`..${sep}`)
      ? `~/${relativePath}`
      : cwd;
}

function formatDuration(seconds: number): string {
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export default function (pi: ExtensionAPI) {
  let assistantStartedAt: number | undefined;
  let tokensPerSecond: number | undefined;
  let runStartedAt: number | undefined;
  let lastRunSeconds: number | undefined;
  let requestRender: (() => void) | undefined;
  let changedFiles: number | undefined;
  let gitStatusGeneration = 0;

  pi.on("message_start", (event) => {
    if (event.message.role === "assistant") assistantStartedAt = Date.now();
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant" || assistantStartedAt === undefined) return;
    const elapsedSeconds = (Date.now() - assistantStartedAt) / 1_000;
    assistantStartedAt = undefined;
    tokensPerSecond = elapsedSeconds > 0 ? event.message.usage.output / elapsedSeconds : undefined;
    requestRender?.();
  });

  pi.on("agent_start", () => {
    runStartedAt = Date.now();
  });

  const refreshChangedFiles = (signal?: AbortSignal) => {
    const generation = ++gitStatusGeneration;
    void pi
      .exec("git", ["status", "--porcelain"], { signal })
      .then((result) => {
        if (generation !== gitStatusGeneration || result.code !== 0) return;
        changedFiles = result.stdout.split("\n").filter(Boolean).length;
        requestRender?.();
      })
      .catch(() => undefined);
  };

  pi.on("agent_settled", (_event, ctx) => {
    if (runStartedAt !== undefined) {
      lastRunSeconds = (Date.now() - runStartedAt) / 1_000;
      runStartedAt = undefined;
      requestRender?.();
    }
    refreshChangedFiles(ctx.signal);
  });

  pi.on("session_start", (_event, ctx) => {
    tokensPerSecond = undefined;
    runStartedAt = undefined;
    lastRunSeconds = undefined;
    changedFiles = undefined;
    refreshChangedFiles(ctx.signal);
    if (ctx.mode !== "tui") return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsubscribeBranch = footerData.onBranchChange(() => tui.requestRender());
      return {
        invalidate() {},
        dispose() {
          unsubscribeBranch();
          requestRender = undefined;
        },
        render(width: number): string[] {
          const model = ctx.model;
          const level = pi.getThinkingLevel();
          const thinkingColor = {
            off: "thinkingOff",
            minimal: "thinkingMinimal",
            low: "thinkingLow",
            medium: "thinkingMedium",
            high: "thinkingHigh",
            xhigh: "thinkingXhigh",
            max: "thinkingMax",
          } as const;
          const fastMode = footerData.getExtensionStatuses().get("codex-fast");
          const label = model
            ? `${model.provider}/${model.id}${fastMode ? ` ${fastMode}` : ""} • ${theme.fg(thinkingColor[level], level)}`
            : "no model";
          const text = theme.fg("dim", label);
          const branch = footerData.getGitBranch();
          const projectText = theme.fg("dim", formatPath(ctx.cwd));
          const git = [
            branch && `${branch}${changedFiles ? "*" : ""}`,
            changedFiles === undefined
              ? undefined
              : `${changedFiles} file${changedFiles === 1 ? "" : "s"} changed`,
          ]
            .filter((value): value is string => Boolean(value))
            .join(" • ");
          const taskStatus = footerData.getExtensionStatuses().get("managed-tasks");
          const gitText = theme.fg("dim", [git, taskStatus].filter(Boolean).join(" • "));

          const usage = ctx.getContextUsage();
          const context = `${usage?.percent?.toFixed(0) ?? "?"}%/${formatTokens(
            usage?.contextWindow ?? model?.contextWindow ?? 0,
          )}`;
          let cost = 0;
          for (const entry of ctx.sessionManager.getEntries()) {
            if (entry.type === "message" && entry.message.role === "assistant") {
              cost += entry.message.usage.cost.total;
            }
          }
          const speed =
            tokensPerSecond === undefined ? "— tok/s" : `${tokensPerSecond.toFixed(1)} tok/s`;
          const duration =
            lastRunSeconds === undefined ? undefined : formatDuration(lastRunSeconds);
          const metrics = [
            context,
            duration ? `${speed} • ${duration}` : speed,
            `$${cost.toFixed(3)}`,
          ].join(" • ");
          const metricsText = theme.fg("dim", metrics);
          return [
            truncateToWidth(
              projectText +
                " ".repeat(Math.max(1, width - visibleWidth(projectText) - visibleWidth(text))) +
                text,
              width,
              "",
            ),
            truncateToWidth(
              gitText +
                " ".repeat(Math.max(1, width - visibleWidth(gitText) - visibleWidth(metricsText))) +
                metricsText,
              width,
              "",
            ),
          ];
        },
      };
    });
  });
}
