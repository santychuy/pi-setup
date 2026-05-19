/**
 * Leaders extension — foreground leader subagents for Pi delegation.
 *
 * Spawns child Pi processes with isolated context and streams their
 * JSON output back as structured results.
 *
 * Session modes:
 *   - ephemeral: one-shot, no saved session (default)
 *   - persistent: saved session for follow-up/continuity
 *   - fork: branch from parent context for context-aware tasks
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { DEFAULT_BUDGET_POLICY, MAX_AGENTS_PER_RUN_CAP, MAX_PARALLEL_CAP } from "./src/types.js";
import type {
  LeaderAgentConfig,
  LeaderBudgetPolicy,
  LeaderDelegationContract,
  LeaderParallelAbortReason,
  LeaderParallelResult,
  LeaderParallelTaskInput,
  LeaderParallelTaskResult,
  LeaderSingleResult,
  LeaderAgentDiscoveryResult,
  LeaderSessionMode,
} from "./src/types.js";
import { LeaderTracker } from "./src/tracker.js";
import { renderLeadersWidget } from "./src/widget.js";

import { createStreamParseState, getFinalOutput, processStreamChunk } from "./src/stream-parser.js";
import { formatLeaderResult, formatParallelLeaderResult, formatUsageStats } from "./src/format.js";
import { getRunStatusMeta, getStatusMeta, PARALLEL_STATUS_ORDER } from "./src/status-display.js";
import { CHILD_ENV, writePromptToTempFile, cleanupTempFile } from "./src/utils.js";
import { addUsage, zeroUsage } from "./src/usage.js";
import { parseLeaderCommand } from "./src/command-parser.js";
import { validateContractResult, type ContractValidationResult } from "./src/contract.js";
import { discoverLeaderAgents, resolveAgent } from "./src/agents.js";
import { buildLeaderArgs } from "./src/spawn-builder.js";
import { resolveLeaderSessionFile } from "./src/session.js";
import {
  spawnAsyncLeader,
  readAsyncStatus,
  listAsyncRuns,
  cleanupOldAsyncRuns,
  formatAsyncStatus,
  hasPendingSessionCleanup,
  retryPendingAsyncSessionCleanups,
} from "./src/async.js";

// ── Global Tracker Instance ─────────────────────────────────────────────────

const tracker = new LeaderTracker();

type OnUpdateCallback = (partial: {
  content: Array<{ type: "text"; text: string }>;
  details: LeaderSingleResult;
}) => void;

const runLeader = async (
  task: string,
  ctx: ExtensionContext,
  agent: LeaderAgentConfig,
  mode: LeaderSessionMode,
  signal?: AbortSignal,
  onUpdate?: OnUpdateCallback,
): Promise<LeaderSingleResult> => {
  // ── Track spawning ──────────────────────────────────────────────────────
  const entryId = tracker.add(agent.name, task, mode);

  // ── Session setup ──────────────────────────────────────────────────────
  const sessionResolution = resolveLeaderSessionFile(ctx, mode);
  const { cleanupSessionFile, sessionFile } = sessionResolution;

  // ── Handle fork failure ────────────────────────────────────────────────
  if (sessionResolution.error) {
    // Fork failed; mark tracker entry as failed and return error result
    tracker.markFailed(entryId, 1);
    return {
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
      finalOutput: sessionResolution.error,
      stderr: "",
    };
  }

  // ── System prompt ──────────────────────────────────────────────────────
  let tmpPromptDir: string | null = null;
  let tmpPromptPath: string | null = null;

  if (agent.systemPrompt.trim()) {
    const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
    tmpPromptDir = tmp.dir;
    tmpPromptPath = tmp.filePath;
  }

  // ── Spawn child ───────────────────────────────────────────────────────
  const args = buildLeaderArgs(task, ctx, agent, mode, sessionFile, tmpPromptPath);

  const streamState = createStreamParseState();

  const result: LeaderSingleResult = {
    agent: agent.name,
    agentSource: agent.source,
    task,
    exitCode: 0,
    signal: null,
    mode,
    sessionFile,
    usage: { ...streamState.usage },
    displayItems: [],
    finalOutput: "",
    stderr: "",
  };

  const emitUpdate = () => {
    if (!onUpdate) return;
    result.displayItems = [...streamState.displayItems];
    result.finalOutput = getFinalOutput(streamState) || "(running...)";
    result.usage = { ...streamState.usage };
    result.model = streamState.model;
    result.stopReason = streamState.stopReason;
    result.errorMessage = streamState.errorMessage;
    // turns is already inside result.usage via the spread above

    onUpdate({
      content: [{ type: "text", text: result.finalOutput }],
      details: { ...result, displayItems: [...result.displayItems] },
    });
  };

  // ── Mark running once child is about to spawn ─────────────────────────
  tracker.markRunning(entryId);

  return await new Promise<LeaderSingleResult>((resolve, reject) => {
    const nextDepth = String(getCurrentDepth() + 1);
    const proc = spawn("pi", args, {
      cwd: ctx.cwd,
      env: { ...process.env, [CHILD_ENV]: "1", [LEADERS_DEPTH_ENV]: nextDepth },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;

    const cleanup = (): void => {
      signal?.removeEventListener("abort", abort);
      cleanupTempFile(tmpPromptDir, tmpPromptPath);
      if (cleanupSessionFile && sessionFile) {
        try {
          fs.rmSync(sessionFile, { force: true });
        } catch {
          // Temporary fork cleanup is best-effort and should not replace the
          // leader result with a filesystem cleanup failure.
        }
      }
    };

    const settle = <T>(callback: () => T): T | undefined => {
      if (settled) return undefined;
      settled = true;
      const value = callback();
      cleanup();
      return value;
    };

    const abort = (): void => {
      if (proc.exitCode === null) proc.kill("SIGTERM");
      tracker.markCancelled(entryId);
    };

    signal?.addEventListener("abort", abort, { once: true });

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      stdoutBuffer = processStreamChunk(stdoutBuffer, chunk, streamState);
      emitUpdate();
    });

    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => {
      stderrBuffer += chunk;
    });

    proc.on("error", (error) => {
      tracker.markFailed(entryId, 1);
      settle(() => reject(error));
    });

    proc.on("close", (code, closeSignal) => {
      settle(() => {
        // Process any remaining buffer
        if (stdoutBuffer.trim()) {
          processStreamChunk("", "\n", streamState);
        }

        result.exitCode = code ?? 0;
        result.signal = closeSignal;
        result.displayItems = [...streamState.displayItems];
        result.finalOutput = getFinalOutput(streamState);
        result.usage = { ...streamState.usage };
        result.model = streamState.model;
        result.stopReason = streamState.stopReason;
        result.errorMessage = streamState.errorMessage;
        result.stderr = stderrBuffer.trim();
        if (cleanupSessionFile) {
          result.sessionFile = undefined;
        }

        // ── Tracker: mark terminal state ────────────────────────────
        const exitCode = code ?? 0;
        const wasAborted = closeSignal != null;
        if (wasAborted) {
          tracker.markCancelled(entryId);
        } else if (exitCode === 0) {
          tracker.markCompleted(entryId, exitCode);
        } else {
          tracker.markFailed(entryId, exitCode);
        }

        resolve(result);
      });
    });
  });
};

// ── Extension ────────────────────────────────────────────────────────────────

const WIDGET_KEY = "leaders";

/** Update the leaders widget from current tracker state. */
const updateWidget = (ctx: ExtensionContext): void => {
  const entries = tracker.getAll();
  const lines = renderLeadersWidget(entries, ctx.ui.theme);
  ctx.ui.setWidget(WIDGET_KEY, lines, { placement: "aboveEditor" });
};

const LEADERS_DEPTH_ENV = "PI_LEADERS_DEPTH";

const getCurrentDepth = (): number => {
  const parsed = Number.parseInt(process.env[LEADERS_DEPTH_ENV] ?? "0", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const isDepthAllowed = (policy: LeaderBudgetPolicy): boolean =>
  getCurrentDepth() < policy.limits.maxDelegationDepth;

const ASYNC_POLL_INTERVAL_MS = 2000;

const runParallelLeaders = async (
  tasks: LeaderParallelTaskInput[],
  ctx: ExtensionContext,
  discovery: LeaderAgentDiscoveryResult,
  budget: LeaderBudgetPolicy,
  signal?: AbortSignal,
): Promise<LeaderParallelResult> => {
  const maxParallel = Math.min(Math.max(1, budget.limits.maxParallel), MAX_PARALLEL_CAP);
  const queue = tasks.map((task, index) => ({
    ...task,
    queueIndex: index,
    id: task.id ?? `task-${index + 1}`,
  }));
  const results: Array<LeaderParallelTaskResult | undefined> = new Array(queue.length);
  let totalUsage = zeroUsage();
  let abortReason: LeaderParallelAbortReason | undefined;
  let blockedReason: "maxTokensTotal" | "maxCostUsdTotal" | undefined;

  const controller = new AbortController();
  const abortWith = (
    reason: LeaderParallelAbortReason,
    blocked?: "maxTokensTotal" | "maxCostUsdTotal",
  ) => {
    if (!abortReason) {
      abortReason = reason;
      if (blocked) blockedReason = blocked;
    }
    if (!controller.signal.aborted) controller.abort();
  };

  const abortAll = () => abortWith("cancelled");
  signal?.addEventListener("abort", abortAll, { once: true });

  const timeout = setTimeout(() => {
    abortWith("timed_out");
  }, budget.limits.maxDurationMs);

  const worker = async () => {
    while (queue.length > 0 && !controller.signal.aborted) {
      if (
        budget.limits.maxTokensTotal &&
        totalUsage.input + totalUsage.output >= budget.limits.maxTokensTotal
      ) {
        abortWith("budget_exceeded", "maxTokensTotal");
        break;
      }
      if (budget.limits.maxCostUsdTotal && totalUsage.cost >= budget.limits.maxCostUsdTotal) {
        abortWith("budget_exceeded", "maxCostUsdTotal");
        break;
      }

      const next = queue.shift();
      if (!next) break;
      const index = next.queueIndex;
      const resolved = resolveAgent(next.agent, discovery);
      if (typeof resolved === "string") {
        results[index] = {
          id: next.id,
          task: next.task,
          agent: next.agent ?? "default",
          mode: "ephemeral",
          status: "failed",
          error: resolved,
        };
        continue;
      }

      const mode: LeaderSessionMode = next.mode ?? resolved.sessionMode ?? "ephemeral";
      const startedAt = Date.now();
      try {
        const single = await runLeader(next.task, ctx, resolved, mode, controller.signal);
        totalUsage = addUsage(totalUsage, single.usage);
        const status =
          abortReason === "timed_out"
            ? "timed_out"
            : abortReason === "budget_exceeded"
              ? "budget_exceeded"
              : single.exitCode === 0
                ? "completed"
                : "failed";

        results[index] = {
          id: next.id,
          task: next.task,
          agent: resolved.name,
          mode,
          status,
          result: single,
          startedAt,
          endedAt: Date.now(),
          abortReason,
          blockedReason,
        };
      } catch (error) {
        const status =
          abortReason === "timed_out"
            ? "timed_out"
            : abortReason === "budget_exceeded"
              ? "budget_exceeded"
              : abortReason === "cancelled" || controller.signal.aborted
                ? "cancelled"
                : "failed";
        results[index] = {
          id: next.id,
          task: next.task,
          agent: resolved.name,
          mode,
          status,
          error: error instanceof Error ? error.message : String(error),
          startedAt,
          endedAt: Date.now(),
          abortReason,
          blockedReason,
        };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(maxParallel, queue.length || 1) }, () => worker()),
  );
  clearTimeout(timeout);
  signal?.removeEventListener("abort", abortAll);

  for (const task of queue) {
    const index = task.queueIndex;
    results[index] = {
      id: task.id ?? "queued",
      task: task.task,
      agent: task.agent ?? "default",
      mode: task.mode ?? "ephemeral",
      status:
        abortReason === "budget_exceeded"
          ? "budget_blocked"
          : abortReason === "timed_out"
            ? "timed_out"
            : "cancelled",
      abortReason,
      blockedReason,
    };
  }

  const finalized = results.filter(Boolean) as LeaderParallelTaskResult[];
  const completed = finalized.filter((r) => r.status === "completed").length;
  const allCompleted = completed === finalized.length;
  const allFailed = finalized.every((r) => r.status === "failed");
  const status: LeaderParallelResult["status"] =
    abortReason === "timed_out"
      ? "timed_out"
      : abortReason === "budget_exceeded"
        ? "budget_exceeded"
        : abortReason === "cancelled"
          ? completed > 0
            ? "partial"
            : "cancelled"
          : allCompleted
            ? "completed"
            : allFailed
              ? "failed"
              : completed > 0
                ? "partial"
                : "failed";

  return { status, tasks: finalized, usage: totalUsage, abortReason, blockedReason };
};

const leadersExtension = (pi: ExtensionAPI): void => {
  // ── Widget: re-render on tracker state changes ───────────────────────────
  // We store the latest ExtensionContext so the tracker callback can update
  // the widget even during streaming (no active event handler context).
  let latestCtx: ExtensionContext | null = null;
  let asyncPollTimer: ReturnType<typeof setInterval> | null = null;

  const ensurePolling = () => {
    const needsPolling = tracker
      .getAll()
      .some((e) => e.source === "async" && (e.status === "running" || e.status === "spawning"));
    if (needsPolling && !asyncPollTimer) {
      asyncPollTimer = setInterval(pollAsyncRuns, ASYNC_POLL_INTERVAL_MS);
    }
  };

  tracker.onUpdate(() => {
    if (!latestCtx) return;
    updateWidget(latestCtx);
    ensurePolling();
  });

  // ── Async poll: sync async run status from disk ──────────────────────────
  const pollAsyncRuns = () => {
    if (!latestCtx) return;
    const runs = listAsyncRuns();
    tracker.syncAsyncRuns(runs);
    const hasActive = tracker
      .getAll()
      .some((e) => e.source === "async" && (e.status === "running" || e.status === "spawning"));
    // Always prune completed async entries on poll
    tracker.pruneCompleted();
    updateWidget(latestCtx);

    // Stop polling when there are no more active async runs and
    // we previously had active ones (or just started polling).
    if (!hasActive && asyncPollTimer) {
      clearInterval(asyncPollTimer);
      asyncPollTimer = null;
    }
  };

  // ── Tool registration ───────────────────────────────────────────────────
  pi.registerTool({
    name: "leader",
    label: "Leader",
    description: [
      "Delegate one foreground task to a focused leader subagent.",
      "",
      "Modes:",
      "  - ephemeral (default): one-shot, no saved session. Best for exploration, research, reviews, Q&A.",
      "  - persistent: saved session for follow-up, continuity, or audit.",
      "  - fork: branch from parent context. Best for context-aware tasks like continuing a discussion.",
      "  - ephemeral-fork: branch from parent context for a one-shot run, then delete the branch after completion.",
      "",
      "Agents: Use the 'list' action to discover available agent profiles, or omit agent for the default.",
    ].join("\n"),
    promptSnippet:
      "Delegate tasks to specialized leader subagents (scout, planner, worker, reviewer, oracle)",
    promptGuidelines: [
      "Use leader to delegate focused tasks that benefit from isolated context or a specialized agent profile.",
      "Use leader with agent 'scout' for fast codebase exploration, 'planner' for read-only plans, 'reviewer' for code review, 'oracle' for research and Q&A, 'worker' for implementation.",
      "Use leader when a task would benefit from a clean context window rather than the full conversation history.",
      "Use leader with mode 'ephemeral' for one-shot tasks and 'fork' when the subagent needs parent conversation context.",
      "Use leader({ task }) for dependent/sequential work and leader({ tasks: [...] }) for independent work that can run concurrently.",
      "For parallel runs, keep fan-out small (2-3 tasks) and avoid parallel file-writing tasks unless explicitly requested.",
      "Always call leader with action 'list' first to check available agents and pick the best one for the task.",
    ],
    parameters: Type.Object({
      task: Type.Optional(
        Type.String({
          description: "Single task for one leader run. Use for dependent/sequential work.",
        }),
      ),
      tasks: Type.Optional(
        Type.Array(
          Type.Object({
            id: Type.Optional(Type.String()),
            task: Type.String(),
            agent: Type.Optional(Type.String()),
            mode: Type.Optional(
              Type.Union([
                Type.Literal("ephemeral"),
                Type.Literal("persistent"),
                Type.Literal("fork"),
                Type.Literal("ephemeral-fork"),
              ]),
            ),
          }),
        ),
      ),
      contract: Type.Optional(
        Type.Object({
          version: Type.Literal("1.0"),
          taskId: Type.String(),
          goal: Type.String(),
        }),
      ),
      budget: Type.Optional(
        Type.Object({
          version: Type.Literal("1.0"),
          limits: Type.Object({
            maxAgentsPerRun: Type.Number(),
            maxParallel: Type.Number(),
            maxDelegationDepth: Type.Number(),
            maxDurationMs: Type.Number(),
            maxTokensTotal: Type.Optional(Type.Number()),
            maxCostUsdTotal: Type.Optional(Type.Number()),
          }),
        }),
      ),
      mode: Type.Optional(
        Type.Union([
          Type.Literal("ephemeral", {
            description:
              "One-shot, no saved session. Best for exploration, research, reviews, Q&A.",
          }),
          Type.Literal("persistent", {
            description: "Saved session for follow-up, continuity, or audit.",
          }),
          Type.Literal("fork", {
            description:
              "Branch from parent context. Best for context-aware tasks like continuing a discussion.",
          }),
          Type.Literal("ephemeral-fork", {
            description:
              "Branch from parent context for a one-shot foreground or async run, then delete the temporary branch after completion.",
          }),
        ]),
      ),
      agent: Type.Optional(
        Type.String({
          description: "Agent profile name. Use 'list' action to discover available agents.",
        }),
      ),
      action: Type.Optional(
        Type.Union([
          Type.Literal("run", { description: "Run a leader (default)." }),
          Type.Literal("list", { description: "List available agent profiles." }),
          Type.Literal("status", { description: "Check status of an async leader run." }),
          Type.Literal("cleanup", {
            description: "Retry pending async leader temporary session cleanup.",
          }),
        ]),
      ),
      async: Type.Optional(
        Type.Boolean({
          description: "Run leader in the background. Returns run ID immediately.",
        }),
      ),
      id: Type.Optional(
        Type.String({
          description: "Run ID for status queries (from a previous async run).",
        }),
      ),
    }),
    execute: async (_toolCallId, params, signal, onUpdate, ctx) => {
      const discovery = discoverLeaderAgents();

      // ── List action ────────────────────────────────────────────────────
      if (params.action === "list") {
        const lines = discovery.agents.map((a) => {
          const sourceTag = a.source === "builtin" ? "" : ` (${a.source})`;
          const toolList = a.tools?.join(", ") ?? "default";
          return `- **${a.name}**${sourceTag}: ${a.description} [tools: ${toolList}]`;
        });
        return {
          content: [{ type: "text", text: `Available leader agents:\n\n${lines.join("\n")}` }],
          details: { agents: discovery.agents },
        };
      }

      // ── Status action ──────────────────────────────────────────────
      if (params.action === "status") {
        if (params.id) {
          const run = readAsyncStatus(params.id);
          if (!run) {
            return {
              content: [{ type: "text", text: `No async run found with ID ${params.id}.` }],
              details: {},
            };
          }
          return {
            content: [{ type: "text", text: formatAsyncStatus(run) }],
            details: { run },
          };
        }
        // List all async runs
        const runs = listAsyncRuns();
        if (runs.length === 0) {
          return { content: [{ type: "text", text: "No async leader runs." }], details: {} };
        }
        const lines = runs.map((r) => {
          const icon =
            r.status === "completed"
              ? "✓"
              : r.status === "failed"
                ? "✗"
                : r.status === "running"
                  ? "⏳"
                  : "⊘";
          const cleanup = hasPendingSessionCleanup(r) ? " · cleanup pending" : "";
          return `${icon} ${r.id.slice(0, 8)} ${r.agent} ${r.status}${cleanup} — ${r.task.slice(0, 50)}`;
        });
        return {
          content: [{ type: "text", text: `Async leader runs:\n\n${lines.join("\n")}` }],
          details: { runs },
        };
      }

      // ── Cleanup action ──────────────────────────────────────────────
      if (params.action === "cleanup") {
        const summary = retryPendingAsyncSessionCleanups();
        const text =
          `Async cleanup retried.\n` +
          `Retried: ${summary.retried}\n` +
          `Succeeded: ${summary.succeeded}\n` +
          `Failed: ${summary.failed}\n` +
          `Pending: ${summary.pending}`;

        return {
          content: [{ type: "text", text }],
          details: { cleanup: summary },
        };
      }

      // ── Run action ────────────────────────────────────────
      const task = params.task;
      const tasks = params.tasks as LeaderParallelTaskInput[] | undefined;
      const budget: LeaderBudgetPolicy = params.budget ?? DEFAULT_BUDGET_POLICY;
      const contract: LeaderDelegationContract | undefined = params.contract;

      if (!isDepthAllowed(budget)) {
        return {
          content: [
            {
              type: "text",
              text: `Delegation blocked by budget policy: maxDelegationDepth=${budget.limits.maxDelegationDepth}.`,
            },
          ],
          details: { budget, blocked: "maxDelegationDepth" },
        };
      }
      if (task && tasks?.length) {
        return {
          content: [{ type: "text", text: "Provide either task or tasks, not both." }],
          details: {},
        };
      }
      if (!task && (!tasks || tasks.length === 0)) {
        return {
          content: [
            {
              type: "text",
              text: "Provide task or tasks. Usage: leader({ task: '...' }) or leader({ tasks: [{ task: '...' }] })",
            },
          ],
          details: {},
        };
      }

      if (tasks && tasks.length > Math.min(budget.limits.maxAgentsPerRun, MAX_AGENTS_PER_RUN_CAP)) {
        return {
          content: [
            {
              type: "text",
              text: `Parallel delegation blocked: maxAgentsPerRun=${Math.min(budget.limits.maxAgentsPerRun, MAX_AGENTS_PER_RUN_CAP)}.`,
            },
          ],
          details: { budget, blocked: "maxAgentsPerRun" },
        };
      }

      if (tasks) {
        if (params.async) {
          return {
            content: [
              {
                type: "text",
                text: "Parallel async runs are not supported yet. Use foreground tasks[].",
              },
            ],
            details: {},
          };
        }

        const parallelResult = await runParallelLeaders(tasks, ctx, discovery, budget, signal);
        return {
          content: [{ type: "text", text: formatParallelLeaderResult(parallelResult) }],
          details: { ...parallelResult, budget },
        };
      }

      const resolved = resolveAgent(params.agent, discovery);
      if (typeof resolved === "string") {
        return { content: [{ type: "text", text: resolved }], details: {} };
      }

      const agent = resolved;
      const mode: LeaderSessionMode = params.mode ?? agent.sessionMode ?? "ephemeral";

      // ── Async or foreground execution ──────────────────────────────
      const delegatedTask = contract
        ? `${task}\n\nReturn your final answer as a single JSON object matching this minimum schema:\n{\n  "taskId": "${contract.taskId}",\n  "status": "success|partial|failed|blocked",\n  "summary": "string"\n}`
        : (task as string);

      if (params.async) {
        const asyncRun = await spawnAsyncLeader(delegatedTask, ctx, agent, mode, budget);

        // Track the async run in the widget
        tracker.addAsync(asyncRun);
        updateWidget(ctx);

        const text =
          asyncRun.status === "failed"
            ? `Leader failed to start in background.\nID: ${asyncRun.id}\nAgent: ${asyncRun.agent}\nMode: ${asyncRun.mode}\nStatus: ${asyncRun.status}\n\n${asyncRun.result?.finalOutput ?? "Unknown async leader startup failure."}`
            : `Leader started in background.\nID: ${asyncRun.id}\nAgent: ${asyncRun.agent}\nMode: ${asyncRun.mode}\nStatus: ${asyncRun.status}\n\nCheck status with: leader({ action: "status", id: "${asyncRun.id}" })`;

        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
          details: { run: asyncRun, budget, contract },
        };
      }

      const result = await runLeader(delegatedTask, ctx, agent, mode, signal, onUpdate);

      const validation = contract
        ? validateContractResult(contract, result.finalOutput)
        : ({ ok: true } as ContractValidationResult);

      if (!validation.ok) {
        const schemaErrorResult: LeaderSingleResult = {
          ...result,
          exitCode: result.exitCode === 0 ? 1 : result.exitCode,
          errorMessage: `schema_error: ${validation.error}`,
          stopReason: "error",
        };

        return {
          content: [
            {
              type: "text",
              text: `${formatLeaderResult(schemaErrorResult)}\n\nContract validation failed: ${validation.error}`,
            },
          ],
          details: {
            ...schemaErrorResult,
            budget,
            contract,
            contractValidation: validation,
          },
        };
      }

      return {
        content: [{ type: "text", text: formatLeaderResult(result) }],
        details: { ...result, budget, contract, contractValidation: validation },
      };
    },

    renderCall(args, theme) {
      const agentName = args.agent || "default";
      return new Text(
        theme.fg("toolTitle", theme.bold("leader ")) + theme.fg("accent", agentName),
        0,
        0,
      );
    },

    renderResult(result, { isPartial }, theme) {
      const details = result.details;

      // Still running — widget shows live status
      if (isPartial) {
        return new Text(theme.fg("warning", "⏳"), 0, 0);
      }

      if (
        details &&
        typeof details === "object" &&
        "tasks" in details &&
        Array.isArray(details.tasks) &&
        "usage" in details
      ) {
        const parallel = details as LeaderParallelResult;
        const counts = parallel.tasks.reduce(
          (acc, task) => {
            acc[task.status] = (acc[task.status] ?? 0) + 1;
            return acc;
          },
          {} as Partial<Record<string, number>>,
        );

        const runMeta = getRunStatusMeta(parallel.status);
        const icon =
          parallel.status === "completed"
            ? theme.fg("success", runMeta.icon)
            : parallel.status === "failed"
              ? theme.fg("error", runMeta.icon)
              : theme.fg("warning", runMeta.icon);

        const parts = [`${icon} parallel`, `${parallel.tasks.length} total`];

        for (const status of PARALLEL_STATUS_ORDER) {
          const count = counts[status] ?? 0;
          if (count <= 0) continue;
          const meta = getStatusMeta(status);
          parts.push(`${meta.icon}${count}`);
        }

        const usage = formatUsageStats(parallel.usage);
        if (usage) parts.push(theme.fg("dim", usage));
        return new Text(parts.join(" · "), 0, 0);
      }

      // Not a leader run result (list/status actions) — plain text fallback
      if (!details || typeof details !== "object" || !("exitCode" in details)) {
        const text = result.content[0]?.type === "text" ? result.content[0].text : "";
        const preview = text.length > 150 ? `${text.slice(0, 150)}…` : text;
        return new Text(theme.fg("muted", preview), 0, 0);
      }

      const leader = details as LeaderSingleResult;
      const isOk =
        leader.exitCode === 0 && leader.stopReason !== "error" && leader.stopReason !== "aborted";

      const icon = isOk ? theme.fg("success", "✓") : theme.fg("error", "✗");
      const agent = theme.fg("accent", leader.agent);
      const usage = formatUsageStats(leader.usage, leader.model);

      if (!isOk) {
        const exitInfo = leader.signal ? `signal ${leader.signal}` : `exit ${leader.exitCode}`;
        return new Text(
          `${icon} ${agent} · ${theme.fg("error", exitInfo)} · ${theme.fg("dim", usage)}`,
          0,
          0,
        );
      }

      return new Text(`${icon} ${agent} · ${theme.fg("dim", usage)}`, 0, 0);
    },
  });

  // ── Command registration ─────────────────────────────────────────────────
  pi.registerCommand("leader", {
    description:
      "Run a foreground leader subagent. Defaults to ephemeral. Use @agent to pick a profile.",
    handler: async (args, ctx) => {
      const input = parseLeaderCommand(args);
      if (typeof input === "string") {
        ctx.ui.notify(input, "error");
        return;
      }

      const discovery = discoverLeaderAgents();
      const resolved = resolveAgent(input.agent, discovery);
      if (typeof resolved === "string") {
        ctx.ui.notify(resolved, "error");
        return;
      }

      const agent = resolved;
      ctx.ui.notify(`Leader started — ${agent.name} (${input.mode})...`, "info");
      try {
        const result = await runLeader(input.task, ctx, agent, input.mode, ctx.signal);
        pi.sendMessage(
          {
            customType: "leader-result",
            content: formatLeaderResult(result),
            display: true,
          },
          { deliverAs: "followUp", triggerTurn: true },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Leader failed: ${message}`, "error");
      }
    },
  });

  // ── Inject agent roster into system prompt on first turn ─────────────────
  let rosterInjected = false;

  pi.on("before_agent_start", async (event) => {
    if (process.env[CHILD_ENV] === "1") return;
    if (rosterInjected) return;

    const discovery = discoverLeaderAgents();
    if (discovery.agents.length === 0) return;

    rosterInjected = true;

    const agentLines = discovery.agents
      .map((a) => {
        const tools = a.tools?.length ? ` [tools: ${a.tools.join(", ")}]` : "";
        return `  - ${a.name}: ${a.description}${tools}`;
      })
      .join("\n");

    return {
      systemPrompt:
        event.systemPrompt +
        `\n\n## Leader Agents\n\nAvailable leader subagents:\n${agentLines}\n\nUse leader({ action: "list" }) for full details including modes and sources.`,
    };
  });

  // ── Session lifecycle ────────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    if (process.env[CHILD_ENV] === "1") return;
    latestCtx = ctx;
    rosterInjected = false;

    // Clear previous state
    if (asyncPollTimer) {
      clearInterval(asyncPollTimer);
      asyncPollTimer = null;
    }
    cleanupOldAsyncRuns();
    tracker.clear();

    // Only load actively running async runs into the tracker.
    // Completed/failed runs from previous sessions should not appear
    // in a fresh session's widget — they are available via
    // leader({ action: "status" }) if the user needs them.
    const existingRuns = listAsyncRuns();
    const activeRuns = existingRuns.filter((r) => r.status === "running");
    tracker.syncAsyncRuns(activeRuns);
    updateWidget(ctx);

    // Start polling only if there are still-running async runs
    // that were spawned in a previous session.
    if (activeRuns.length > 0) {
      asyncPollTimer = setInterval(pollAsyncRuns, ASYNC_POLL_INTERVAL_MS);
    }
  });

  // ── Prune completed entries after each turn ────────────────────────────────
  pi.on("turn_end", async (_event, ctx) => {
    if (process.env[CHILD_ENV] === "1") return;
    latestCtx = ctx;
    tracker.pruneCompleted();
    updateWidget(ctx);
  });

  // ── Also update on agent end (final cleanup) ──────────────────────────────
  pi.on("agent_end", async (_event, ctx) => {
    if (process.env[CHILD_ENV] === "1") return;
    latestCtx = ctx;
    tracker.pruneCompleted();
    updateWidget(ctx);
  });

  // ── Clean up polling on session shutdown ────────────────────────────────
  pi.on("session_shutdown", async () => {
    if (asyncPollTimer) {
      clearInterval(asyncPollTimer);
      asyncPollTimer = null;
    }
  });
};

export default leadersExtension;
