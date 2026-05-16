import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { buildPierrePayload } from "./pierre.js";
import { renderDiffBlock } from "./render.js";
import type { DiffViewerState } from "./state.js";
import { getChangedFiles } from "./git.js";
import { createGitSnapshot } from "./snapshots.js";
import { openSnapshotsInZed } from "./zed.js";
import type { ChangedFile, DiffScope, FileSnapshot } from "./types.js";

async function resolveFiles(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: DiffViewerState,
  scope: DiffScope,
): Promise<ChangedFile[]> {
  if (scope === "last-run")
    return [...state.lastRun.values()].sort((a, b) => a.path.localeCompare(b.path));
  return getChangedFiles(pi, ctx.cwd, scope === "staged");
}

async function snapshotFor(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: DiffViewerState,
  file: ChangedFile,
): Promise<FileSnapshot> {
  return state.snapshots.get(file.path) ?? createGitSnapshot(pi, ctx.cwd, file);
}

async function pickFile(
  ctx: ExtensionCommandContext,
  files: ChangedFile[],
): Promise<ChangedFile | undefined> {
  if (files.length === 0) return undefined;
  if (files.length === 1) return files[0];
  const labels = files.map((file) => `${file.path} (${file.status})`);
  const selected = await ctx.ui.select("Select diff", labels);
  if (!selected) return undefined;
  return files[labels.indexOf(selected)];
}

export function registerDiffCommand(pi: ExtensionAPI, state: DiffViewerState): void {
  pi.registerCommand("diff", {
    description: "Show Git/agent diffs and open visual diffs in Zed",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      const [rawAction = "", ...rest] = args.trim().split(/\s+/).filter(Boolean);
      const action = rawAction || "show";

      if (action === "clear") {
        const files = await getChangedFiles(pi, ctx.cwd);
        state.baseline = new Set(files.map((file) => file.path));
        state.lastRun.clear();
        state.snapshots.clear();
        ctx.ui.notify("Cleared diff viewer state.", "info");
        return;
      }

      const scope: DiffScope =
        action === "all" ? "all" : action === "staged" ? "staged" : "last-run";
      const isOpen = action === "open" || action === "open-all";
      const isFile = action === "file" || (isOpen && rest.length > 0);
      const files = isFile
        ? [{ path: rest.join(" "), status: "modified" as const }]
        : await resolveFiles(pi, ctx, state, scope);

      if (action === "list") {
        ctx.ui.notify(
          files.length
            ? files.map((file) => `- ${file.path} (${file.status})`).join("\n")
            : "No last-run changes tracked.",
          "info",
        );
        return;
      }

      if (files.length === 0) {
        ctx.ui.notify(
          scope === "last-run"
            ? "No changes tracked from the last agent run."
            : "No Git changes found.",
          "info",
        );
        return;
      }

      if (isOpen) {
        const selected =
          action === "open-all"
            ? files
            : [await pickFile(ctx, files)].filter((file): file is ChangedFile => Boolean(file));
        const snapshots = await Promise.all(
          selected.map((file) => snapshotFor(pi, ctx, state, file)),
        );
        await openSnapshotsInZed(pi, ctx, snapshots);
        return;
      }

      const selected = isFile ? files[0] : await pickFile(ctx, files);
      if (!selected) return;
      const snapshot = await snapshotFor(pi, ctx, state, selected);
      const payload = await buildPierrePayload(snapshot);
      await ctx.ui.custom((_, theme, __, done) => {
        const component = renderDiffBlock(payload, theme, true);
        return {
          invalidate: () => component.invalidate(),
          handleInput: () => done(undefined),
          render: (width: number) => [
            ...component.render(width),
            theme.fg("dim", "Press any key to close"),
          ],
        };
      });
    },
  });
}
