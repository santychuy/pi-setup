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
import {
  CHILD_ENV,
  makeSessionFile,
  writePromptToTempFile,
  cleanupTempFile,
  ASYNC_DIR,
} from "./utils.js";
import { buildLeaderArgs } from "./spawn-builder.js";

// ── Types ─────────────────────────────────────────────────────────────────────

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
}

// ── Constants ──────────────────────────────────────────────────────────────────

const ASYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Status File I/O ───────────────────────────────────────────────────────────

const ensureAsyncDir = (): void => {
  fs.mkdirSync(ASYNC_DIR, { recursive: true });
};

const statusPath = (runId: string): string => path.join(ASYNC_DIR, runId, "status.json");
const logPath = (runId: string): string => path.join(ASYNC_DIR, runId, "output.log");

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
  fs.writeFileSync(statusPath(run.id), JSON.stringify(run, null, 2), "utf-8");
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

export const cleanupOldAsyncRuns = (): void => {
  if (!fs.existsSync(ASYNC_DIR)) return;
  const now = Date.now();
  for (const entry of fs.readdirSync(ASYNC_DIR)) {
    const run = readAsyncStatus(entry);
    if (!run) continue;
    const completedAt = run.completedAt ? new Date(run.completedAt).getTime() : now;
    if (now - completedAt > ASYNC_MAX_AGE_MS) {
      fs.rmSync(path.join(ASYNC_DIR, entry), { recursive: true, force: true });
    }
  }
};

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
): Promise<LeaderAsyncRun> => {
  const runId = randomUUID();
  const runDir = path.join(ASYNC_DIR, runId);
  ensureAsyncDir();
  fs.mkdirSync(runDir, { recursive: true });

  const sessionFile = mode !== "ephemeral" ? makeSessionFile("leader-async") : undefined;

  const run: LeaderAsyncRun = {
    id: runId,
    agent: agent.name,
    task,
    mode,
    status: "running",
    startedAt: new Date().toISOString(),
    sessionDir: runDir,
  };

  writeAsyncStatus(run);

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
    current.result = parseLogForResult(runId, agent, task, mode, sessionFile, code ?? 0);
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
    current.result = {
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
    writeAsyncStatus(current);
    logStream.close();
  });

  // Don't wait for child — let it run in background
  proc.unref();

  return run;
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

  if (run.result) {
    const usage = run.result.usage;
    if (usage.turns > 0) text += `\n    Turns: ${usage.turns}`;
    if (run.result.model) text += `\n    Model: ${run.result.model}`;

    const finalOutput = run.result.finalOutput || "(no output)";
    text += `\n\n${finalOutput.length > 500 ? `${finalOutput.slice(0, 500)}...` : finalOutput}`;
  }

  return text;
};
