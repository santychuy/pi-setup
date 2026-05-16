import * as os from "node:os";
import * as path from "node:path";

import type { AgentToolResult, ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  keyHint,
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

function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}

function isSkillPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  return (
    /(?:^|\/)SKILL\.md$/i.test(normalized) && /(?:^|\/)(?:\.pi|\.agents|skills)\//.test(normalized)
  );
}

function skillNameFromPath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p.toLowerCase() === "skills");
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  return path.basename(path.dirname(normalized));
}

// ── Path shortening ─────────────────────────────────────────────────────────
//
// 1. Inside project  → bare relative path:  extensions/leaders/package.json
// 2. Inside home      → tilde substitution:  ~/.pi/config.json
// 3. Long outside     → middle truncation:    /Library/…/macOS.sdk/stdio.h
// 4. Short outside   → keep absolute:         /etc/hosts

const shortenPath = (filePath: string, cwd: string): string => {
  if (!filePath || filePath === "...") return filePath;

  const rel = path.relative(cwd, filePath);
  if (!rel.startsWith("..") && rel !== "") return rel;

  const home = os.homedir();
  if (filePath.startsWith(home + path.sep) || filePath === home) {
    return "~" + filePath.slice(home.length);
  }

  if (filePath.length > 60) {
    const parts = filePath.split(path.sep);
    const filename = parts[parts.length - 1];
    const parent = parts[parts.length - 2];
    return path.sep + parts[1] + path.sep + "…" + path.sep + parent + path.sep + filename;
  }

  return filePath;
};

const formatPath = (filePath: string, cwd: string, theme: Theme): string => {
  const shortened = shortenPath(filePath, cwd);
  const lastSlash = shortened.lastIndexOf("/");

  if (lastSlash === -1) {
    return theme.fg("accent", shortened);
  }

  const dir = shortened.slice(0, lastSlash + 1);
  const file = shortened.slice(lastSlash + 1);

  if (shortened.startsWith("~/")) {
    return theme.fg("dim", "~/") + theme.fg("muted", dir.slice(2)) + theme.fg("accent", file);
  }

  return theme.fg("muted", dir) + theme.fg("accent", file);
};

export function registerTools(pi: ExtensionAPI, state: DiffViewerState): void {
  const cwd = process.cwd();
  const originalRead = createReadToolDefinition(cwd);
  const originalEdit = createEditToolDefinition(cwd);
  const originalWrite = createWriteToolDefinition(cwd);

  pi.registerTool({
    name: "read",
    label: originalRead.label,
    description: originalRead.description,
    parameters: originalRead.parameters,
    promptSnippet: originalRead.promptSnippet,
    promptGuidelines: originalRead.promptGuidelines,
    prepareArguments: originalRead.prepareArguments,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return originalRead.execute(toolCallId, params, signal, onUpdate, ctx);
    },
    renderCall(args, theme, context) {
      const range =
        args.offset || args.limit
          ? theme.fg(
              "warning",
              `:${args.offset ?? 1}${args.limit ? `-${(args.offset ?? 1) + args.limit - 1}` : ""}`,
            )
          : "";
      const targetPath = args.path || "...";
      const formatted = formatPath(targetPath, context.cwd, theme);

      if (isSkillPath(targetPath)) {
        const skill = skillNameFromPath(targetPath);
        return new Text(
          `${theme.fg("accent", "✦ ")}${theme.fg("toolTitle", "Loading skill: ")}${theme.bold(theme.fg("accent", skill))}${range}`,
          0,
          0,
        );
      }

      return new Text(`${theme.fg("muted", "read ")}${formatted}${range}`, 0, 0);
    },
    renderResult(result, options, theme, context) {
      if (options.isPartial) return new Text(theme.fg("warning", "Reading..."), 0, 0);
      const error = errorMessage(result);
      if (error) return new Text(theme.fg("error", error), 0, 0);

      const first = result.content[0];
      if (first?.type === "image") return new Text(theme.fg("success", "Image loaded"), 0, 0);
      if (first?.type !== "text") return new Text(theme.fg("success", "Read"), 0, 0);

      const count = lineCount(first.text);
      const targetPath = (context.args as { path?: string } | undefined)?.path ?? "";

      if (isSkillPath(targetPath)) {
        const skill = skillNameFromPath(targetPath);
        let text =
          `${theme.fg("accent", "✦ ")}${theme.fg("success", "Skill: ")}${theme.bold(theme.fg("accent", skill))}` +
          theme.fg("success", ` loaded (${count} line${count === 1 ? "" : "s"})`);
        if (!options.expanded) {
          text += ` ${theme.fg("dim", keyHint("app.tools.expand", "expand"))}`;
        }
        if (options.expanded) {
          const formatted = formatPath(targetPath, context.cwd, theme);
          text += `\n${theme.fg("dim", String(formatted))}\n${theme.fg("toolOutput", first.text)}`;
        }
        return new Text(text, 0, 0);
      }

      let text = theme.fg("success", `${count} line${count === 1 ? "" : "s"} read`);
      if (options.expanded) text += `\n${theme.fg("toolOutput", first.text)}`;
      return new Text(text, 0, 0);
    },
  });

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
    renderCall(args, theme, context) {
      return new Text(
        `${theme.fg("muted", "edit ")}${formatPath(args.path, context.cwd, theme)}`,
        0,
        0,
      );
    },
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
    renderCall(args, theme, context) {
      const count = lineCount(args.content);
      return new Text(
        `${theme.fg("muted", "write ")}${formatPath(args.path, context.cwd, theme)}${theme.fg("dim", ` (${count} line${count === 1 ? "" : "s"})`)}`,
        0,
        0,
      );
    },
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
