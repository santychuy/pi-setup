/**
 * Leaders extension — shared CLI argument builder.
 *
 * Builds the `pi` CLI argument vector for spawning child processes.
 * Used by both foreground (index.ts) and background (async.ts) execution.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { DEFAULT_TOOLS, EXTENSION_TOOL_REGISTRY } from "./types.js";
import type { LeaderAgentConfig, LeaderSessionMode } from "./types.js";
import { modelArg } from "./utils.js";

// ── Extension Resolution ───────────────────────────────────────────────────

interface KnownExtensionSource {
  localPath: () => string;
  fallbackSource: string;
}

const KNOWN_EXTENSION_SOURCES: Record<string, KnownExtensionSource> = {
  "web-access": {
    localPath: () => path.join(__dirname, "..", "..", "web-access", "index.ts"),
    fallbackSource: "pi-agent-web-access",
  },
};

const resolveLeaderExtensionSource = (extension: string): string => {
  const known = KNOWN_EXTENSION_SOURCES[extension];
  if (!known) return extension;

  const candidate = known.localPath();
  return fs.existsSync(candidate) ? candidate : known.fallbackSource;
};

const unique = (items: readonly string[]): string[] => Array.from(new Set(items));

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

  const extensions = agent.extensions ?? [];
  for (const extension of extensions) {
    args.push("-e", resolveLeaderExtensionSource(extension));
  }

  // Tools from agent config or defaults, plus tools exported by explicitly
  // enabled extensions. Keep --no-extensions as the default safety boundary;
  // -e only loads declared extensions such as web-access.
  const extensionTools = extensions.flatMap((extension) => [
    ...(EXTENSION_TOOL_REGISTRY[extension] ?? []),
  ]);
  const tools = unique([...(agent.tools ?? DEFAULT_TOOLS), ...extensionTools]);
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
