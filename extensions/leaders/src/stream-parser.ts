/**
 * Leaders extension — JSON stream parser for Pi child process output.
 *
 * Replaces the old text-delta-only extraction with full structured event
 * parsing. Captures message completions, tool calls, tool results,
 * usage stats, model info, and stop reasons.
 */

import type { LeaderDisplayItem, LeaderUsageStats } from "./types.js";

// ── JSON Line Parsing ───────────────────────────────────────────────────────

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const parseJsonLine = (line: string): JsonRecord | undefined => {
  if (!line.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

// ── Content Block Extraction ────────────────────────────────────────────────

const extractTextFromContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("");
};

// ── Stream State ────────────────────────────────────────────────────────────

export interface StreamParseState {
  displayItems: LeaderDisplayItem[];
  usage: LeaderUsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  hasDelta: boolean;
  turns: number;
  /** Raw text accumulated from deltas, for live progress */
  liveText: string;
}

export const createStreamParseState = (): StreamParseState => ({
  displayItems: [],
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
  hasDelta: false,
  turns: 0,
  liveText: "",
});

// ── Event Processing ────────────────────────────────────────────────────────

/**
 * Process a single JSON line from the child process stdout.
 * Mutates `state` in-place with parsed event data.
 *
 * Pi JSON mode emits these event types:
 *   - message_end   → complete assistant or toolResult message
 *   - message_update → streaming deltas (text_delta, thinking_delta, etc.)
 *   - tool_execution_start → tool about to execute
 *   - tool_execution_end   → tool finished executing
 */
export const processStreamLine = (line: string, state: StreamParseState): void => {
  const event = parseJsonLine(line);
  if (!event) return;

  switch (event.type) {
    // ── Streaming deltas (progress) ──────────────────────────────────────
    case "message_update": {
      const update = event.assistantMessageEvent as Record<string, unknown> | undefined;
      if (update?.type === "text_delta" && typeof update.delta === "string") {
        state.hasDelta = true;
        state.liveText += update.delta;
      }
      break;
    }

    // ── Complete assistant message ────────────────────────────────────────
    case "message_end": {
      const msg = event.message as Record<string, unknown> | undefined;
      if (!msg) break;

      const role = msg.role as string;
      if (role === "assistant") {
        state.turns++;

        // Usage tracking
        const usage = msg.usage as Record<string, unknown> | undefined;
        if (usage) {
          state.usage.input += (usage.input as number) ?? 0;
          state.usage.output += (usage.output as number) ?? 0;
          state.usage.cacheRead += (usage.cacheRead as number) ?? 0;
          state.usage.cacheWrite += (usage.cacheWrite as number) ?? 0;

          const cost = usage.cost as Record<string, unknown> | undefined;
          state.usage.cost += (cost?.total as number) ?? 0;
          state.usage.contextTokens = (usage.totalTokens as number) ?? 0;
        }

        // Model and stop reason
        if (msg.model && !state.model) state.model = msg.model as string;
        if (msg.stopReason) state.stopReason = msg.stopReason as string;
        if (msg.errorMessage) state.errorMessage = msg.errorMessage as string;

        // Extract display items from content blocks
        const content = msg.content;
        if (Array.isArray(content)) {
          for (const part of content) {
            if (!isRecord(part)) continue;

            if (part.type === "text" && typeof part.text === "string") {
              state.displayItems.push({ type: "text", text: part.text });
            } else if (part.type === "toolCall") {
              state.displayItems.push({
                type: "toolCall",
                name: part.name as string,
                arguments: (part.arguments as Record<string, unknown>) ?? {},
              });
            }
          }
        }
      }
      break;
    }

    // ── Tool result message ───────────────────────────────────────────────
    case "tool_result_end": {
      const resultMsg = event.message as Record<string, unknown> | undefined;
      if (!resultMsg) break;

      if (resultMsg.role === "toolResult") {
        const text = extractTextFromContent(resultMsg.content);
        state.displayItems.push({
          type: "toolResult",
          toolName: (resultMsg.toolName as string) ?? "unknown",
          toolCallId: (resultMsg.toolCallId as string) ?? "",
          content: text,
          isError: (resultMsg.isError as boolean) ?? false,
        });
      }
      break;
    }

    // ── Tool execution lifecycle (optional progress) ─────────────────────
    case "tool_execution_start": {
      // Could emit onUpdate here for live progress
      break;
    }

    case "tool_execution_end": {
      // Could emit onUpdate here for live progress
      break;
    }
  }
};

// ── Final Output Extraction ─────────────────────────────────────────────────

/**
 * Walk display items backwards to find the last assistant text.
 * Falls back to liveText accumulation if no message_end was captured.
 */
export const getFinalOutput = (state: StreamParseState): string => {
  // First try display items (from message_end events)
  for (let i = state.displayItems.length - 1; i >= 0; i--) {
    const item = state.displayItems[i];
    if (item.type === "text" && item.text.trim()) {
      return item.text;
    }
  }

  // Fall back to accumulated delta text
  return state.liveText.trim();
};

// ── Buffer Processing ───────────────────────────────────────────────────────

/**
 * Process a chunk of stdout data, splitting by newlines and
 * processing each complete line. Returns the remaining buffer.
 */
export const processStreamChunk = (
  buffer: string,
  chunk: string,
  state: StreamParseState,
): string => {
  const combined = buffer + chunk;
  const lines = combined.split("\n");
  const remainder = lines.pop() ?? "";

  for (const line of lines) {
    processStreamLine(line, state);
  }

  return remainder;
};
