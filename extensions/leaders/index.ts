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
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { DEFAULT_AGENT, DEFAULT_BUDGET_POLICY } from "./src/types.js";
import type {
  LeaderAgentConfig,
  LeaderBudgetPolicy,
  LeaderDelegationContract,
  LeaderSingleResult,
  LeaderSessionMode,
} from "./src/types.js";
import { LeaderTracker } from "./src/tracker.js";
import { renderLeadersWidget } from "./src/widget.js";

import { createStreamParseState, getFinalOutput, processStreamChunk } from "./src/stream-parser.js";
import { formatLeaderResult, formatUsageStats } from "./src/format.js";
import { CHILD_ENV, makeSessionFile, writePromptToTempFile, cleanupTempFile } from "./src/utils.js";
import { buildLeaderArgs } from "./src/spawn-builder.js";
import {
  spawnAsyncLeader,
  readAsyncStatus,
  listAsyncRuns,
  cleanupOldAsyncRuns,
  formatAsyncStatus,
} from "./src/async.js";

// ── Forked Context ──────────────────────────────────────────────────────────

/**
 * Create a branched session file from the parent's current context.
 * Returns the branched session file path on success, or an error string on failure.
 */
const createForkedSessionFile = (ctx: ExtensionContext): string | undefined => {
  const parentFile = ctx.sessionManager.getSessionFile();

  if (!parentFile) {
    return undefined;
  }

  const leafId = ctx.sessionManager.getLeafId();
  if (!leafId) {
    return undefined;
  }

  try {
    const parentSession = SessionManager.open(parentFile);
    return parentSession.createBranchedSession(leafId) ?? undefined;
  } catch {
    return undefined;
  }
};

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
  let sessionFile: string | undefined;
  let forkError: string | undefined;

  if (mode === "fork") {
    const forkedPath = createForkedSessionFile(ctx);
    if (!forkedPath) {
      forkError =
        "Cannot fork: parent session has no persisted file or no entries. Use persistent or ephemeral mode instead.";
    } else {
      sessionFile = forkedPath;
    }
  } else if (mode === "persistent") {
    sessionFile = makeSessionFile();
  }

  // ── Handle fork failure → fall back to ephemeral ───────────────────────
  if (forkError && !sessionFile) {
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
      finalOutput: forkError,
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
    };

    const settle = <T>(callback: () => T): T | undefined => {
      cleanup();
      if (settled) return undefined;
      settled = true;
      return callback();
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

// ── Agent Discovery ──────────────────────────────────────────────────────────

import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { LeaderAgentDiscoveryResult } from "./src/types.js";

const USER_AGENTS_DIR = () => path.join(getAgentDir(), "leaders");

const loadAgentsFromDir = (
  dir: string,
  source: LeaderAgentConfig["source"],
): { agents: LeaderAgentConfig[]; errors: Array<{ path: string; error: string }> } => {
  const agents: LeaderAgentConfig[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  if (!fs.existsSync(dir)) return { agents, errors };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { agents, errors };
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      errors.push({ path: filePath, error: String(err) });
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);

    if (!frontmatter.name || !frontmatter.description) continue;

    const tools = frontmatter.tools
      ?.split(",")
      .map((t: string) => t.trim())
      .filter(Boolean);

    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: tools && tools.length > 0 ? tools : undefined,
      model: frontmatter.model,
      systemPrompt: body,
      systemPromptMode: (frontmatter.systemPromptMode as "replace" | "append") ?? "replace",
      inheritProjectContext: frontmatter.inheritProjectContext === "true",
      inheritSkills: frontmatter.inheritSkills === "true",
      sessionMode: (frontmatter.sessionMode as LeaderSessionMode) ?? "ephemeral",
      source,
      filePath,
    });
  }

  return { agents, errors };
};

const discoverLeaderAgents = (_cwd: string): LeaderAgentDiscoveryResult => {
  // Built-in agents from the extension's agents/ directory
  const builtinDir = path.join(__dirname, "agents");
  const builtinResult = loadAgentsFromDir(builtinDir, "builtin");

  // User agents from ~/.pi/agent/leaders/
  const userDir = USER_AGENTS_DIR();
  const userResult = loadAgentsFromDir(userDir, "user");

  // Priority: user > builtin > default
  const agentMap = new Map<string, LeaderAgentConfig>();

  // Default agent always available
  agentMap.set(DEFAULT_AGENT.name, DEFAULT_AGENT);

  // Built-in agents override default on name collision
  for (const agent of builtinResult.agents) {
    agentMap.set(agent.name, agent);
  }

  // User agents override everything
  for (const agent of userResult.agents) {
    agentMap.set(agent.name, agent);
  }

  return {
    agents: Array.from(agentMap.values()),
    errors: [...builtinResult.errors, ...userResult.errors],
  };
};

// ── Slash Command Parser ────────────────────────────────────────────────────

const SESSION_FLAGS = ["--ephemeral", "--persistent", "--fork"] as const;

interface LeaderCommandInput {
  task: string;
  mode: LeaderSessionMode;
  agent?: string;
}

const parseLeaderCommand = (args: string | undefined): LeaderCommandInput | string => {
  const tokens = args?.trim().split(/\s+/).filter(Boolean) ?? [];

  const flags = tokens.filter((t) => t.startsWith("--"));
  const nonFlags = tokens.filter((t) => !t.startsWith("--") && !t.startsWith("@"));

  // Parse agent @mentions: @scout, @planner, etc.
  const agentMentions = tokens.filter((t) => t.startsWith("@"));
  const agentName = agentMentions.length > 0 ? agentMentions[0].slice(1) : undefined;

  // Parse mode flags
  const modes = flags.filter((f) => SESSION_FLAGS.includes(f as (typeof SESSION_FLAGS)[number]));
  if (modes.length > 1) return "Use only one mode flag: --ephemeral, --persistent, or --fork";

  let mode: LeaderSessionMode = "ephemeral";
  if (modes.length === 1) {
    if (modes[0] === "--persistent") mode = "persistent";
    else if (modes[0] === "--fork") mode = "fork";
    else mode = "ephemeral";
  }

  const task = nonFlags.join(" ").trim();
  if (!task) return "Usage: /leader [--ephemeral|--persistent|--fork] [@agent] <task>";

  return { task, mode, agent: agentName };
};

// ── Resolve Agent ────────────────────────────────────────────────────────────

const resolveAgent = (
  agentName: string | undefined,
  discovery: LeaderAgentDiscoveryResult,
): LeaderAgentConfig | string => {
  if (!agentName) return DEFAULT_AGENT;

  const found = discovery.agents.find((a) => a.name === agentName);
  if (!found) {
    const available = discovery.agents.map((a) => a.name).join(", ");
    return `Unknown agent "${agentName}". Available: ${available}`;
  }

  return found;
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

interface ContractValidationResult {
  ok: boolean;
  parsed?: Record<string, unknown>;
  error?: string;
}

const parseJsonObjectFromText = (text: string): Record<string, unknown> | undefined => {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const validateContractResult = (
  contract: LeaderDelegationContract,
  output: string,
): ContractValidationResult => {
  const parsed = parseJsonObjectFromText(output);
  if (!parsed) {
    return { ok: false, error: "Missing JSON object result" };
  }

  const hasTaskId = parsed.taskId === contract.taskId;
  const hasStatus = typeof parsed.status === "string";
  const hasSummary = typeof parsed.summary === "string";

  if (!hasTaskId || !hasStatus || !hasSummary) {
    return {
      ok: false,
      error: "Invalid contract result schema: required { taskId, status, summary }",
    };
  }

  return { ok: true, parsed };
};

const getCurrentDepth = (): number => {
  const parsed = Number.parseInt(process.env[LEADERS_DEPTH_ENV] ?? "0", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const isDepthAllowed = (policy: LeaderBudgetPolicy): boolean =>
  getCurrentDepth() < policy.limits.maxDelegationDepth;

const leadersExtension = (pi: ExtensionAPI): void => {
  // ── Widget: re-render on tracker state changes ───────────────────────────
  // We store the latest ExtensionContext so the tracker callback can update
  // the widget even during streaming (no active event handler context).
  let latestCtx: ExtensionContext | null = null;

  tracker.onUpdate(() => {
    if (!latestCtx) return;
    updateWidget(latestCtx);
  });

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
      "When a user message contains multiple independent tasks, delegate each to a separate leader call rather than handling them sequentially yourself.",
      "Always call leader with action 'list' first to check available agents and pick the best one for the task.",
    ],
    parameters: Type.Object({
      task: Type.Optional(
        Type.String({ description: "The complete task for the leader to perform." }),
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
      const discovery = discoverLeaderAgents(ctx.cwd);

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
          return `${icon} ${r.id.slice(0, 8)} ${r.agent} ${r.status} — ${r.task.slice(0, 50)}`;
        });
        return {
          content: [{ type: "text", text: `Async leader runs:\n\n${lines.join("\n")}` }],
          details: { runs },
        };
      }

      // ── Run action ────────────────────────────────────────
      const task = params.task;
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
      if (!task) {
        return {
          content: [
            {
              type: "text",
              text: "Provide a task to delegate. Usage: leader({ task: '...', mode: 'ephemeral', agent: 'scout' })",
            },
          ],
          details: {},
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
        : task;

      if (params.async) {
        const asyncRun = await spawnAsyncLeader(delegatedTask, ctx, agent, mode, budget);
        return {
          content: [
            {
              type: "text",
              text: `Leader started in background.\nID: ${asyncRun.id}\nAgent: ${asyncRun.agent}\nMode: ${asyncRun.mode}\nStatus: ${asyncRun.status}\n\nCheck status with: leader({ action: "status", id: "${asyncRun.id}" })`,
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

      const discovery = discoverLeaderAgents(ctx.cwd);
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

  pi.on("before_agent_start", async (event, ctx) => {
    if (process.env[CHILD_ENV] === "1") return;
    if (rosterInjected) return;

    const discovery = discoverLeaderAgents(ctx.cwd);
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
    cleanupOldAsyncRuns();
    tracker.clear();
    updateWidget(ctx);
    ctx.ui.notify("Leaders extension loaded", "info");
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
};

export default leadersExtension;
