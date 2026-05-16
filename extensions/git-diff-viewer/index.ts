import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDiffCommand } from "./src/commands.js";
import { getChangedFiles } from "./src/git.js";
import { cleanupTempSnapshots } from "./src/snapshots.js";
import { createState, setBaseline, updateLastRunFromGit } from "./src/state.js";
import { registerTools } from "./src/tools.js";

export default function (pi: ExtensionAPI): void {
  const state = createState();

  registerTools(pi, state);
  registerDiffCommand(pi, state);

  pi.on("agent_start", async (_event, ctx) => {
    setBaseline(state, await getChangedFiles(pi, ctx.cwd));
  });

  pi.on("agent_end", async (_event, ctx) => {
    const files = await getChangedFiles(pi, ctx.cwd);
    updateLastRunFromGit(state, files);
    if (state.lastRun.size > 0) {
      ctx.ui.notify(
        `${state.lastRun.size} changed file(s). Run /diff or /diff open for Zed visual diff.`,
        "info",
      );
    }
  });

  pi.on("session_shutdown", async () => {
    await cleanupTempSnapshots();
  });
}
