/**
 * Leaders extension — shared CLI argument builder.
 *
 * Builds the `pi` CLI argument vector for spawning child processes.
 * Used by both foreground (index.ts) and background (async.ts) execution.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { DEFAULT_TOOLS } from "./types.js";
import type { LeaderAgentConfig, LeaderSessionMode } from "./types.js";
import { modelArg } from "./utils.js";

// ── Build CLI Args ──────────────────────────────────────────────────────────

export const buildLeaderArgs = (
  task: string,
  ctx: ExtensionContext,
  agent: LeaderAgentConfig,
  mode: LeaderSessionMode,
  sessionFile?: string,
  tmpPromptPath?: string | null,
): string[] => {
  const sessionArgs =
    (mode === "fork" || mode === "ephemeral-fork") && sessionFile
      ? ["--session", sessionFile]
      : mode === "persistent" && sessionFile
        ? ["--session", sessionFile]
        : ["--no-session"];

  const args = ["--mode", "json", "-p", ...sessionArgs, "--no-extensions"];

  // Tools from agent config or defaults
  const tools = agent.tools ?? [...DEFAULT_TOOLS];
  args.push("--tools", tools.join(","));

  // Model from agent config or inherit from parent
  const selectedModel = agent.model ?? modelArg(ctx);
  if (selectedModel) args.push("--model", selectedModel);

  // System prompt file if provided
  if (tmpPromptPath) {
    args.push("--append-system-prompt", tmpPromptPath);
  }

  // Task goes last so it's the prompt positional
  args.push(task);

  return args;
};
