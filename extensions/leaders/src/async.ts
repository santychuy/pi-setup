/**
 * Leaders extension — background/async leader execution.
 *
 * Spawns leader processes detached from the parent, tracks their
 * progress via filesystem artifacts, and emits notifications on completion.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type {
  LeaderAgentConfig,
  LeaderBudgetPolicy,
  LeaderSessionMode,
  LeaderSingleResult,
} from "./types.js";
import { createStreamParseState, getFinalOutput, processStreamChunk } from "./stream-parser.js";
import { CHILD_ENV, writePromptToTempFile, cleanupTempFile, ASYNC_DIR } from "./utils.js";
import { buildLeaderArgs } from "./spawn-builder.js";
import { resolveLeaderSessionFile } from "./session.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type LeaderAsyncHandoffState = "none" | "pending" | "delivered" | "failed";
export type LeaderAsyncHandoffMode = "immediate" | "queued" | "disabled";

export interface LeaderHandoffConfig {
  mode?: LeaderAsyncHandoffMode | "auto";
  maxAttempts?: number;
  backoffMs?: number;
}

export interface LeaderAsyncRun {
  id: string;
  agent: string;
  task: string;
  mode: LeaderSessionMode;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  result?: LeaderSingleResult;
  pid?: number;
  sessionDir: string;
  sessionFile?: string;
  cleanupSessionFile?: boolean;
  handoffState?: LeaderAsyncHandoffState;
  handoffMode?: LeaderAsyncHandoffMode;
  handoffAttempts?: number;
  handoffMaxAttempts?: number;
  handoffBackoffMs?: number;
  handoffNextAttemptAt?: string;
  handoffDeliveredAt?: string;
  handoffLastError?: string;
}

export interface LeaderHandoffEnvelope {
  eventType: "leaders:async-complete";
  runId: string;
  agent: string;
  task: string;
  status: LeaderAsyncRun["status"];
  summary: string;
  usage?: LeaderSingleResult["usage"];
  artifactPath?: string;
  startedAt: string;
  completedAt?: string;
  handoffMode: Exclude<LeaderAsyncHandoffMode, "disabled">;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const ASYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Status File I/O ───────────────────────────────────────────────────────────

const ensureAsyncDir = (): void => {
  fs.mkdirSync(ASYNC_DIR, { recursive: true });
};

const statusPath = (runId: string): string => path.join(ASYNC_DIR, runId, "status.json");
const logPath = (runId: string): string => path.join(ASYNC_DIR, runId, "output.log");
const handoffPath = (runId: string): string => path.join(ASYNC_DIR, runId, "handoff.json");
const handoffQueuePath = (): string => path.join(ASYNC_DIR, "pending-handoffs.jsonl");
const handoffDeliveredIndexPath = (): string => path.join(ASYNC_DIR, "handoff-delivered.json");

const DEFAULT_HANDOFF_MAX_ATTEMPTS = 5;
const DEFAULT_HANDOFF_BACKOFF_MS = 30_000;

export const readAsyncStatus = (runId: string): LeaderAsyncRun | null => {
  const file = statusPath(runId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as LeaderAsyncRun;
  } catch {
    return null;
  }
};

const writeAsyncStatus = (run: LeaderAsyncRun): void => {
  ensureAsyncDir();
  const dir = path.join(ASYNC_DIR, run.id);
  fs.mkdirSync(dir, { recursive: true });
  const file = statusPath(run.id);
  const tmpFile = path.join(dir, `.status.${process.pid}.${randomUUID()}.tmp`);

  try {
    fs.writeFileSync(tmpFile, JSON.stringify(run, null, 2), "utf-8");
    fs.renameSync(tmpFile, file);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
};

export const listAsyncRuns = (): LeaderAsyncRun[] => {
  ensureAsyncDir();
  const entries = fs.readdirSync(ASYNC_DIR);
  const runs: LeaderAsyncRun[] = [];
  for (const entry of entries) {
    const run = readAsyncStatus(entry);
    if (run) runs.push(run);
  }
  return runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
};

// ── Cleanup ────────────────────────────────────────────────────────────────────

const terminalStatuses = new Set<LeaderAsyncRun["status"]>(["completed", "failed", "cancelled"]);

export const isPidRunning = (pid: number | undefined): boolean => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const cleanupAsyncSessionFile = (
  run: Pick<LeaderAsyncRun, "sessionFile" | "cleanupSessionFile">,
): boolean => {
  if (!run.cleanupSessionFile || !run.sessionFile) return true;

  try {
    fs.rmSync(run.sessionFile, { force: true });
    return true;
  } catch {
    // Cleanup is best-effort; status/result updates should not fail because
    // a temporary fork file could not be removed immediately. Keep cleanup
    // metadata so a later recovery pass can retry.
    return false;
  }
};

const hideCleanupSessionFile = (
  result: LeaderSingleResult,
  run: Pick<LeaderAsyncRun, "cleanupSessionFile">,
): LeaderSingleResult => (run.cleanupSessionFile ? { ...result, sessionFile: undefined } : result);

export const hasPendingSessionCleanup = (
  run: Pick<LeaderAsyncRun, "cleanupSessionFile" | "sessionFile">,
): boolean => run.cleanupSessionFile === true && !!run.sessionFile;

export interface AsyncCleanupSummary {
  retried: number;
  succeeded: number;
  failed: number;
  pending: number;
}

export const retryPendingAsyncSessionCleanups = (): AsyncCleanupSummary => {
  const summary: AsyncCleanupSummary = { retried: 0, succeeded: 0, failed: 0, pending: 0 };

  for (const run of listAsyncRuns()) {
    if (!terminalStatuses.has(run.status) || !hasPendingSessionCleanup(run)) continue;

    summary.retried += 1;
    const cleanupSucceeded = cleanupAsyncSessionFile(run);

    if (cleanupSucceeded) {
      run.sessionFile = undefined;
      summary.succeeded += 1;
    } else {
      summary.failed += 1;
    }

    if (hasPendingSessionCleanup(run)) summary.pending += 1;
    writeAsyncStatus(run);
  }

  return summary;
};

export const cleanupOldAsyncRuns = (): void => {
  if (!fs.existsSync(ASYNC_DIR)) return;
  const now = Date.now();

  for (const entry of fs.readdirSync(ASYNC_DIR)) {
    const run = readAsyncStatus(entry);
    if (!run) continue;

    const startedAt = new Date(run.startedAt).getTime();
    const completedAt = run.completedAt ? new Date(run.completedAt).getTime() : undefined;
    const referenceTime = completedAt ?? startedAt;
    const isOlderThanMaxAge = now - referenceTime > ASYNC_MAX_AGE_MS;
    const isStaleRunning = run.status === "running" && !isPidRunning(run.pid);

    const shouldCleanup = terminalStatuses.has(run.status) || isStaleRunning;
    const hadPendingCleanup = hasPendingSessionCleanup(run);
    const cleanupSucceeded = shouldCleanup ? cleanupAsyncSessionFile(run) : true;

    if (cleanupSucceeded && hadPendingCleanup) {
      run.sessionFile = undefined;
    }

    if (isStaleRunning) {
      run.status = "failed";
      run.completedAt = new Date().toISOString();
      run.exitCode = 1;
      run.result = createStaleAsyncResult(run);
      writeAsyncStatus(run);
    } else if (shouldCleanup && hadPendingCleanup) {
      writeAsyncStatus(run);
    }

    if (terminalStatuses.has(run.status) && isOlderThanMaxAge && !hasPendingSessionCleanup(run)) {
      fs.rmSync(path.join(ASYNC_DIR, entry), { recursive: true, force: true });
    }
  }
};

// ── Result Helpers ────────────────────────────────────────────────────────────

const createAsyncSessionErrorResult = (
  agent: LeaderAgentConfig,
  task: string,
  mode: LeaderSessionMode,
  error: string,
): LeaderSingleResult => ({
  agent: agent.name,
  agentSource: agent.source,
  task,
  exitCode: 1,
  signal: null,
  mode,
  sessionFile: undefined,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextTokens: 0,
    turns: 0,
  },
  displayItems: [],
  finalOutput: error,
  stderr: "",
});

const createStaleAsyncResult = (run: LeaderAsyncRun): LeaderSingleResult => ({
  agent: run.agent,
  agentSource: "default",
  task: run.task,
  exitCode: 1,
  signal: null,
  mode: run.mode,
  sessionFile: run.cleanupSessionFile ? undefined : run.sessionFile,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextTokens: 0,
    turns: 0,
  },
  displayItems: [],
  finalOutput:
    "Async leader marked failed during cleanup because its process is no longer running.",
  stderr: "",
});

// ── Async Leader Spawn ────────────────────────────────────────────────────────

/**
 * Spawn a leader process in the background and return immediately.
 * The child process writes output to a log file and updates status.json on completion.
 */
export const spawnAsyncLeader = async (
  task: string,
  ctx: ExtensionContext,
  agent: LeaderAgentConfig,
  mode: LeaderSessionMode,
  _budget?: LeaderBudgetPolicy,
  handoffConfig: LeaderHandoffConfig = {},
): Promise<LeaderAsyncRun> => {
  const runId = randomUUID();
  const runDir = path.join(ASYNC_DIR, runId);
  ensureAsyncDir();
  fs.mkdirSync(runDir, { recursive: true });

  const sessionResolution = resolveLeaderSessionFile(ctx, mode, {
    persistentPrefix: "leader-async",
  });
  const { sessionFile } = sessionResolution;

  const run: LeaderAsyncRun = {
    id: runId,
    agent: agent.name,
    task,
    mode,
    status: sessionResolution.error ? "failed" : "running",
    startedAt: new Date().toISOString(),
    completedAt: sessionResolution.error ? new Date().toISOString() : undefined,
    exitCode: sessionResolution.error ? 1 : undefined,
    result: sessionResolution.error
      ? createAsyncSessionErrorResult(agent, task, mode, sessionResolution.error)
      : undefined,
    sessionDir: runDir,
    sessionFile: sessionResolution.sessionFile,
    cleanupSessionFile: sessionResolution.cleanupSessionFile,
    handoffMode: resolveHandoffMode(agent.name, handoffConfig),
    handoffState: "none",
    handoffAttempts: 0,
    handoffMaxAttempts: normalizePositiveInteger(
      handoffConfig.maxAttempts,
      DEFAULT_HANDOFF_MAX_ATTEMPTS,
    ),
    handoffBackoffMs: normalizePositiveInteger(handoffConfig.backoffMs, DEFAULT_HANDOFF_BACKOFF_MS),
  };

  writeAsyncStatus(run);

  if (sessionResolution.error) return run;

  // Write system prompt to temp file if agent has one
  let tmpPromptDir: string | null = null;
  let tmpPromptPath: string | null = null;

  if (agent.systemPrompt.trim()) {
    const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
    tmpPromptDir = tmp.dir;
    tmpPromptPath = tmp.filePath;
  }

  const args = buildLeaderArgs(task, ctx, agent, mode, sessionFile, tmpPromptPath);

  const logStream = fs.createWriteStream(logPath(runId), { flags: "a" });

  const currentDepth = Number.parseInt(process.env.PI_LEADERS_DEPTH ?? "0", 10) || 0;
  const nextDepth = String(currentDepth + 1);

  const childEnv = {
    ...process.env,
    [CHILD_ENV]: "1",
    PI_LEADERS_DEPTH: nextDepth,
  };

  const proc = spawn("pi", args, {
    cwd: ctx.cwd,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  run.pid = proc.pid;
  writeAsyncStatus(run);

  // Pipe stdout to log file
  proc.stdout.pipe(logStream);
  proc.stderr.pipe(logStream);

  proc.on("close", (code) => {
    const current = readAsyncStatus(runId);
    if (!current) return;

    current.status = code === 0 ? "completed" : "failed";
    current.completedAt = new Date().toISOString();
    current.exitCode = code ?? 0;

    // Parse the log file for structured result
    const result = parseLogForResult(runId, agent, task, mode, sessionFile, code ?? 0);
    current.result = hideCleanupSessionFile(result, current);
    prepareHandoff(current);
    const cleanupSucceeded = cleanupAsyncSessionFile(current);
    if (cleanupSucceeded && current.cleanupSessionFile) {
      current.sessionFile = undefined;
    }
    writeAsyncStatus(current);

    // Clean up temp prompt file and log stream
    cleanupTempFile(tmpPromptDir, tmpPromptPath);
    logStream.close();
  });

  proc.on("error", (error) => {
    const current = readAsyncStatus(runId);
    if (!current) return;

    current.status = "failed";
    current.completedAt = new Date().toISOString();
    current.exitCode = 1;
    const result: LeaderSingleResult = {
      agent: agent.name,
      agentSource: agent.source,
      task,
      exitCode: 1,
      signal: null,
      mode,
      sessionFile,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        contextTokens: 0,
        turns: 0,
      },
      displayItems: [],
      finalOutput: `Async leader failed to start: ${error.message}`,
      stderr: error.message,
    };
    current.result = hideCleanupSessionFile(result, current);
    prepareHandoff(current);
    const cleanupSucceeded = cleanupAsyncSessionFile(current);
    if (cleanupSucceeded && current.cleanupSessionFile) {
      current.sessionFile = undefined;
    }
    writeAsyncStatus(current);
    logStream.close();
  });

  // Don't wait for child — let it run in background
  proc.unref();

  return run;
};

const prepareHandoff = (run: LeaderAsyncRun): void => {
  run.handoffMode ??= resolveHandoffMode(run.agent);
  run.handoffMaxAttempts ??= DEFAULT_HANDOFF_MAX_ATTEMPTS;
  run.handoffBackoffMs ??= DEFAULT_HANDOFF_BACKOFF_MS;
  if (run.handoffMode === "disabled") {
    run.handoffState = "none";
    return;
  }
  run.handoffState = "pending";
  const envelope = buildHandoffEnvelope(run);
  if (!envelope) return;
  persistHandoffEnvelope(run.id, envelope);
  if (run.handoffMode === "queued") queueHandoffEnvelope(envelope);
};

// ── Parse Log For Result ───────────────────────────────────────────────────────

const parseLogForResult = (
  runId: string,
  agent: LeaderAgentConfig,
  task: string,
  mode: LeaderSessionMode,
  sessionFile: string | undefined,
  exitCode: number,
): LeaderSingleResult => {
  const logFile = logPath(runId);
  if (!fs.existsSync(logFile)) {
    return {
      agent: agent.name,
      agentSource: agent.source,
      task,
      exitCode,
      signal: null,
      mode,
      sessionFile,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        contextTokens: 0,
        turns: 0,
      },
      displayItems: [],
      finalOutput: "(no output captured)",
      stderr: "",
    };
  }

  // Re-parse the log file like we parse stdout in foreground mode
  const logContent = fs.readFileSync(logFile, "utf-8");
  const state = createStreamParseState();
  let stderrBuffer = "";

  for (const line of logContent.split("\n")) {
    processStreamChunk("", line + "\n", state);
  }

  return {
    agent: agent.name,
    agentSource: agent.source,
    task,
    exitCode,
    signal: null,
    mode,
    sessionFile,
    usage: { ...state.usage },
    displayItems: [...state.displayItems],
    finalOutput: getFinalOutput(state) || "(no output)",
    model: state.model,
    stopReason: state.stopReason,
    errorMessage: state.errorMessage,
    stderr: stderrBuffer,
  };
};

// ── Format Async Status ────────────────────────────────────────────────────────

const normalizePositiveInteger = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) && value !== undefined && value > 0 ? Math.floor(value) : fallback;

export const resolveHandoffMode = (
  agent: string,
  config: Pick<LeaderHandoffConfig, "mode"> = {},
): LeaderAsyncHandoffMode => {
  if (config.mode && config.mode !== "auto") return config.mode;
  const immediateAgents = new Set(["planner", "reviewer", "oracle"]);
  return immediateAgents.has(agent) ? "immediate" : "queued";
};

export const buildHandoffEnvelope = (run: LeaderAsyncRun): LeaderHandoffEnvelope | null => {
  if (!run.result || run.handoffMode === "disabled") return null;
  const summaryRaw = run.result.finalOutput?.trim() || "(no output)";
  const summary =
    summaryRaw.length > 1200 ? `${summaryRaw.slice(0, 1200)}... (truncated)` : summaryRaw;

  return {
    eventType: "leaders:async-complete",
    runId: run.id,
    agent: run.agent,
    task: run.task,
    status: run.status,
    summary,
    usage: run.result.usage,
    artifactPath: logPath(run.id),
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    handoffMode: run.handoffMode === "queued" ? "queued" : "immediate",
  };
};

export const persistHandoffEnvelope = (runId: string, envelope: LeaderHandoffEnvelope): void => {
  fs.writeFileSync(handoffPath(runId), JSON.stringify(envelope, null, 2), "utf-8");
};

const readDeliveredHandoffIndex = (): Record<string, string> => {
  const file = handoffDeliveredIndexPath();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, string>;
  } catch {
    return {};
  }
};

const writeDeliveredHandoffIndex = (index: Record<string, string>): void => {
  ensureAsyncDir();
  fs.writeFileSync(handoffDeliveredIndexPath(), JSON.stringify(index, null, 2), "utf-8");
};

export const isHandoffDelivered = (runId: string): boolean => runId in readDeliveredHandoffIndex();

export const markHandoffDelivered = (runId: string): void => {
  const index = readDeliveredHandoffIndex();
  index[runId] = new Date().toISOString();
  writeDeliveredHandoffIndex(index);
  const run = readAsyncStatus(runId);
  if (run) {
    run.handoffState = "delivered";
    run.handoffDeliveredAt = index[runId];
    run.handoffLastError = undefined;
    writeAsyncStatus(run);
  }
};

export const markHandoffFailedAttempt = (runId: string, error: unknown): void => {
  const run = readAsyncStatus(runId);
  if (!run) return;
  const attempts = (run.handoffAttempts ?? 0) + 1;
  const maxAttempts = run.handoffMaxAttempts ?? DEFAULT_HANDOFF_MAX_ATTEMPTS;
  run.handoffAttempts = attempts;
  run.handoffLastError = error instanceof Error ? error.message : String(error);
  if (attempts >= maxAttempts) {
    run.handoffState = "failed";
    run.handoffNextAttemptAt = undefined;
  } else {
    run.handoffState = "pending";
    const backoffMs = run.handoffBackoffMs ?? DEFAULT_HANDOFF_BACKOFF_MS;
    run.handoffNextAttemptAt = new Date(Date.now() + backoffMs * 2 ** (attempts - 1)).toISOString();
  }
  writeAsyncStatus(run);
};

export const queueHandoffEnvelope = (envelope: LeaderHandoffEnvelope): void => {
  const run = readAsyncStatus(envelope.runId);
  if (isHandoffDelivered(envelope.runId) || run?.handoffState === "failed") return;
  fs.appendFileSync(handoffQueuePath(), `${JSON.stringify(envelope)}\n`, "utf-8");
};

export const consumeQueuedHandoffs = (
  limit = 3,
): { batch: LeaderHandoffEnvelope[]; remaining: number } => {
  const file = handoffQueuePath();
  if (!fs.existsSync(file)) return { batch: [], remaining: 0 };

  const lines = fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const envelopes = lines
    .map((line) => {
      try {
        return JSON.parse(line) as LeaderHandoffEnvelope;
      } catch {
        return null;
      }
    })
    .filter((value): value is LeaderHandoffEnvelope => value != null);

  const now = Date.now();
  const seen = new Set<string>();
  const eligible = envelopes.filter((envelope) => {
    if (seen.has(envelope.runId) || isHandoffDelivered(envelope.runId)) return false;
    seen.add(envelope.runId);
    const run = readAsyncStatus(envelope.runId);
    if (run?.handoffState === "failed") return false;
    if (run?.handoffNextAttemptAt && new Date(run.handoffNextAttemptAt).getTime() > now)
      return false;
    return true;
  });
  const batch = eligible.slice(0, limit);

  // Do not destructively remove selected entries before delivery succeeds.
  // Successful deliveries are filtered on the next read via the delivered index;
  // failed deliveries retain their queue entry for retry/backoff. This favors
  // at-least-once persistence over losing handoffs on process crashes mid-flush.
  const remaining = envelopes.filter(
    (envelope) => !batch.includes(envelope) && !isHandoffDelivered(envelope.runId),
  ).length;

  return { batch, remaining };
};

export const formatAsyncStatus = (run: LeaderAsyncRun): string => {
  const statusIcon =
    run.status === "completed"
      ? "✓"
      : run.status === "failed"
        ? "✗"
        : run.status === "running"
          ? "⏳"
          : "⊘";
  const duration = run.completedAt
    ? ` (${((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s)`
    : "";

  let text = `${statusIcon} leader ${run.agent} [${run.id.slice(0, 8)}] ${run.status}${duration}`;
  text += `\n    Task: ${run.task.length > 80 ? `${run.task.slice(0, 80)}...` : run.task}`;
  text += `\n    Mode: ${run.mode}`;
  if (hasPendingSessionCleanup(run)) {
    text += `\n    Cleanup: pending temporary session deletion`;
  }
  if (run.handoffMode) {
    text += `\n    Handoff: ${run.handoffMode}/${run.handoffState ?? "none"}`;
    if (run.handoffAttempts)
      text += ` (${run.handoffAttempts}/${run.handoffMaxAttempts ?? DEFAULT_HANDOFF_MAX_ATTEMPTS} attempts)`;
    if (run.handoffNextAttemptAt) text += ` next ${run.handoffNextAttemptAt}`;
    if (run.handoffLastError) text += ` error: ${run.handoffLastError}`;
  }

  if (run.result) {
    const usage = run.result.usage;
    if (usage.turns > 0) text += `\n    Turns: ${usage.turns}`;
    if (run.result.model) text += `\n    Model: ${run.result.model}`;

    const finalOutput = run.result.finalOutput || "(no output)";
    text += `\n\n${finalOutput.length > 500 ? `${finalOutput.slice(0, 500)}...` : finalOutput}`;
  }

  return text;
};
