// Custom companion to Herdr's managed Pi integration. Do not edit herdr-agent-state.ts.
// Syncs display-only sidebar tokens; lifecycle state stays owned by herdr:pi.
// @ts-nocheck

import { createConnection } from "node:net";

const socketPath = process.env.HERDR_SOCKET_PATH;
const paneId = process.env.HERDR_PANE_ID;
const enabled = process.env.HERDR_ENV === "1" && !!socketPath && !!paneId;
let sequence = Date.now() * 1000;
let pending = false;
let rerun = false;

function formatCost(cost: number) {
  if (!Number.isFinite(cost)) return undefined;
  return `$${cost < 10 ? cost.toFixed(2) : cost.toFixed(0)}`;
}

function send(request: unknown) {
  return new Promise<void>((resolve) => {
    const socket = createConnection(socketPath!);
    const finish = () => {
      socket.destroy();
      resolve();
    };
    socket.once("error", finish);
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.once("data", finish);
    socket.once("end", finish);
    setTimeout(finish, 500).unref?.();
  });
}

export default function (pi) {
  if (!enabled) return;

  async function sync(ctx: any) {
    const cost = ctx.sessionManager
      .getBranch()
      .reduce(
        (total: number, entry: any) =>
          entry.type === "message" && entry.message?.role === "assistant"
            ? total + (entry.message.usage?.cost?.total ?? 0)
            : total,
        0,
      );

    await send({
      id: `user:pi-sidebar:${Date.now()}`,
      method: "pane.report_metadata",
      params: {
        pane_id: paneId,
        source: "user:pi-sidebar",
        seq: ++sequence,
        tokens: {
          model: ctx.model?.id ?? null,
          cost: formatCost(cost) ?? null,
        },
      },
    });
  }

  function requestSync(ctx: any) {
    if (pending) {
      rerun = true;
      return;
    }
    pending = true;
    void sync(ctx).finally(() => {
      pending = false;
      if (rerun) {
        rerun = false;
        requestSync(ctx);
      }
    });
  }

  pi.on("session_start", (_event, ctx) => requestSync(ctx));
  pi.on("model_select", (_event, ctx) => requestSync(ctx));
  // turn_end follows persistence of its assistant message, so its cost is in getBranch().
  pi.on("turn_end", (_event, ctx) => requestSync(ctx));
  pi.on("session_tree", (_event, ctx) => requestSync(ctx));
}
