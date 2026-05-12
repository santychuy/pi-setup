import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const SESSION_DIR = path.join(os.homedir(), ".pi", "agent", "sessions", "leaders");
const LEADER_TOOLS = ["read", "bash", "grep", "find", "ls"] as const;
const SESSION_MODES = ["ephemeral", "persistent"] as const;
const DEFAULT_SESSION_MODE: LeaderSessionMode = "ephemeral";
const MAX_RESULT_CHARS = 24_000;
const CHILD_ENV = "PI_LEADERS_CHILD";

type LeaderSessionMode = (typeof SESSION_MODES)[number];

type LeaderRunResult = {
  output: string;
  mode: LeaderSessionMode;
  sessionFile?: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

type LeaderCommandInput = {
  task: string;
  mode: LeaderSessionMode;
};

type JsonRecord = Record<string, unknown>;

type TextDeltaEvent = {
  type: "message_update";
  assistantMessageEvent?: {
    type?: string;
    delta?: unknown;
  };
};

type MessageEvent = {
  type: "message";
  message?: {
    content?: unknown;
  };
};

type PiJsonEvent = TextDeltaEvent | MessageEvent | JsonRecord;

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const parseJsonLine = (line: string): PiJsonEvent | undefined => {
  if (!line.trim()) return undefined;

  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? (parsed as PiJsonEvent) : undefined;
  } catch {
    return undefined;
  }
};

const makeSessionFile = (): string => {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  return path.join(SESSION_DIR, `leader-${Date.now()}-${process.pid}-${randomUUID()}.jsonl`);
};

const modelArg = ({ model }: ExtensionContext): string | undefined =>
  model?.provider && model.id ? `${model.provider}/${model.id}` : undefined;

const truncateResult = (text: string): string =>
  text.length <= MAX_RESULT_CHARS
    ? text
    : `${text.slice(0, MAX_RESULT_CHARS)}\n\n... [leader output truncated at ${MAX_RESULT_CHARS} chars]`;

const extractTextFromContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("");
};

type ExtractedEventText = {
  text: string;
  source: "delta" | "message";
};

const extractTextFromEventLine = (line: string): ExtractedEventText | undefined => {
  const event = parseJsonLine(line);
  if (!event) return undefined;

  if (event.type === "message_update") {
    const update = (event as TextDeltaEvent).assistantMessageEvent;
    return update?.type === "text_delta" && typeof update.delta === "string"
      ? { text: update.delta, source: "delta" }
      : undefined;
  }

  if (event.type === "message") {
    const text = extractTextFromContent((event as MessageEvent).message?.content);
    return text ? { text, source: "message" } : undefined;
  }

  return undefined;
};

const buildLeaderArgs = (
  task: string,
  ctx: ExtensionContext,
  mode: LeaderSessionMode,
  sessionFile?: string,
): string[] => {
  const sessionArgs =
    mode === "persistent" && sessionFile ? ["--session", sessionFile] : ["--no-session"];

  const args = [
    "--mode",
    "json",
    "-p",
    ...sessionArgs,
    "--no-extensions",
    "--tools",
    LEADER_TOOLS.join(",") satisfies string,
  ];

  const selectedModel = modelArg(ctx);
  return selectedModel
    ? [...args, "--model", selectedModel, `Task: ${task}`]
    : [...args, `Task: ${task}`];
};

const appendParsedLines = (
  buffer: string,
  chunks: string[],
  state: { hasDelta: boolean },
): string => {
  const lines = buffer.split("\n");
  const remainder = lines.pop() ?? "";

  for (const line of lines) {
    const extracted = extractTextFromEventLine(line);
    if (!extracted) continue;
    if (extracted.source === "delta") state.hasDelta = true;
    if (extracted.source === "message" && state.hasDelta) continue;
    chunks.push(extracted.text);
  }

  return remainder;
};

const formatLeaderResult = ({
  exitCode,
  signal,
  mode,
  sessionFile,
  output,
}: LeaderRunResult): string => {
  const status = signal
    ? `cancelled by signal ${signal}`
    : exitCode === 0
      ? "completed"
      : `exited with code ${exitCode}`;
  const sessionLine = sessionFile ? `\nSession: ${sessionFile}` : "";
  return `Leader ${status}.\nMode: ${mode}${sessionLine}\n\n${output}`;
};

const parseLeaderCommandInput = (args: string | undefined): LeaderCommandInput | string => {
  const tokens = args?.trim().split(/\s+/).filter(Boolean) ?? [];
  const hasPersistent = tokens.includes("--persistent");
  const hasEphemeral = tokens.includes("--ephemeral");

  if (hasPersistent && hasEphemeral) {
    return "Use only one mode flag: --ephemeral or --persistent";
  }

  const mode: LeaderSessionMode = hasPersistent ? "persistent" : DEFAULT_SESSION_MODE;
  const task = tokens
    .filter((token) => token !== "--persistent" && token !== "--ephemeral")
    .join(" ")
    .trim();

  if (!task) return "Usage: /leader [--ephemeral|--persistent] <task>";

  return { task, mode: hasEphemeral ? "ephemeral" : mode };
};

const runLeader = async (
  task: string,
  ctx: ExtensionContext,
  signal?: AbortSignal,
  mode: LeaderSessionMode = DEFAULT_SESSION_MODE,
): Promise<LeaderRunResult> => {
  const sessionFile = mode === "persistent" ? makeSessionFile() : undefined;
  const args = buildLeaderArgs(task, ctx, mode, sessionFile);

  return await new Promise<LeaderRunResult>((resolve, reject) => {
    const proc = spawn("pi", args, {
      cwd: ctx.cwd,
      env: { ...process.env, [CHILD_ENV]: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: string[] = [];
    const streamState = { hasDelta: false };
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;

    const cleanup = (): void => signal?.removeEventListener("abort", abort);
    const settle = <T>(callback: () => T): T | undefined => {
      cleanup();
      if (settled) return undefined;
      settled = true;
      return callback();
    };
    const abort = (): void => {
      if (proc.exitCode === null) proc.kill("SIGTERM");
    };

    signal?.addEventListener("abort", abort, { once: true });

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      stdoutBuffer = appendParsedLines(stdoutBuffer + chunk, chunks, streamState);
    });

    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => {
      stderrBuffer += chunk;
    });

    proc.on("error", (error) => {
      settle(() => reject(error));
    });

    proc.on("close", (code, closeSignal) => {
      settle(() => {
        const finalExtracted = extractTextFromEventLine(stdoutBuffer);
        if (finalExtracted && !(finalExtracted.source === "message" && streamState.hasDelta)) {
          chunks.push(finalExtracted.text);
        }

        const output = chunks.join("").trim();
        const stderr = stderrBuffer.trim();
        const combined = [output, stderr ? `\n\n[stderr]\n${stderr}` : ""].join("").trim();

        resolve({
          output: truncateResult(combined || "(leader produced no text output)"),
          mode,
          ...(sessionFile ? { sessionFile } : {}),
          exitCode: code,
          signal: closeSignal,
        });
      });
    });
  });
};

const leadersExtension = (pi: ExtensionAPI): void => {
  pi.registerTool({
    name: "leader",
    label: "Leader",
    description:
      "Delegate one foreground task to a focused leader subagent. Use ephemeral mode by default for one-shot tasks where only the final answer matters, such as codebase exploration, API research, documentation reading, validation reviews, quick inspection, summarization, direct Q&A, or isolated second opinions. Use persistent mode only when the leader session should be saved for follow-up, continuity, important multi-step work, iterative review, future continuation, or audit/debugging. If unsure, choose ephemeral.",
    parameters: Type.Object({
      task: Type.String({ description: "The complete task for the leader subagent to perform." }),
      mode: Type.Optional(
        Type.Union([
          Type.Literal("ephemeral", {
            description:
              "Default. Do not save the child session. Best for one-shot delegation where only the answer matters: codebase exploration, API research, documentation reading, validation reviews, quick inspection, summarization, direct Q&A, or isolated second opinions.",
          }),
          Type.Literal("persistent", {
            description:
              "Save the child session. Use when the leader conversation should persist for follow-up, continuity, important multi-step work, iterative review, future continuation, or audit/debugging.",
          }),
        ]),
      ),
    }),
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      const result = await runLeader(params.task, ctx, signal, params.mode ?? DEFAULT_SESSION_MODE);

      return {
        content: [{ type: "text", text: formatLeaderResult(result) }],
        details: result,
      };
    },
  });

  pi.registerCommand("leader", {
    description:
      "Run one foreground leader subagent. Defaults to ephemeral/no-session for one-shot tasks. Use --persistent when the child session should be saved for follow-up, continuity, or important multi-step work.",
    handler: async (args, ctx) => {
      const input = parseLeaderCommandInput(args);
      if (typeof input === "string") {
        ctx.ui.notify(input, "error");
        return;
      }

      ctx.ui.notify(`Leader started (${input.mode})...`, "info");
      try {
        const result = await runLeader(input.task, ctx, ctx.signal, input.mode);
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

  pi.on("session_start", async (_event, ctx) => {
    if (process.env[CHILD_ENV] === "1") return;
    ctx.ui.notify("Leaders extension loaded", "info");
  });
};

export default leadersExtension;
