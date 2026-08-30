import { createHash, randomUUID } from "node:crypto";
import { open, readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

type TaskState = "running" | "stopping" | "exited" | "failed";
type Task = {
  id: string;
  label: string;
  executable: string;
  args: string[];
  cwd: string;
  pid?: number;
  pgid?: number;
  state: TaskState;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  logPath: string;
};

const tail = async (path: string, lines = 80) => {
  try {
    return (await readFile(path, "utf8")).split("\n").slice(-lines).join("\n").trim();
  } catch {
    return "(no log output yet)";
  }
};

const alive = (pid?: number, pgid?: number) => {
  const target = process.platform === "win32" ? pid : -(pgid ?? pid ?? 0);
  if (!target) return false;
  try {
    process.kill(target, 0);
    return true;
  } catch {
    return false;
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const RECENT_TASK_LIMIT = 5;

export default function (pi: ExtensionAPI) {
  let tasks: Task[] = [];
  let registryPath = "";
  let timer: NodeJS.Timeout | undefined;
  let refresh: (() => void) | undefined;

  const save = async () => {
    await mkdir(dirname(registryPath), { recursive: true });
    const temporary = `${registryPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(tasks, null, 2));
    await rename(temporary, registryPath);
  };

  const reconcile = async () => {
    let changed = false;
    for (const task of tasks) {
      if ((task.state === "running" || task.state === "stopping") && !alive(task.pid, task.pgid)) {
        task.state = task.state === "stopping" ? "exited" : "failed";
        task.endedAt ??= new Date().toISOString();
        changed = true;
      }
    }
    if (changed) await save();
    refresh?.();
  };

  const updateStatus = (ctx: {
    ui: {
      setStatus(key: string, value?: string): void;
      theme: { fg(color: "success", text: string): string };
    };
  }) => {
    const running = tasks.filter(
      (task) => task.state === "running" || task.state === "stopping",
    ).length;
    ctx.ui.setStatus(
      "managed-tasks",
      running ? ctx.ui.theme.fg("success", `tasks: ${running} running`) : undefined,
    );
  };

  const start = async (
    params: { label?: string; executable: string; args?: string[]; cwd?: string },
    ctx: { cwd: string },
  ) => {
    const cwd = resolve(ctx.cwd, params.cwd ?? ".");
    if (relative(ctx.cwd, cwd).startsWith(".."))
      throw new Error("cwd must be inside the current workspace");

    const id = randomUUID().slice(0, 8);
    const logPath = join(dirname(registryPath), "logs", `${id}.log`);
    await mkdir(dirname(logPath), { recursive: true });
    const log = await open(logPath, "a");
    await log.writeFile(
      `\n--- started ${new Date().toISOString()} ---\n$ ${params.executable} ${(params.args ?? []).join(" ")}\n`,
    );

    const child = spawn(params.executable, params.args ?? [], {
      cwd,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", log.fd, log.fd],
      env: process.env,
    });
    child.unref();
    await log.close();

    const task: Task = {
      id,
      label: params.label || `${params.executable} ${(params.args ?? []).join(" ")}`.trim(),
      executable: params.executable,
      args: params.args ?? [],
      cwd,
      pid: child.pid,
      pgid: process.platform === "win32" ? undefined : child.pid,
      state: "running",
      startedAt: new Date().toISOString(),
      logPath,
    };
    tasks.push(task);
    await save();

    child.once("error", async () => {
      task.state = "failed";
      task.endedAt = new Date().toISOString();
      await save();
      refresh?.();
    });
    child.once("close", async (code, signal) => {
      // The launcher can exit while detached children (Bun/Expo watchers) keep running.
      if (alive(task.pid, task.pgid)) return;
      task.state = task.state === "stopping" || code === 0 ? "exited" : "failed";
      task.exitCode = code;
      task.signal = signal;
      task.endedAt = new Date().toISOString();
      await save();
      refresh?.();
    });
    refresh?.();
    return task;
  };

  const stop = async (task: Task) => {
    if (!alive(task.pid, task.pgid)) {
      task.state = "exited";
      task.endedAt ??= new Date().toISOString();
      await save();
      return;
    }
    task.state = "stopping";
    await save();
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(task.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      process.kill(-(task.pgid ?? task.pid!), "SIGTERM");
      for (let waited = 0; waited < 2000 && alive(task.pid, task.pgid); waited += 100)
        await sleep(100);
      if (alive(task.pid, task.pgid)) process.kill(-(task.pgid ?? task.pid!), "SIGKILL");
    }
    refresh?.();
  };

  const recentTasks = () => {
    const sorted = [...tasks].sort((a, b) =>
      (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt),
    );
    return [
      ...sorted.filter((task) => task.state === "running" || task.state === "stopping"),
      ...sorted
        .filter((task) => task.state !== "running" && task.state !== "stopping")
        .slice(0, RECENT_TASK_LIMIT),
    ];
  };
  const list = () =>
    recentTasks()
      .map((task) => `${task.id}  ${task.state.padEnd(8)}  ${task.label}`)
      .join("\n") || "No managed tasks.";
  const find = (id?: string) => {
    const task = tasks.find((item) => item.id === id);
    if (!task) throw new Error(`Unknown task: ${id}`);
    return task;
  };

  pi.on("session_start", async (_event, ctx) => {
    const workspaceId = createHash("sha256").update(resolve(ctx.cwd)).digest("hex").slice(0, 12);
    registryPath = join(homedir(), ".pi", "agent", "managed-tasks", workspaceId, "tasks.json");
    tasks = existsSync(registryPath)
      ? (JSON.parse(await readFile(registryPath, "utf8")) as Task[])
      : [];
    refresh = () => updateStatus(ctx);
    await reconcile();
    updateStatus(ctx);
    timer = setInterval(() => void reconcile(), 2000);
    timer.unref();
  });

  pi.on("session_shutdown", () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    refresh = undefined;
  });

  pi.registerCommand("tasks", {
    description: "Manage tasks; /tasks start <command> [args], tail|stop|restart <id>",
    handler: async (args, ctx) => {
      await reconcile();
      const [action, id, ...rest] = args.trim().split(/\s+/).filter(Boolean);
      if (!action) {
        if (ctx.mode !== "tui") return void ctx.ui.notify(list(), "info");
        const snapshot = recentTasks();
        const taskId = await ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
          let selected = 0;
          return {
            render: (width) => [
              theme.fg("accent", theme.bold("Managed tasks")),
              ...snapshot.map((task, index) => {
                const marker = index === selected ? "> " : "  ";
                const state =
                  task.state === "running"
                    ? theme.fg("success", task.state)
                    : theme.fg("dim", task.state);
                return truncateToWidth(`${marker}${task.id}  ${state}  ${task.label}`, width);
              }),
              theme.fg("dim", "↑↓ select · x kill running task · esc close"),
            ],
            invalidate: () => {},
            handleInput: (data: string) => {
              if ((matchesKey(data, Key.up) || data === "k") && selected > 0) selected--;
              else if (
                (matchesKey(data, Key.down) || data === "j") &&
                selected < snapshot.length - 1
              )
                selected++;
              else if (data === "x" || data === "X") {
                const task = snapshot[selected];
                if (task && (task.state === "running" || task.state === "stopping")) done(task.id);
              } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")))
                done(undefined);
              tui.requestRender();
            },
          };
        });
        if (!taskId) return;
        const task = find(taskId);
        await stop(task);
        ctx.ui.notify(`Stopping ${task.id}`, "info");
        return;
      }
      if (action === "start") {
        if (!id) throw new Error("Usage: /tasks start <command> [args]");
        const task = await start({ executable: id, args: rest }, ctx);
        ctx.ui.notify(`Started ${task.id}`, "info");
        return;
      }
      const task = find(id);
      if (action === "tail" || action === "logs") {
        const output = await tail(task.logPath);
        if (ctx.mode !== "tui") return void ctx.ui.notify(output, "info");
        return void (await ctx.ui.editor(`${task.label} (${task.id})`, output));
      }
      if (action === "stop") {
        if (ctx.mode === "tui" && !(await ctx.ui.confirm("Stop task?", task.label))) return;
        await stop(task);
        ctx.ui.notify(`Stopping ${task.id}`, "info");
        return;
      }
      if (action === "restart") {
        await stop(task);
        const replacement = await start(task, ctx);
        ctx.ui.notify(`Restarted as ${replacement.id}`, "info");
        return;
      }
      throw new Error("Usage: /tasks [start <command> [args] | tail|stop|restart <id>]");
    },
  });

  pi.registerTool({
    name: "managed_task",
    label: "Managed Task",
    description:
      "Start, inspect, tail, stop, or restart a durable background task with persistent logs.",
    promptSnippet: "Manage durable local background processes and read their logs",
    promptGuidelines: [
      "Use managed_task when the user asks to run, inspect, tail, stop, or restart a long-lived local server or background command.",
    ],
    parameters: Type.Object({
      action: StringEnum(["start", "list", "tail", "stop", "restart"] as const),
      id: Type.Optional(Type.String()),
      label: Type.Optional(Type.String()),
      executable: Type.Optional(Type.String()),
      args: Type.Optional(Type.Array(Type.String())),
      cwd: Type.Optional(Type.String()),
      lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await reconcile();
      if (params.action === "list")
        return { content: [{ type: "text", text: list() }], details: { tasks } };
      if (params.action === "start") {
        if (!params.executable) throw new Error("executable is required to start a task");
        const task = await start(
          {
            executable: params.executable,
            label: params.label,
            args: params.args,
            cwd: params.cwd,
          },
          ctx,
        );
        return {
          content: [
            { type: "text", text: `Started ${task.id}: ${task.label}\nLogs: ${task.logPath}` },
          ],
          details: task,
        };
      }
      const task = find(params.id);
      if (params.action === "tail")
        return {
          content: [{ type: "text", text: await tail(task.logPath, params.lines) }],
          details: task,
        };
      if (params.action === "stop") {
        await stop(task);
        return { content: [{ type: "text", text: `Stopping ${task.id}` }], details: task };
      }
      await stop(task);
      const replacement = await start(task, ctx);
      return {
        content: [{ type: "text", text: `Restarted ${task.id} as ${replacement.id}` }],
        details: replacement,
      };
    },
  });
}
