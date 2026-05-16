import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createEditToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getChangedFiles } from "./git.js";
import { buildPierrePayload } from "./pierre.js";
import { renderDiffBlock } from "./render.js";
import { createGitSnapshot, createToolSnapshot } from "./snapshots.js";
import type { DiffViewerState } from "./state.js";
import { recordSnapshot } from "./state.js";
import type { DiffMode, DiffScope, DiffViewerDetails } from "./types.js";
import { openSnapshotsInZed } from "./zed.js";

function errorMessage<T>(result: AgentToolResult<T>): string | undefined {
  const first = result.content[0];
  return first?.type === "text" && first.text.startsWith("Error")
    ? first.text.split("\n")[0]
    : undefined;
}

export function registerTools(pi: ExtensionAPI, state: DiffViewerState): void {
  const cwd = process.cwd();
  const originalEdit = createEditToolDefinition(cwd);
  const originalWrite = createWriteToolDefinition(cwd);

  pi.registerTool({
    name: "edit",
    label: originalEdit.label,
    description: originalEdit.description,
    parameters: originalEdit.parameters,
    promptSnippet: originalEdit.promptSnippet,
    promptGuidelines: originalEdit.promptGuidelines,
    prepareArguments: originalEdit.prepareArguments,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const finish = await createToolSnapshot(ctx.cwd, params.path);
      const result = await originalEdit.execute(toolCallId, params, signal, onUpdate, ctx);
      if (errorMessage(result)) return result;
      const snapshot = await finish();
      recordSnapshot(state, snapshot);
      try {
        const payload = await buildPierrePayload(snapshot);
        return {
          ...result,
          details: {
            ...(result.details ?? {}),
            gitDiffViewer: payload,
          } as DiffViewerDetails,
        };
      } catch {
        return result;
      }
    },
    renderCall: originalEdit.renderCall,
    renderResult(result, options, theme, context) {
      if (options.isPartial) return new Text(theme.fg("warning", "Editing..."), 0, 0);
      const error = errorMessage(result);
      if (error) return new Text(theme.fg("error", error), 0, 0);
      const payload = (result.details as DiffViewerDetails | undefined)?.gitDiffViewer;
      if (payload) {
        return renderDiffBlock(
          payload,
          theme,
          options.expanded,
          context.lastComponent,
          context.invalidate,
        );
      }
      return new Text(theme.fg("success", "Applied"), 0, 0);
    },
  });

  pi.registerTool({
    name: "write",
    label: originalWrite.label,
    description: originalWrite.description,
    parameters: originalWrite.parameters,
    promptSnippet: originalWrite.promptSnippet,
    promptGuidelines: originalWrite.promptGuidelines,
    prepareArguments: originalWrite.prepareArguments,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const finish = await createToolSnapshot(ctx.cwd, params.path);
      const result = await originalWrite.execute(toolCallId, params, signal, onUpdate, ctx);
      if (errorMessage(result)) return result;
      const snapshot = await finish();
      recordSnapshot(state, snapshot);
      try {
        const payload = await buildPierrePayload(snapshot);
        return {
          ...result,
          details: {
            ...(result.details ?? {}),
            gitDiffViewer: payload,
          } as DiffViewerDetails,
        };
      } catch {
        return result;
      }
    },
    renderCall: originalWrite.renderCall,
    renderResult(result, options, theme, context) {
      if (options.isPartial) return new Text(theme.fg("warning", "Writing..."), 0, 0);
      const error = errorMessage(result);
      if (error) return new Text(theme.fg("error", error), 0, 0);
      const payload = (result.details as DiffViewerDetails | undefined)?.gitDiffViewer;
      if (payload) {
        return renderDiffBlock(
          payload,
          theme,
          options.expanded,
          context.lastComponent,
          context.invalidate,
        );
      }
      return new Text(theme.fg("success", "Written"), 0, 0);
    },
  });

  pi.registerTool({
    name: "show_git_diff",
    label: "show git diff",
    description: "Show or open Git diffs. Use mode=zed to open Zed visual diff with zed --diff.",
    parameters: Type.Object({
      scope: Type.Optional(
        Type.Union([Type.Literal("last-run"), Type.Literal("all"), Type.Literal("staged")], {
          default: "last-run",
        }),
      ),
      path: Type.Optional(Type.String()),
      mode: Type.Optional(
        Type.Union([Type.Literal("inline"), Type.Literal("zed"), Type.Literal("summary")], {
          default: "inline",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const scope = (params.scope ?? "last-run") as DiffScope;
      const mode = (params.mode ?? "inline") as DiffMode;
      const files = params.path
        ? [{ path: params.path, status: "modified" as const }]
        : scope === "last-run"
          ? [...state.lastRun.values()]
          : await getChangedFiles(pi, ctx.cwd, scope === "staged");
      const snapshots = await Promise.all(
        files.map((file) => state.snapshots.get(file.path) ?? createGitSnapshot(pi, ctx.cwd, file)),
      );
      if (mode === "zed") await openSnapshotsInZed(pi, ctx, snapshots);
      const text =
        snapshots.length === 0
          ? "No diffs found."
          : snapshots
              .map(
                (snapshot) =>
                  `${snapshot.path}\n${snapshot.oldContent}\n---\n${snapshot.newContent}`,
              )
              .join("\n\n");
      return {
        content: [
          {
            type: "text",
            text:
              mode === "summary"
                ? files.map((file) => `${file.path} (${file.status})`).join("\n") ||
                  "No diffs found."
                : text,
          },
        ],
        details: { count: snapshots.length },
      };
    },
  });
}
