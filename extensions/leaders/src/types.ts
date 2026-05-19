/**
 * Leaders extension — shared type definitions.
 *
 * These types represent the structured result of a leader run,
 * the stream-parsing state, and the agent configuration format.
 */

// ── Session Modes ──────────────────────────────────────────────────────────

export type LeaderSessionMode = "ephemeral" | "persistent" | "fork" | "ephemeral-fork";

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

export interface LeaderParallelTaskInput {
  id?: string;
  task: string;
  agent?: string;
  mode?: LeaderSessionMode;
}

export type LeaderParallelTaskStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "budget_blocked"
  | "budget_exceeded";

export type LeaderParallelAbortReason = "cancelled" | "timed_out" | "budget_exceeded";

export interface LeaderParallelTaskResult {
  id: string;
  task: string;
  agent: string;
  mode: LeaderSessionMode;
  status: LeaderParallelTaskStatus;
  result?: LeaderSingleResult;
  error?: string;
  startedAt?: number;
  endedAt?: number;
  abortReason?: LeaderParallelAbortReason;
  blockedReason?: "maxTokensTotal" | "maxCostUsdTotal";
}

export interface LeaderParallelResult {
  status: "completed" | "partial" | "failed" | "cancelled" | "timed_out" | "budget_exceeded";
  tasks: LeaderParallelTaskResult[];
  usage: LeaderUsageStats;
  abortReason?: LeaderParallelAbortReason;
  blockedReason?: "maxTokensTotal" | "maxCostUsdTotal";
}

// ── Agent Configuration ────────────────────────────────────────────────────

export interface LeaderAgentConfig {
  name: string;
  description: string;
  tools?: string[];
  extensions?: string[];
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

// ── Delegation Contract & Budget Policy ────────────────────────────────────

export interface LeaderDelegationContract {
  version: "1.0";
  taskId: string;
  goal: string;
}

export interface LeaderBudgetPolicy {
  version: "1.0";
  limits: {
    maxAgentsPerRun: number;
    maxParallel: number;
    maxDelegationDepth: number;
    maxDurationMs: number;
    maxTokensTotal?: number;
    maxCostUsdTotal?: number;
  };
}

export const DEFAULT_BUDGET_POLICY: LeaderBudgetPolicy = {
  version: "1.0",
  limits: {
    maxAgentsPerRun: 3,
    maxParallel: 2,
    maxDelegationDepth: 1,
    maxDurationMs: 300_000,
    maxTokensTotal: 140_000,
    maxCostUsdTotal: 0.35,
  },
};

// ── Tool Parameter Types ────────────────────────────────────────────────────

export type LeaderAction = "run" | "list" | "status" | "cleanup";

export const MAX_PARALLEL_CAP = 4;
export const MAX_AGENTS_PER_RUN_CAP = 6;

// ── Default Agent ──────────────────────────────────────────────────────────

/**
 * The fallback agent used when no named agent is specified.
 * Inherits the parent model and uses a minimal tool set.
 */
export const DEFAULT_AGENT: LeaderAgentConfig = {
  name: "default",
  description: "General-purpose leader with a focused tool set",
  tools: ["read", "bash", "grep", "find", "ls"],
  extensions: ["web-access"],
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

export const EXTENSION_TOOL_REGISTRY: Record<string, readonly string[]> = {
  "web-access": ["web_search", "fetch_content"],
};
