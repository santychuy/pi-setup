import {
  getFiletypeFromFileName,
  parseDiffFromFile,
  setLanguageOverride,
  type FileContents,
  type FileDiffMetadata,
} from "@pierre/diffs";
import {
  cleanDiffLine,
  emptyHighlightedDiffSet,
  flattenHighlightedLine,
  loadHighlightedDiff,
} from "./pierre-highlight.js";
import type { PierreTerminalPalette } from "./pierre-theme.js";
import type { DiffRow, FileSnapshot, HighlightedDiffCode, PierreDiffPayload } from "./types.js";

export function buildDiffMetadata(snapshot: FileSnapshot): FileDiffMetadata {
  const oldFile: FileContents = { name: snapshot.path, contents: snapshot.oldContent };
  const newFile: FileContents = { name: snapshot.path, contents: snapshot.newContent };
  return normalizeDiffMetadataLanguage(
    parseDiffFromFile(oldFile, newFile, undefined, true),
    snapshot.path,
  );
}

export async function buildPierrePayload(snapshot: FileSnapshot): Promise<PierreDiffPayload> {
  const metadata = buildDiffMetadata(snapshot);
  const highlighted = await loadHighlightedDiff(metadata);
  return { snapshot, metadata, highlighted };
}

export function buildPierrePayloadSync(snapshot: FileSnapshot): PierreDiffPayload {
  const metadata = buildDiffMetadata(snapshot);
  return { snapshot, metadata, highlighted: emptyHighlightedDiffSet() };
}

export function normalizeDiffMetadataLanguage(
  metadata: FileDiffMetadata,
  filePath: string,
): FileDiffMetadata {
  const language = metadata.lang ?? getFiletypeFromFileName(filePath);
  return language ? setLanguageOverride(metadata, language) : metadata;
}

export function buildDiffRows(
  metadata: FileDiffMetadata,
  highlighted: HighlightedDiffCode,
  palette: PierreTerminalPalette,
): DiffRow[] {
  const rows: DiffRow[] = [];

  for (const hunk of metadata.hunks) {
    if (hunk.collapsedBefore > 0) {
      rows.push({ kind: "collapsed", text: "...", fg: palette.metadataFg, bg: palette.metadataBg });
    }

    let deletionLineIndex = hunk.deletionLineIndex;
    let additionLineIndex = hunk.additionLineIndex;
    let deletionLineNumber = hunk.deletionStart;
    let additionLineNumber = hunk.additionStart;

    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let offset = 0; offset < content.lines; offset += 1) {
          rows.push({
            kind: "line",
            lineType: "context",
            lineNumber: additionLineNumber + offset,
            spans: flattenHighlightedLine(
              highlighted.additionLines[additionLineIndex + offset],
              palette.appearance,
              palette.contextRowBg,
              cleanDiffLine(metadata.additionLines[additionLineIndex + offset]),
            ),
            rowFg: palette.contextFg,
            rowBg: palette.contextRowBg,
            lineNumberFg: palette.lineNumberFg,
          });
        }

        deletionLineIndex += content.lines;
        additionLineIndex += content.lines;
        deletionLineNumber += content.lines;
        additionLineNumber += content.lines;
        continue;
      }

      for (let offset = 0; offset < content.deletions; offset += 1) {
        rows.push({
          kind: "line",
          lineType: "deletion",
          lineNumber: deletionLineNumber + offset,
          spans: flattenHighlightedLine(
            highlighted.deletionLines[deletionLineIndex + offset],
            palette.appearance,
            palette.deletionRowBg,
            cleanDiffLine(metadata.deletionLines[deletionLineIndex + offset]),
          ),
          rowFg: palette.deletionFg,
          rowBg: palette.deletionRowBg,
          lineNumberFg: palette.lineNumberFg,
        });
      }

      for (let offset = 0; offset < content.additions; offset += 1) {
        rows.push({
          kind: "line",
          lineType: "addition",
          lineNumber: additionLineNumber + offset,
          spans: flattenHighlightedLine(
            highlighted.additionLines[additionLineIndex + offset],
            palette.appearance,
            palette.additionRowBg,
            cleanDiffLine(metadata.additionLines[additionLineIndex + offset]),
          ),
          rowFg: palette.additionFg,
          rowBg: palette.additionRowBg,
          lineNumberFg: palette.lineNumberFg,
        });
      }

      deletionLineIndex += content.deletions;
      additionLineIndex += content.additions;
      deletionLineNumber += content.deletions;
      additionLineNumber += content.additions;
    }

    if (hunk.noEOFCRDeletions || hunk.noEOFCRAdditions) {
      rows.push({
        kind: "metadata",
        text: "\\ No newline at end of file",
        fg: palette.metadataFg,
        bg: palette.metadataBg,
      });
    }
  }

  if (trailingCollapsedLines(metadata) > 0) {
    rows.push({ kind: "collapsed", text: "...", fg: palette.metadataFg, bg: palette.metadataBg });
  }

  return rows;
}

export function summarizeMetadata(metadata: FileDiffMetadata): {
  additions: number;
  deletions: number;
} {
  return metadata.hunks.reduce(
    (total, hunk) => ({
      additions: total.additions + hunk.additionLines,
      deletions: total.deletions + hunk.deletionLines,
    }),
    { additions: 0, deletions: 0 },
  );
}

function trailingCollapsedLines(metadata: FileDiffMetadata): number {
  const lastHunk = metadata.hunks.at(-1);
  if (!lastHunk || metadata.isPartial) return 0;

  const additionRemaining =
    metadata.additionLines.length - (lastHunk.additionLineIndex + lastHunk.additionCount);
  const deletionRemaining =
    metadata.deletionLines.length - (lastHunk.deletionLineIndex + lastHunk.deletionCount);

  if (additionRemaining !== deletionRemaining) return 0;
  return Math.max(additionRemaining, 0);
}
