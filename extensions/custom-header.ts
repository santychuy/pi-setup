import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  DefaultPackageManager,
  getAgentDir,
  VERSION,
  SettingsManager,
  type BuildSystemPromptOptions,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type TUI } from "@earendil-works/pi-tui";

type Scope = "global" | "cwd";

interface HeaderState {
  cwd: string;
  agentDir: string;
  contextName: string;
  contextSource: string;
  systemSource: string;
  skills: string;
  prompts: string;
  extensions: string;
  git: string;
  mcp: string;
  tools: string;
  theme: string;
  tui?: TUI;
  phase: number;
  animation?: ReturnType<typeof setInterval>;
}

const CONTEXT_CANDIDATES = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];

const state: HeaderState = {
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  contextName: "none",
  contextSource: "—",
  systemSource: "default",
  skills: "—",
  prompts: "—",
  extensions: "—",
  git: "—",
  mcp: "—",
  tools: "—/—",
  theme: "—",
  phase: 0,
};

function findContextFile(dir: string): { path: string; name: string } | undefined {
  for (const name of CONTEXT_CANDIDATES) {
    const filePath = join(dir, name);
    if (existsSync(filePath)) return { path: filePath, name };
  }
  return undefined;
}

function detectContext(
  cwd: string,
  agentDir: string,
): Pick<HeaderState, "contextName" | "contextSource"> {
  const found: Array<{ name: string; scope: Scope }> = [];
  const global = findContextFile(agentDir);
  if (global) found.push({ name: global.name, scope: "global" });

  const seen = new Set<string>();
  let current = resolve(cwd);
  const root = resolve("/");
  while (true) {
    const file = findContextFile(current);
    if (file && !seen.has(file.path)) {
      found.push({ name: file.name, scope: "cwd" });
      seen.add(file.path);
    }
    if (current === root) break;
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }

  if (found.length === 0) return { contextName: "none", contextSource: "—" };

  const normalizedNames = [...new Set(found.map((f) => f.name.replace(/\.MD$/, ".md")))];
  const contextName =
    normalizedNames.length === 1
      ? normalizedNames[0]
      : normalizedNames.map((name) => name.replace(/\.md$/i, "")).join("+");
  const scopes = new Set(found.map((f) => f.scope));
  const contextSource =
    scopes.has("global") && scopes.has("cwd")
      ? "global+cwd"
      : scopes.has("global")
        ? "global"
        : "cwd";

  return { contextName, contextSource };
}

function detectSystem(cwd: string, agentDir: string): string {
  const base = existsSync(join(cwd, ".pi", "SYSTEM.md"))
    ? "project"
    : existsSync(join(agentDir, "SYSTEM.md"))
      ? "user"
      : "default";
  const append = existsSync(join(cwd, ".pi", "APPEND_SYSTEM.md"))
    ? "project"
    : existsSync(join(agentDir, "APPEND_SYSTEM.md"))
      ? "user"
      : null;
  return append ? `${base} · +${append} append` : base;
}

function scopeLabel(source: string): string {
  if (source === "global+cwd") return "user + project";
  if (source === "global") return "user";
  if (source === "cwd") return "project";
  return source;
}

function formatContext(name: string, source: string): string {
  if (name === "none" || source === "—") return "—";
  return `${name} · ${scopeLabel(source)}`;
}

function formatSystem(source: string): string {
  return source || "default";
}

async function detectResourceCounts(
  cwd: string,
  agentDir: string,
): Promise<Pick<HeaderState, "skills" | "prompts" | "extensions">> {
  try {
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
    const resolved = await packageManager.resolve();
    const enabled = <T extends { enabled: boolean }>(items: T[]) =>
      items.filter((item) => item.enabled).length;
    return {
      skills: String(enabled(resolved.skills)),
      prompts: String(enabled(resolved.prompts)),
      extensions: String(enabled(resolved.extensions)),
    };
  } catch {
    return { skills: "—", prompts: "—", extensions: "—" };
  }
}

function detectGit(cwd: string): string {
  try {
    const branch = execFileSync("git", ["-C", cwd, "branch", "--show-current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const status = execFileSync("git", ["-C", cwd, "status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const dirty = status.trim().length > 0;
    return `${branch || "detached"}${dirty ? "*" : ""}`;
  } catch {
    return "—";
  }
}

function detectMcp(agentDir: string): string {
  try {
    const cachePath = join(agentDir, "mcp-cache.json");
    if (!existsSync(cachePath)) return "—";
    const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as {
      servers?: Record<string, unknown>;
    };
    const count = Object.keys(parsed.servers ?? {}).length;
    return count > 0 ? `${count} ok` : "—";
  } catch {
    return "—";
  }
}

function readThemeName(ctx: ExtensionContext): string {
  const themeName = ctx.ui.theme?.name;
  if (themeName) return themeName;
  try {
    const settingsPath = join(state.agentDir, "settings.json");
    if (!existsSync(settingsPath)) return "—";
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { theme?: string };
    return settings.theme ?? "—";
  } catch {
    return "—";
  }
}

function parseToolCountFromSystemPrompt(systemPrompt: string | undefined): string {
  if (!systemPrompt) return "—/—";
  const match = systemPrompt.match(/Available tools:\n([\s\S]*?)\n\n/);
  if (!match) return "—/—";
  const count = match[1].split("\n").filter((line) => line.trim().startsWith("- ")).length;
  return count > 0 ? `${count}/${count}` : "—/—";
}

function toolsFromPromptOptions(options: BuildSystemPromptOptions): string {
  const total = Object.keys(options.toolSnippets ?? {}).length;
  const active = options.selectedTools?.length ?? total;
  if (active <= 0 && total <= 0) return "—/—";
  return `${active}/${Math.max(total, active)}`;
}

async function refreshState(ctx: ExtensionContext): Promise<void> {
  state.cwd = ctx.cwd;
  state.agentDir = getAgentDir();
  Object.assign(state, detectContext(state.cwd, state.agentDir));
  state.systemSource = detectSystem(state.cwd, state.agentDir);
  Object.assign(state, await detectResourceCounts(state.cwd, state.agentDir));
  state.git = detectGit(state.cwd);
  state.mcp = detectMcp(state.agentDir);
  state.theme = readThemeName(ctx);
  state.tools = parseToolCountFromSystemPrompt(ctx.getSystemPrompt?.());
  state.tui?.requestRender(true);
}

function padVisible(text: string, width: number): string {
  const size = visibleWidth(text);
  return size >= width ? truncateToWidth(text, width, "") : text + " ".repeat(width - size);
}

function centerVisible(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, "");
  const padding = Math.max(0, width - visibleWidth(clipped));
  return " ".repeat(Math.floor(padding / 2)) + clipped + " ".repeat(Math.ceil(padding / 2));
}

function cell(label: string, value: string, width: number): string {
  return centerVisible(`${label} ${value}`, width);
}

// Group 8 logo, rasterized as a 34×24 1-bit bitmap for Unicode Braille (2×4 pixels/cell).
// The right mark is offset two pixels to retain the source artwork's separation.
const LOGO_BITS = [
  "0000000001111100000000000000000000",
  "0000000011111111000000000000000000",
  "0000001111111111000000000000000000",
  "0000111111111111000000000000000000",
  "0001111111111111000000000000000000",
  "0111111111111111000001110000000000",
  "1111111111111111000111111000000000",
  "1111111111111111001111111110000000",
  "1111111111111100001111111111100000",
  "1111111111111100001111111111110000",
  "1111111111111111001111111111111100",
  "1111111111111111001111111111111111",
  "0111111111111111001111111111111111",
  "0001111111111111000111111111111111",
  "0000111111111111000001111111111111",
  "0000001111111111000111111111111111",
  "0000000011111110001111111111111111",
  "0000000001111100001111111111111111",
  "0000000000000000001111111111111100",
  "0000000000000000001111111111111000",
  "0000000000000000001111111111100000",
  "0000000000000000001111111110000000",
  "0000000000000000000111111100000000",
  "0000000000000000000001110000000000",
];
const BRAILLE = [
  [1, 8],
  [2, 16],
  [4, 32],
  [64, 128],
];
const LOGO_COLORS = [
  [26, 46, 132],
  [74, 99, 212],
  [156, 216, 159],
  [255, 255, 255],
] as const;

function renderLogo(): string[] {
  return Array.from({ length: LOGO_BITS.length / 4 }, (_, y) =>
    Array.from({ length: LOGO_BITS[0].length / 2 }, (_, x) => {
      let dots = 0;
      for (let dy = 0; dy < 4; dy++)
        for (let dx = 0; dx < 2; dx++) {
          if (LOGO_BITS[y * 4 + dy]?.[x * 2 + dx] === "1") dots |= BRAILLE[dy]![dx]!;
        }
      if (!dots) return " ";
      const base = LOGO_COLORS[(x + y * 2) % LOGO_COLORS.length]!;
      const glint = Math.max(0, 1 - Math.abs(x + y * 0.45 - state.phase) / 4);
      const color = base.map((channel) => Math.round(channel + (255 - channel) * glint));
      return `\x1b[38;2;${color[0]};${color[1]};${color[2]}m${String.fromCodePoint(0x2800 + dots)}\x1b[39m`;
    }).join(""),
  );
}

function renderHeader(theme: Theme, width: number): string[] {
  const accent = (text: string) => theme.fg("accent", text);
  const muted = (text: string) => theme.fg("muted", text);
  const margin = width >= 20 ? "  " : "";
  const padding = width >= 20 ? " " : "";
  const innerWidth = Math.max(1, width - visibleWidth(margin) * 2 - visibleWidth(padding) * 2 - 2);
  const brandingWidth = Math.min(
    Math.max(28, Math.floor(innerWidth * 0.45)),
    Math.max(1, innerWidth - 4),
  );
  const detailsWidth = Math.max(3, innerWidth - brandingWidth - 1);
  const resourcesWidth = Math.max(1, Math.floor((detailsWidth - 1) / 2));
  const statusWidth = Math.max(1, detailsWidth - resourcesWidth - 1);
  const resourceRows = [
    centerVisible(muted("Resources"), resourcesWidth),
    cell("Context", formatContext(state.contextName, state.contextSource), resourcesWidth),
    cell("System", formatSystem(state.systemSource), resourcesWidth),
    cell("Skills", state.skills, resourcesWidth),
    cell("Prompts", state.prompts, resourcesWidth),
  ];
  while (resourceRows.length < 6) resourceRows.push("");
  const statusRows = [
    centerVisible(muted("Status"), statusWidth),
    cell("Git", state.git, statusWidth),
    cell("MCP", state.mcp, statusWidth),
    cell("Tools", state.tools, statusWidth),
    cell("Theme", state.theme, statusWidth),
    "",
  ];
  const logo = renderLogo();
  const logoWidth = Math.min(17, brandingWidth);
  const titleWidth = Math.max(0, brandingWidth - logoWidth);
  const rows = logo.map((logoLine, index) => {
    const title = index === 2 ? accent("  Pi Agent") : index === 3 ? muted(`  v${VERSION}`) : "";
    const brand = padVisible(
      `${truncateToWidth(logoLine, logoWidth, "")}${padVisible(title, titleWidth)}`,
      brandingWidth,
    );
    return `${margin}│${padding}${brand}│${padVisible(resourceRows[index] ?? "", resourcesWidth)}│${padVisible(statusRows[index] ?? "", statusWidth)}${padding}│${margin}`;
  });
  return [
    `${margin}╭${"─".repeat(brandingWidth + visibleWidth(padding))}┬${"─".repeat(resourcesWidth)}┬${"─".repeat(statusWidth + visibleWidth(padding))}╮${margin}`,
    ...rows,
    `${margin}╰${"─".repeat(brandingWidth + visibleWidth(padding))}┴${"─".repeat(resourcesWidth)}┴${"─".repeat(statusWidth + visibleWidth(padding))}╯${margin}`,
  ];
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    process.stdout.write("\x1b[3J\x1b[2J\x1b[H");
    state.phase = 0;
    await refreshState(ctx);
    ctx.ui.setHeader((tui, theme) => {
      state.tui = tui;
      clearInterval(state.animation);
      state.animation = setInterval(() => {
        state.phase = (state.phase + 0.55) % 24;
        tui.requestRender();
      }, 80);
      return {
        render(width: number): string[] {
          return renderHeader(theme, width);
        },
        invalidate() {},
        dispose() {
          clearInterval(state.animation);
          state.animation = undefined;
          if (state.tui === tui) state.tui = undefined;
        },
      };
    });
  });

  pi.on("session_shutdown", () => {
    clearInterval(state.animation);
    state.animation = undefined;
  });

  pi.on("before_agent_start", async (event, _ctx) => {
    clearInterval(state.animation);
    state.animation = undefined;
    state.tools = toolsFromPromptOptions(event.systemPromptOptions);
    state.tui?.requestRender(true);
  });

  pi.registerCommand("refresh-header", {
    description: "Refresh the custom Pi Agent header data",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      await refreshState(ctx);
      ctx.ui.notify("Pi Agent header refreshed", "info");
    },
  });

  pi.registerCommand("builtin-header", {
    description: "Restore built-in header",
    handler: async (_args, ctx) => {
      ctx.ui.setHeader(undefined);
      ctx.ui.notify("Built-in header restored", "info");
    },
  });
}
