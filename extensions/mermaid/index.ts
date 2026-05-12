import type {
  ExtensionAPI,
  ExtensionContext,
  MessageRenderer,
} from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme, keyHint } from "@earendil-works/pi-coding-agent";
import {
  Box,
  Spacer,
  Text,
  type Component,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { createHash } from "node:crypto";
import { renderMermaidASCII } from "beautiful-mermaid";

const MESSAGE_TYPE = "santychuy-mermaid";
const MERMAID_BLOCK_RE = /```mermaid\s*([\s\S]*?)```/gi;
const COLLAPSED_LINES = 10;
const SHOW_FULL_BY_DEFAULT = true;
const MAX_BLOCKS = 5;
const MAX_SOURCE_LINES = 400;
const MAX_SOURCE_CHARS = 20_000;
const MAX_CACHE_ENTRIES = 200;
const SUPPORTED_TYPES = new Map<string, string>([
  ["graph", "flowchart"],
  ["flowchart", "flowchart"],
  ["sequenceDiagram", "sequence"],
  ["classDiagram", "class"],
  ["erDiagram", "er"],
  ["stateDiagram", "state"],
  ["stateDiagram-v2", "state"],
]);
const SUPPORTED_TYPE_LABEL =
  "graph/flowchart, sequenceDiagram, classDiagram, erDiagram, stateDiagram(-v2)";
const ASCII_PRESETS: AsciiPreset[] = [
  { key: "default", paddingX: 5, boxBorderPadding: 1 },
  { key: "compact", paddingX: 3, boxBorderPadding: 1 },
  { key: "tight", paddingX: 2, boxBorderPadding: 1 },
  { key: "squeezed", paddingX: 1, boxBorderPadding: 0 },
];

type AsciiPreset = {
  key: string;
  paddingX: number;
  boxBorderPadding: number;
};

type MermaidIssue = {
  severity: "warning" | "error";
  message: string;
};

type AsciiVariant = {
  presetKey: string;
  ascii: string;
  lineCount: number;
  maxLineWidth: number;
};

type MermaidDetails = {
  source: string;
  index: number;
  ascii: string;
  lineCount: number;
  variants?: AsciiVariant[];
  issues?: MermaidIssue[];
};

type MessageContentPart = {
  type?: string;
  text?: string;
};

type MermaidParser = (text: string) => Promise<void>;

let mermaidParser: MermaidParser | null = null;
let mermaidParserError: string | null = null;
let parserWarningShown = false;

const asciiCache = new Map<string, AsciiVariant>();
const asciiLinesCache = new Map<string, { lines: string[]; previewLines: string[] }>();

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part: unknown) => {
      const item = part as MessageContentPart;
      return item.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .filter((part: string) => part.trim().length > 0)
    .join("\n");
}

function extractMermaidBlocks(text: string): string[] {
  const blocks: string[] = [];
  MERMAID_BLOCK_RE.lastIndex = 0;

  let match: RegExpExecArray | null = MERMAID_BLOCK_RE.exec(text);
  while (match) {
    const code = match[1]?.trim();
    if (code) blocks.push(code);
    if (blocks.length > MAX_BLOCKS) break;
    match = MERMAID_BLOCK_RE.exec(text);
  }

  return blocks;
}

function normalizeMermaidSource(source: string): string {
  return source.replace(/\s+$/g, "");
}

function getMermaidTypeToken(block: string): string | null {
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;
    return trimmed.split(/\s+/)[0] ?? null;
  }
  return null;
}

function getSupportedMermaidType(block: string): {
  token: string | null;
  normalized: string | null;
} {
  const token = getMermaidTypeToken(block);
  if (!token) return { token, normalized: null };
  return { token, normalized: SUPPORTED_TYPES.get(token) ?? null };
}

function hashMermaid(block: string): string {
  return createHash("sha256").update(block).digest("hex").slice(0, 8);
}

function getCachedVariant(key: string): AsciiVariant | null {
  const cached = asciiCache.get(key);
  if (!cached) return null;

  asciiCache.delete(key);
  asciiCache.set(key, cached);
  return cached;
}

function setCachedVariant(key: string, variant: AsciiVariant): void {
  asciiCache.set(key, variant);
  if (asciiCache.size <= MAX_CACHE_ENTRIES) return;

  const oldest = asciiCache.keys().next().value as string | undefined;
  if (oldest) asciiCache.delete(oldest);
}

function countAsciiLines(ascii: string): number {
  return ascii ? ascii.split(/\r?\n/).length : 0;
}

function maxAsciiLineWidth(ascii: string): number {
  return ascii
    ? ascii.split(/\r?\n/).reduce((max, line) => Math.max(max, visibleWidth(line)), 0)
    : 0;
}

function getCachedAsciiLines(ascii: string): { lines: string[]; previewLines: string[] } {
  const cached = asciiLinesCache.get(ascii);
  if (cached) {
    asciiLinesCache.delete(ascii);
    asciiLinesCache.set(ascii, cached);
    return cached;
  }

  const lines = ascii ? ascii.split(/\r?\n/) : [];
  const previewLines = lines.length > COLLAPSED_LINES ? lines.slice(0, COLLAPSED_LINES) : lines;
  const entry = { lines, previewLines };
  asciiLinesCache.set(ascii, entry);

  if (asciiLinesCache.size > MAX_CACHE_ENTRIES) {
    const oldest = asciiLinesCache.keys().next().value as string | undefined;
    if (oldest) asciiLinesCache.delete(oldest);
  }

  return entry;
}

function renderAsciiVariant(block: string, diagramHash: string, preset: AsciiPreset): AsciiVariant {
  const cacheKey = `${diagramHash}:${preset.key}`;
  const cached = getCachedVariant(cacheKey);
  if (cached) return cached;

  const ascii = renderMermaidASCII(block, {
    paddingX: preset.paddingX,
    boxBorderPadding: preset.boxBorderPadding,
    colorMode: "none",
  }).trimEnd();
  const variant = {
    presetKey: preset.key,
    ascii,
    lineCount: countAsciiLines(ascii),
    maxLineWidth: maxAsciiLineWidth(ascii),
  };

  getCachedAsciiLines(ascii);
  setCachedVariant(cacheKey, variant);
  return variant;
}

function selectAsciiVariant(
  width: number,
  variants: AsciiVariant[] | undefined,
  fallbackAscii: string,
  fallbackLineCount: number,
): { ascii: string; lineCount: number; maxLineWidth: number; clipped: boolean } {
  const safeWidth = Math.max(1, width);
  if (variants && variants.length > 0) {
    for (const variant of variants) {
      if (variant.maxLineWidth <= safeWidth) return { ...variant, clipped: false };
    }

    const tightest = variants[variants.length - 1] as AsciiVariant;
    return { ...tightest, clipped: tightest.maxLineWidth > safeWidth };
  }

  const maxLineWidth = maxAsciiLineWidth(fallbackAscii);
  return {
    ascii: fallbackAscii,
    lineCount: fallbackLineCount || countAsciiLines(fallbackAscii),
    maxLineWidth,
    clipped: maxLineWidth > safeWidth,
  };
}

function formatIssueLines(issues: MermaidIssue[], hash: string): string {
  return issues
    .map((issue) => `[mermaid:${issue.severity}][hash:${hash}] ${issue.message}`)
    .join("\n");
}

function buildContextContent(
  block: string,
  hash: string,
  issues: MermaidIssue[],
  includeSource: boolean,
): string {
  const issueLines = formatIssueLines(issues, hash);
  if (!includeSource) return issueLines;

  const sourceBlock = `%% mermaid-hash: ${hash}\n${normalizeMermaidSource(block)}`;
  const contextBlock = `\`\`\`mermaid\n${sourceBlock}\n\`\`\``;
  return issueLines ? `${issueLines}\n\n${contextBlock}` : contextBlock;
}

function isDomPurifyError(message: string): boolean {
  return message.includes("DOMPurify");
}

async function getMermaidParser(): Promise<MermaidParser | null> {
  if (mermaidParser || mermaidParserError) return mermaidParser;

  try {
    const mod = await import("mermaid");
    const api = mod.default;
    api.initialize({ startOnLoad: false });

    mermaidParser = async (text: string): Promise<void> => {
      const result = api.parse(text);
      if (result && typeof result.then === "function") await result;
    };
    return mermaidParser;
  } catch (error) {
    mermaidParserError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

async function processBlock(
  block: string,
  blockIndex: number,
  parser: MermaidParser | null,
): Promise<{ hash: string; details: MermaidDetails; issues: MermaidIssue[] }> {
  const hash = hashMermaid(block);
  const issues: MermaidIssue[] = [];
  const label = blockIndex > 1 ? ` (block ${blockIndex})` : "";
  let parserFailed = false;

  if (parser) {
    try {
      await parser(block);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isDomPurifyError(message)) {
        mermaidParser = null;
        mermaidParserError = message;
      } else {
        parserFailed = true;
        issues.push({ severity: "error", message: `Mermaid parse error${label}: ${message}` });
      }
    }
  }

  if (parserFailed) {
    return {
      hash,
      issues,
      details: {
        source: block,
        index: blockIndex,
        ascii: "[parse failed]",
        lineCount: 1,
        issues,
      },
    };
  }

  try {
    const variants = ASCII_PRESETS.map((preset) => renderAsciiVariant(block, hash, preset));
    const first = variants[0] as AsciiVariant;
    return {
      hash,
      issues,
      details: {
        source: block,
        index: blockIndex,
        ascii: first.ascii,
        lineCount: first.lineCount,
        variants,
        issues: issues.length > 0 ? issues : undefined,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push({ severity: "error", message: `Mermaid render failed${label}: ${message}` });
    return {
      hash,
      issues,
      details: {
        source: block,
        index: blockIndex,
        ascii: "[render failed]",
        lineCount: 1,
        issues,
      },
    };
  }
}

function createMessageRenderer(): MessageRenderer<MermaidDetails> {
  return (message, { expanded }, theme) => {
    const details = message.details as MermaidDetails | undefined;
    const fallbackAscii = details?.ascii ?? extractText(message.content);
    const fallbackLineCount = details?.lineCount ?? countAsciiLines(fallbackAscii);

    const asciiComponent: Component = {
      render: (width: number): string[] => {
        const contentWidth = Math.max(1, width);
        const label = theme.fg("customMessageLabel", theme.bold("Mermaid"));
        const selection = selectAsciiVariant(
          contentWidth,
          details?.variants,
          fallbackAscii,
          fallbackLineCount,
        );
        const asciiLines = getCachedAsciiLines(selection.ascii);
        const hasOverflow = selection.lineCount > COLLAPSED_LINES;
        const isExpanded = SHOW_FULL_BY_DEFAULT || expanded || !hasOverflow;
        const visibleLines = isExpanded ? asciiLines.lines : asciiLines.previewLines;
        const needsClip = selection.maxLineWidth > contentWidth;
        const lines = [truncateToWidth(label, contentWidth)];

        for (const line of visibleLines) {
          lines.push(needsClip ? truncateToWidth(line, contentWidth, "") : line);
        }

        if (hasOverflow && !isExpanded) {
          const remainingLines = selection.lineCount - COLLAPSED_LINES;
          const hint = `... (${remainingLines} more lines, ${keyHint("app.tools.expand", "to expand")})`;
          lines.push(truncateToWidth(theme.fg("muted", hint), contentWidth));
        }

        if (selection.clipped) {
          lines.push(
            truncateToWidth(
              theme.fg("muted", "... clipped; widen terminal to view full diagram"),
              contentWidth,
            ),
          );
        }

        return lines;
      },
      invalidate: (): void => {},
    };

    const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
    box.addChild(asciiComponent);

    if (expanded && details?.source) {
      box.addChild(new Spacer(1));
      const markdownTheme = getMarkdownTheme();
      const indent = markdownTheme.codeBlockIndent ?? "  ";
      const normalizedSource = normalizeMermaidSource(details.source);
      const highlighted = markdownTheme.highlightCode?.(normalizedSource, "mermaid");
      const codeLines =
        highlighted ?? normalizedSource.split("\n").map((line) => markdownTheme.codeBlock(line));
      const renderedSource = [
        markdownTheme.codeBlockBorder("```mermaid"),
        ...codeLines.map((line) => `${indent}${line}`),
        markdownTheme.codeBlockBorder("```"),
      ].join("\n");

      box.addChild(new Text(renderedSource, 0, 0));
    }

    return box;
  };
}

async function renderBlocks(
  blocks: string[],
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): Promise<void> {
  const notify = (message: string, type: "info" | "warning" | "error"): void => {
    if (ctx.hasUI) ctx.ui.notify(message, type);
  };
  const warnParserUnavailable = (message?: string): void => {
    const suffix = message ?? mermaidParserError;
    if (parserWarningShown || (suffix && isDomPurifyError(suffix))) return;

    notify(
      `Mermaid parser validation unavailable${suffix ? ` (${suffix})` : ""}. Rendering anyway.`,
      "warning",
    );
    parserWarningShown = true;
  };

  const parser = await getMermaidParser();
  if (!parser) warnParserUnavailable();

  if (blocks.length > MAX_BLOCKS) {
    notify(`Found ${blocks.length} Mermaid blocks; rendering first ${MAX_BLOCKS}.`, "warning");
  }

  for (const [index, block] of blocks.slice(0, MAX_BLOCKS).entries()) {
    const blockIndex = index + 1;
    const sourceLines = block.split(/\r?\n/);
    if (sourceLines.length > MAX_SOURCE_LINES || block.length > MAX_SOURCE_CHARS) {
      notify(
        `Mermaid block ${blockIndex} is too large (${sourceLines.length} lines, ${block.length} chars).`,
        "warning",
      );
      continue;
    }

    const { token, normalized } = getSupportedMermaidType(block);
    if (!normalized) {
      notify(
        `Cannot render Mermaid type "${token ?? "unknown"}". Supported: ${SUPPORTED_TYPE_LABEL}.`,
        "info",
      );
      continue;
    }

    const { hash, details, issues } = await processBlock(block, blockIndex, parser);
    pi.sendMessage({
      customType: MESSAGE_TYPE,
      content: buildContextContent(block, hash, issues, blocks.length > 1),
      display: true,
      details,
    });
  }
}

export default function mermaidExtension(pi: ExtensionAPI): void {
  pi.registerMessageRenderer(MESSAGE_TYPE, createMessageRenderer());

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" as const };

    const text = typeof event.text === "string" ? event.text : "";
    if (!text) return { action: "continue" as const };

    const blocks = extractMermaidBlocks(text);
    if (blocks.length === 0) return { action: "continue" as const };

    await renderBlocks(blocks, ctx, pi);
    return { action: "continue" as const };
  });

  pi.on("agent_end", async (event, ctx) => {
    let assistantText = "";
    for (let index = event.messages.length - 1; index >= 0; index--) {
      const message = event.messages[index];
      if (message?.role !== "assistant") continue;
      assistantText = extractText(message.content);
      if (assistantText.trim()) break;
    }

    if (!assistantText) return;

    const blocks = extractMermaidBlocks(assistantText);
    if (blocks.length === 0) return;

    await renderBlocks(blocks, ctx, pi);
  });
}
