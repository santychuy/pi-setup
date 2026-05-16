/**
 * Leaders extension — shared type definitions.
 *
 * These types represent the structured result of a leader run,
 * the stream-parsing state, and the agent configuration format.
 */

// ── Session Modes ──────────────────────────────────────────────────────────

export type LeaderSessionMode = "ephemeral" | "persistent" | "fork";

// ── Usage & Display ────────────────────────────────────────────────────────

export interface LeaderUsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

export interface LeaderToolCallDisplay {
  type: "toolCall";
  name: string;
  arguments: Record<string, unknown>;
}

export interface LeaderToolResultDisplay {
  type: "toolResult";
  toolName: string;
  toolCallId: string;
  content: string;
  isError: boolean;
}

export interface LeaderTextDisplay {
  type: "text";
  text: string;
}

export type LeaderDisplayItem = LeaderTextDisplay | LeaderToolCallDisplay | LeaderToolResultDisplay;

// ── Single Run Result ──────────────────────────────────────────────────────

export interface LeaderSingleResult {
  agent: string;
  agentSource: "builtin" | "user" | "project" | "default";
  task: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
  mode: LeaderSessionMode;
  sessionFile?: string;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  usage: LeaderUsageStats;
  displayItems: LeaderDisplayItem[];
  finalOutput: string;
  stderr: string;
}

// ── Agent Configuration ────────────────────────────────────────────────────

export interface LeaderAgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  systemPromptMode: "replace" | "append";
  inheritProjectContext: boolean;
  inheritSkills: boolean;
  sessionMode: LeaderSessionMode;
  source: "builtin" | "user" | "project";
  filePath: string;
}

export interface LeaderAgentDiscoveryResult {
  agents: LeaderAgentConfig[];
  errors: Array<{ path: string; error: string }>;
}

// ── Leader Run Options ─────────────────────────────────────────────────────

export interface LeaderRunOptions {
  agent: LeaderAgentConfig;
  mode: LeaderSessionMode;
  sessionFile?: string;
  task: string;
}

// ── Tool Parameter Types ────────────────────────────────────────────────────

export type LeaderAction = "run" | "list";

// ── Default Agent ──────────────────────────────────────────────────────────

/**
 * The fallback agent used when no named agent is specified.
 * Inherits the parent model and uses a minimal tool set.
 */
export const DEFAULT_AGENT: LeaderAgentConfig = {
  name: "default",
  description: "General-purpose leader with a focused tool set",
  tools: ["read", "bash", "grep", "find", "ls"],
  model: undefined, // inherit parent model
  systemPrompt: "",
  systemPromptMode: "append",
  inheritProjectContext: false,
  inheritSkills: false,
  sessionMode: "ephemeral",
  source: "builtin",
  filePath: "",
};

export const DEFAULT_TOOLS = ["read", "bash", "grep", "find", "ls"] as const;
