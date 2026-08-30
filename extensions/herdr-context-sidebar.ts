import { createConnection } from "node:net";

function reportContext(ctx: any) {
  const usage = ctx.getContextUsage?.();
  const socketPath = process.env.HERDR_SOCKET_PATH;
  const paneId = process.env.HERDR_PANE_ID;
  if (typeof usage?.percent !== "number" || process.env.HERDR_ENV !== "1" || !socketPath || !paneId)
    return;

  const socket = createConnection(socketPath);
  socket.on("connect", () =>
    socket.write(
      `${JSON.stringify({
        id: `user:pi-context:${Date.now()}`,
        method: "pane.report_metadata",
        params: {
          pane_id: paneId,
          source: "user:pi-context",
          tokens: { context: `ctx ${usage.percent.toFixed(0)}%` },
        },
      })}\n`,
    ),
  );
  socket.on("data", () => socket.end());
  socket.on("error", () => {});
}

export default function (pi: any) {
  pi.on("session_start", (_event: any, ctx: any) => reportContext(ctx));
  pi.on("message_end", (event: any, ctx: any) => {
    if (event.message.role === "assistant") reportContext(ctx);
  });
}
