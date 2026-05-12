import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const MIN_BOX_WIDTH = 32;
const MIN_SPLIT_WIDTH = 68;
const BOX_MAX_WIDTH = 92;
const BOX_HORIZONTAL_PADDING = 4;
const COLUMN_GAP_WIDTH = 3;

const START_COMMANDS = [
  "/model pick model",
  "/theme change theme",
  "/reload refresh",
  "/help more commands",
] as const;

type HeaderInfo = {
  readonly tools: string;
  readonly extensions: string;
  readonly prompts: string;
  readonly context: string;
};

type CommandInfo = ReturnType<ExtensionAPI["getCommands"]>[number];
type ToolInfo = ReturnType<ExtensionAPI["getAllTools"]>[number];

const displayWidth = (text: string): number => visibleWidth(text);

const clip = (text: string, width: number): string => truncateToWidth(text, Math.max(0, width));

const center = (text: string, width: number): string => {
  const clipped = clip(text, width);
  const leftPadding = Math.max(0, Math.floor((width - displayWidth(clipped)) / 2));
  return `${" ".repeat(leftPadding)}${clipped}`;
};

const padCell = (text: string, width: number): string => {
  const clipped = clip(text, width);
  const rightPadding = Math.max(0, width - displayWidth(clipped));
  return `${clipped}${" ".repeat(rightPadding)}`;
};

const borderLine = (left: string, fill: string, right: string, width: number): string =>
  `${left}${fill.repeat(Math.max(0, width - 2))}${right}`;

const compactList = (items: readonly string[], emptyLabel: string, maxItems = 3): string => {
  if (items.length === 0) return emptyLabel;
  if (items.length <= maxItems) return items.join(" ");
  return `${items.slice(0, maxItems).join(" ")} +${items.length - maxItems}`;
};

const getContextFiles = (systemPrompt: string): string[] => {
  const matches = systemPrompt.match(/(?:SYSTEM|AGENTS|CLAUDE)\.md/g) ?? [];
  return [...new Set(matches)].sort();
};

const sourcePathFrom = (item: CommandInfo | ToolInfo): string | undefined => item.sourceInfo?.path;

const getHeaderInfo = (pi: ExtensionAPI, ctx: ExtensionContext): HeaderInfo => {
  const activeTools = pi.getActiveTools();
  const allTools = pi.getAllTools();
  const commands = pi.getCommands();
  const prompts = commands.filter((command) => command.source === "prompt");
  const extensionSources = new Set<string>();

  for (const tool of allTools) {
    const sourcePath = sourcePathFrom(tool);
    if (sourcePath) extensionSources.add(sourcePath);
  }

  for (const command of commands) {
    if (command.source !== "extension") continue;

    const sourcePath = sourcePathFrom(command);
    if (sourcePath) extensionSources.add(sourcePath);
  }

  const contextFiles = getContextFiles(ctx.getSystemPrompt());

  return {
    tools: `tools ${activeTools.length}/${allTools.length}`,
    extensions: `extensions ${extensionSources.size}`,
    prompts: `prompts ${prompts.length}`,
    context: `context ${compactList(contextFiles, "none")}`,
  };
};

const createHeaderComponent = (theme: Theme, info: HeaderInfo): Component => ({
  render(width: number): string[] {
    const boxWidth = Math.max(MIN_BOX_WIDTH, Math.min(BOX_MAX_WIDTH, width));
    const contentWidth = boxWidth - BOX_HORIZONTAL_PADDING;
    const title = theme.fg("accent", theme.bold("π"));
    const subtitle = theme.fg("dim", "coding agent");
    const lines: string[] = [center(title, width), center(subtitle, width)];

    const border = (text: string) => theme.fg("borderMuted", text);
    const accent = (text: string) => theme.fg("accent", text);
    const muted = (text: string) => theme.fg("muted", text);
    const dim = (text: string) => theme.fg("dim", text);
    const pushBoxLine = (line: string) => {
      lines.push(center(`${border("│")} ${padCell(line, contentWidth)} ${border("│")}`, width));
    };

    lines.push(center(border(borderLine("╭", "─", "╮", boxWidth)), width));

    if (boxWidth >= MIN_SPLIT_WIDTH) {
      const leftWidth = Math.floor((contentWidth - COLUMN_GAP_WIDTH) * 0.36);
      const rightWidth = contentWidth - leftWidth - COLUMN_GAP_WIDTH;
      const infoRows = [info.tools, info.extensions, info.prompts, info.context];
      const rowCount = Math.max(infoRows.length, START_COMMANDS.length);

      pushBoxLine(
        `${padCell(accent("Info"), leftWidth)} ${border("│")} ${padCell(accent("Start"), rightWidth)}`,
      );
      pushBoxLine(`${padCell(dim(""), leftWidth)} ${border("│")} ${padCell(dim(""), rightWidth)}`);

      for (let index = 0; index < rowCount; index += 1) {
        pushBoxLine(
          `${padCell(muted(infoRows[index] ?? ""), leftWidth)} ${border("│")} ${padCell(muted(START_COMMANDS[index] ?? ""), rightWidth)}`,
        );
      }
    } else {
      pushBoxLine(accent("Info"));
      for (const row of [info.tools, info.extensions, info.prompts, info.context]) {
        pushBoxLine(muted(row));
      }

      pushBoxLine(dim(""));
      pushBoxLine(accent("Start"));
      for (const command of START_COMMANDS) pushBoxLine(muted(command));
    }

    lines.push(center(border(borderLine("╰", "─", "╯", boxWidth)), width));
    return lines;
  },
  invalidate() {},
});

export default (pi: ExtensionAPI): void => {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setHeader((_tui, theme) => createHeaderComponent(theme, getHeaderInfo(pi, ctx)));
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setHeader(undefined);
  });
};
