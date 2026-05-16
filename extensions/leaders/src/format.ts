/**
 * Leaders extension — result formatting and display utilities.
 *
 * Converts structured LeaderSingleResult data into human-readable
 * text for the parent agent, and formats usage statistics.
 */

import type { LeaderDisplayItem, LeaderSingleResult, LeaderUsageStats } from "./types.js";

// ── Usage Formatting ────────────────────────────────────────────────────────

const formatTokens = (count: number): string => {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
};

export const formatUsageStats = (usage: LeaderUsageStats, model?: string): string => {
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens > 0) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  if (model) parts.push(model);
  return parts.join(" ");
};

// ── Display Item Formatting ──────────────────────────────────────────────────

const summarizeArgs = (args: Record<string, unknown>, maxLen = 80): string => {
  const entries = Object.entries(args);
  if (entries.length === 0) return "";

  const parts = entries.map(([key, value]) => {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    return `${key}=${str.length > 30 ? `${str.slice(0, 30)}...` : str}`;
  });

  const joined = parts.join(", ");
  return joined.length > maxLen ? `${joined.slice(0, maxLen)}...` : joined;
};

const formatToolCallItem = (item: LeaderDisplayItem): string => {
  if (item.type === "toolCall") {
    const args = summarizeArgs(item.arguments);
    return `→ ${item.name}(${args})`;
  }
  if (item.type === "toolResult") {
    const prefix = item.isError ? "✗" : "→";
    const preview = item.content.length > 200 ? `${item.content.slice(0, 200)}...` : item.content;
    return `${prefix} ${item.toolName}: ${preview}`;
  }
  return "";
};

/**
 * Format display items into a collapsed view with an optional item limit.
 */
export const formatDisplayItems = (items: LeaderDisplayItem[], limit = 20): string => {
  const toShow = items.slice(-limit);
  const skipped = items.length > limit ? items.length - limit : 0;
  const lines: string[] = [];

  if (skipped > 0) lines.push(`... ${skipped} earlier items`);

  for (const item of toShow) {
    if (item.type === "text") {
      lines.push(item.text);
    } else {
      lines.push(formatToolCallItem(item));
    }
  }

  return lines.join("\n");
};

// ── Result Formatting ────────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, string> = {
  completed: "✓",
  failed: "✗",
  cancelled: "⊘",
};

export const formatLeaderResult = (result: LeaderSingleResult): string => {
  const isOk =
    result.exitCode === 0 && result.stopReason !== "error" && result.stopReason !== "aborted";
  const statusIcon = STATUS_ICONS[isOk ? "completed" : result.signal ? "cancelled" : "failed"];

  const statusLine = result.signal
    ? `cancelled by signal ${result.signal}`
    : result.exitCode === 0
      ? "completed"
      : `exited with code ${result.exitCode}`;

  const parts: string[] = [
    `Leader ${statusIcon} ${result.agent} ${statusLine}.`,
    `Mode: ${result.mode}`,
  ];

  if (result.sessionFile) {
    parts.push(`Session: ${result.sessionFile}`);
  }

  if (result.errorMessage) {
    parts.push(`\nError: ${result.errorMessage}`);
  }

  const usageLine = formatUsageStats(result.usage, result.model);
  if (usageLine) {
    parts.push(`\nUsage: ${usageLine}`);
  }

  // Final output
  const output =
    result.finalOutput ||
    (result.stderr ? `(no output)\n\nStderr:\n${result.stderr}` : "(no output)");
  parts.push(`\n${output}`);

  return parts.join("\n");
};
