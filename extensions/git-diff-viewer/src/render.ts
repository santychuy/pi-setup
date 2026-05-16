import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { keyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { loadHighlightedDiff } from "./pierre-highlight.js";
import { buildDiffRows, summarizeMetadata } from "./pierre.js";
import { getPierrePalette, type PierreTerminalPalette } from "./pierre-theme.js";
import type { DiffRow, DiffSpan, PierreDiffPayload } from "./types.js";

const ANSI_RESET = "\u001b[22m\u001b[39m\u001b[49m";

type RenderSegment = {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
};

export class PierreDiffBlock implements Component {
  private payload: PierreDiffPayload;
  private palette: PierreTerminalPalette;
  private maxVisibleLines: number;
  private invalidateView: (() => void) | undefined;
  private refreshPromise: Promise<void> | undefined;
  private refreshKey: string | undefined;

  constructor(
    payload: PierreDiffPayload,
    theme: Theme,
    expanded: boolean,
    invalidateView?: () => void,
  ) {
    this.payload = payload;
    this.palette = getPierrePalette(theme);
    this.maxVisibleLines = maxVisibleLines(expanded);
    this.invalidateView = invalidateView;
    this.maybeRefreshHighlightedDiff();
  }

  update(
    payload: PierreDiffPayload,
    theme: Theme,
    expanded: boolean,
    invalidateView?: () => void,
  ): void {
    const nextKey = refreshKeyFor(payload);
    const currentKey = refreshKeyFor(this.payload);
    const shouldKeepRefreshedPayload =
      currentKey === nextKey &&
      needsHighlightRefresh(payload) &&
      !needsHighlightRefresh(this.payload);

    this.payload = shouldKeepRefreshedPayload ? this.payload : payload;
    this.palette = getPierrePalette(theme);
    this.maxVisibleLines = maxVisibleLines(expanded);
    this.invalidateView = invalidateView;
    this.maybeRefreshHighlightedDiff();
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(20, width);
    const highlighted = this.payload.highlighted[this.palette.appearance];
    const bodyLines = buildDiffRows(this.payload.metadata, highlighted, this.palette).flatMap(
      (row) => this.renderRow(row, safeWidth),
    );
    const lines = [this.renderTitle(safeWidth), ...bodyLines];

    if (lines.length <= this.maxVisibleLines) return lines;

    const visible = Math.max(1, this.maxVisibleLines - 1);
    return [
      ...lines.slice(0, visible),
      renderFullWidthLine(
        [
          {
            text: `... ${lines.length - visible} more lines, ${keyHint("app.tools.expand", "to expand")}`,
            fg: this.palette.metadataFg,
            bg: this.palette.metadataBg,
          },
        ],
        safeWidth,
        { fg: this.palette.metadataFg, bg: this.palette.metadataBg },
      ),
    ];
  }

  private renderTitle(width: number): string {
    const { additions, deletions } = summarizeMetadata(this.payload.metadata);
    return renderFullWidthLine(
      [
        { text: "diff ", fg: this.palette.titleFg, bg: this.palette.titleBg, bold: true },
        {
          text: this.payload.snapshot.path,
          fg: this.palette.titleAccentFg,
          bg: this.palette.titleBg,
        },
        { text: ` +${additions}`, fg: this.palette.additionFg, bg: this.palette.titleBg },
        { text: ` -${deletions}`, fg: this.palette.deletionFg, bg: this.palette.titleBg },
      ],
      width,
      { fg: this.palette.titleFg, bg: this.palette.titleBg },
    );
  }

  private renderRow(row: DiffRow, width: number): string[] {
    if (row.kind !== "line") {
      const lineNumberWidth = lineNumberWidthFor(this.payload);
      const text =
        row.kind === "collapsed" ? ` ${" ".repeat(lineNumberWidth)} ${row.text}` : row.text;
      return [
        renderFullWidthLine([{ text, fg: row.fg, bg: row.bg }], width, { fg: row.fg, bg: row.bg }),
      ];
    }

    const lineNumberWidth = lineNumberWidthFor(this.payload);
    const prefixSegments: RenderSegment[] = [
      { text: lineMarker(row.lineType), fg: row.rowFg, bg: row.rowBg },
      {
        text: formatLineNumber(row.lineNumber, lineNumberWidth),
        fg: row.lineNumberFg,
        bg: row.rowBg,
      },
      { text: " ", fg: row.lineNumberFg, bg: row.rowBg },
    ];

    const prefix = `${lineMarker(row.lineType)}${formatLineNumber(row.lineNumber, lineNumberWidth)} `;
    const prefixWidth = visibleWidth(prefix);
    const contentWidth = Math.max(8, width - prefixWidth);
    const prefixAnsi = renderSegments(prefixSegments, { fg: row.rowFg, bg: row.rowBg });
    const continuationAnsi = renderSegments(
      [{ text: " ".repeat(prefixWidth), fg: row.rowFg, bg: row.rowBg }],
      {
        fg: row.rowFg,
        bg: row.rowBg,
      },
    );
    const contentAnsi = renderSegments(row.spans, { fg: row.rowFg, bg: row.rowBg });
    const content =
      contentAnsi.length > 0
        ? contentAnsi
        : renderSegments([{ text: " " }], { fg: row.rowFg, bg: row.rowBg });
    const wrapped = wrapTextWithAnsi(content, contentWidth);

    return wrapped.map((segment, index) =>
      padRenderedLine(`${index === 0 ? prefixAnsi : continuationAnsi}${segment}`, width, {
        fg: row.rowFg,
        bg: row.rowBg,
      }),
    );
  }

  private maybeRefreshHighlightedDiff(): void {
    if (!needsHighlightRefresh(this.payload)) {
      this.refreshPromise = undefined;
      this.refreshKey = undefined;
      return;
    }

    const nextKey = refreshKeyFor(this.payload);
    if (this.refreshPromise && this.refreshKey === nextKey) return;

    this.refreshKey = nextKey;
    this.refreshPromise = loadHighlightedDiff(this.payload.metadata)
      .then((highlighted) => {
        this.payload = { ...this.payload, highlighted };
        this.invalidateView?.();
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.refreshKey === nextKey) this.refreshPromise = undefined;
      });
  }
}

export function renderDiffBlock(
  payload: PierreDiffPayload,
  theme: Theme,
  expanded: boolean,
  lastComponent?: unknown,
  invalidateView?: () => void,
): Component {
  const component =
    lastComponent instanceof PierreDiffBlock
      ? lastComponent
      : new PierreDiffBlock(payload, theme, expanded, invalidateView);
  component.update(payload, theme, expanded, invalidateView);
  return component;
}

function maxVisibleLines(expanded: boolean): number {
  const rows = typeof process.stdout.rows === "number" ? process.stdout.rows : 40;
  const expandedLimit = Math.max(8, Math.floor(rows * 0.6));
  return expanded ? expandedLimit : Math.min(expandedLimit, 12);
}

function renderFullWidthLine(
  segments: RenderSegment[],
  width: number,
  base: { fg?: string; bg?: string; bold?: boolean },
): string {
  const rendered = renderSegments(segments, base);
  return padRenderedLine(truncateToWidth(rendered, width), width, base);
}

function padRenderedLine(
  line: string,
  width: number,
  base: { fg?: string; bg?: string; bold?: boolean },
): string {
  const padding = Math.max(0, width - visibleWidth(line));
  return `${line}${openAnsi(base)}${" ".repeat(padding)}${ANSI_RESET}`;
}

function renderSegments(
  segments: Array<RenderSegment | DiffSpan>,
  base: { fg?: string; bg?: string; bold?: boolean },
): string {
  let output = openAnsi(base);
  for (const segment of segments) {
    output += openAnsi({
      fg: segment.fg ?? base.fg,
      bg: segment.bg ?? base.bg,
      bold: "bold" in segment ? (segment.bold ?? base.bold) : base.bold,
    });
    output += segment.text;
  }
  output += openAnsi(base);
  return output;
}

function openAnsi(style: { fg?: string; bg?: string; bold?: boolean }): string {
  const codes: string[] = [style.bold ? "1" : "22"];

  const fg = toRgb(style.fg);
  codes.push(fg ? `38;2;${fg.r};${fg.g};${fg.b}` : "39");

  const bg = toRgb(style.bg);
  codes.push(bg ? `48;2;${bg.r};${bg.g};${bg.b}` : "49");

  return `\u001b[${codes.join(";")}m`;
}

function toRgb(hex: string | undefined): { r: number; g: number; b: number } | undefined {
  const normalized = hex?.trim();
  if (!normalized || !/^#[0-9a-fA-F]{6}$/.test(normalized)) return undefined;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function formatLineNumber(lineNumber: number | undefined, width: number): string {
  return lineNumber === undefined ? " ".repeat(width) : String(lineNumber).padStart(width, " ");
}

function lineMarker(lineType: "context" | "addition" | "deletion"): string {
  return lineType === "addition" ? "+" : lineType === "deletion" ? "-" : " ";
}

function lineNumberWidthFor(payload: PierreDiffPayload): number {
  return Math.max(
    3,
    String(
      Math.max(payload.metadata.deletionLines.length, payload.metadata.additionLines.length, 1),
    ).length,
  );
}

function needsHighlightRefresh(payload: PierreDiffPayload): boolean {
  const lineCount = payload.metadata.deletionLines.length + payload.metadata.additionLines.length;
  return lineCount > 0 && !hasHighlightedLines(payload);
}

function hasHighlightedLines(payload: PierreDiffPayload): boolean {
  return (
    payload.highlighted.dark.deletionLines.length > 0 ||
    payload.highlighted.dark.additionLines.length > 0 ||
    payload.highlighted.light.deletionLines.length > 0 ||
    payload.highlighted.light.additionLines.length > 0
  );
}

function refreshKeyFor(payload: PierreDiffPayload): string {
  return `${payload.snapshot.path}\u0000${payload.snapshot.oldContent}\u0000${payload.snapshot.newContent}\u0000${payload.metadata.lang ?? ""}`;
}
