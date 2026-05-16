import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { toAbsolute } from "./path.js";
import { writeTempSnapshot } from "./snapshots.js";
import type { FileSnapshot } from "./types.js";

export async function openSnapshotsInZed(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  snapshots: FileSnapshot[],
): Promise<void> {
  if (snapshots.length === 0) {
    ctx.ui.notify("No diffs to open in Zed.", "info");
    return;
  }

  const args: string[] = [];
  for (const snapshot of snapshots) {
    const oldFile = await writeTempSnapshot(
      `${path.basename(snapshot.path)}.old`,
      snapshot.oldContent,
    );
    const newFile = snapshot.existedAfter
      ? toAbsolute(ctx.cwd, snapshot.path)
      : await writeTempSnapshot(`${path.basename(snapshot.path)}.new`, snapshot.newContent);
    args.push("--diff", oldFile, newFile);
  }

  const result = await pi
    .exec("zed", args, { cwd: ctx.cwd, timeout: 10000 })
    .catch((error: unknown) => ({
      code: 1,
      stderr: error instanceof Error ? error.message : String(error),
    }));

  if (result.code === 0) ctx.ui.notify(`Opened ${snapshots.length} diff(s) in Zed.`, "info");
  else
    ctx.ui.notify(
      result.stderr?.trim() || "Could not open Zed. Install the zed CLI from Zed: cli: install.",
      "warning",
    );
}
