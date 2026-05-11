import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type TerminalType =
  | "kitty"
  | "wezterm"
  | "ghostty"
  | "iterm2"
  | "macos-terminal"
  | "warp"
  | "unknown";

interface ChimeConfig {
  sound?: string;
}

// ── Config storage ──────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".config", "pi-chime");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const DEFAULT_SOUND = "Purr";

const AVAILABLE_SOUNDS = [
  { name: "Purr", description: "Soft and pleasant" },
  { name: "Glass", description: "Clear timer-like" },
  { name: "Hero", description: "Triumphant" },
];

const loadConfig = (): ChimeConfig => {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      return JSON.parse(raw) as ChimeConfig;
    }
  } catch {
    // ignore read/parse errors
  }
  return {};
};

const saveConfig = (config: ChimeConfig): void => {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // ignore write errors
  }
};

const getSound = (): string => loadConfig().sound ?? DEFAULT_SOUND;

// ── Terminal detection ──────────────────────────────────────────────────────

const normalizeTerm = (s?: string): string => (s ?? "").toLowerCase().trim();

const detectTerminal = (): TerminalType => {
  const tp = normalizeTerm(process.env.TERM_PROGRAM);

  // Primary: unique env vars set by each terminal (most reliable)
  if (process.env.KITTY_WINDOW_ID) return "kitty";
  if (process.env.WEZTERM_PANE) return "wezterm";
  if (process.env.GHOSTTY_RESOURCES_DIR) return "ghostty";
  if (process.env.ITERM_SESSION_ID) return "iterm2";

  // Secondary: TERM_PROGRAM (handles sudo, ssh, tmux passthrough)
  if (tp === "warpterminal" || process.env.WARP_HONOR_PS1) return "warp";
  if (tp === "apple_terminal") return "macos-terminal";
  if (tp === "wezterm") return "wezterm";
  if (tp === "ghostty") return "ghostty";
  if (tp === "iterm.app") return "iterm2";

  return "unknown";
};

// ── Terminal-native protocols ───────────────────────────────────────────────

const notifyOSC99 = (title: string, body: string): void => {
  // Kitty native: multi-part with ID so title + body group into one notification
  process.stdout.write(`\x1b]99;i=1:d=0;${title}\x1b\\`);
  process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
};

const notifyOSC777 = (title: string, body: string): void => {
  // rxvt-unicode originated; supported by Warp and many VTE terminals
  process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
};

const notifyOSC9 = (message: string): void => {
  // iTerm2 native; adopted by Ghostty and WezTerm
  process.stdout.write(`\x1b]9;${message}\x07`);
};

const notifyBEL = (): void => {
  process.stdout.write("\x07");
};

// ── macOS desktop notification ──────────────────────────────────────────────

const isDarwin = process.platform === "darwin";

const escapeAppleScript = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const notifyMacOS = (title: string, body: string, sound?: string): void => {
  const soundArg = sound ? ` sound name "${escapeAppleScript(sound)}"` : "";
  const script = `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"${soundArg}`;
  execFile("osascript", ["-e", script], (err) => {
    if (err) return;
  });
};

// ── Main chime routine ──────────────────────────────────────────────────────

const chime = (title: string, body: string): void => {
  const terminal = detectTerminal();
  const sound = getSound();

  // 1. Terminal-native notification (best protocol for the detected emulator)
  switch (terminal) {
    case "kitty":
      notifyOSC99(title, body);
      break;
    case "ghostty":
    case "wezterm":
    case "iterm2":
      // Ghostty, WezTerm, and iTerm2 all support OSC 9 natively
      notifyOSC9(`${title}: ${body}`);
      break;
    case "macos-terminal":
      // Terminal.app doesn't support OSC notifications
      break;
    default:
      // Warp + unknown terminals: OSC 777 has the widest support
      notifyOSC777(title, body);
      break;
  }

  // 2. macOS Notification Center banner (always on macOS, regardless of terminal)
  if (isDarwin) {
    notifyMacOS(title, body, sound);
  }

  // 3. Universal BEL fallback
  notifyBEL();
};

// ── Settings menu ───────────────────────────────────────────────────────────

const showSettingsMenu = async (ctx: {
  ui: {
    select: (title: string, options: string[]) => Promise<string | undefined>;
    notify: (message: string, type?: "info" | "warning" | "error") => void;
  };
}): Promise<void> => {
  const currentSound = getSound();

  const choice = await ctx.ui.select("Chime Settings", [
    "Test notification",
    `Change sound (current: ${currentSound})`,
    "Exit",
  ]);

  if (choice === "Test notification") {
    chime("Pi Chime", "Test notification");
    ctx.ui.notify(`Chime sent with sound: ${getSound()}`, "info");
  } else if (choice?.startsWith("Change sound")) {
    const soundOptions = AVAILABLE_SOUNDS.map((s) => `${s.name} — ${s.description}`);
    const selected = await ctx.ui.select("Select notification sound", soundOptions);

    if (selected) {
      const soundName = selected.split(" — ")[0];
      if (soundName) {
        saveConfig({ sound: soundName });
        ctx.ui.notify(`Notification sound set to: ${soundName}`, "info");
        // Preview the selected sound immediately
        notifyMacOS("Pi Chime", "Sound preview", soundName);
      }
    }
  }
  // Exit: do nothing
};

// ── Extension entrypoint ────────────────────────────────────────────────────

export default (pi: ExtensionAPI): void => {
  pi.on("agent_end", () => {
    chime("Pi", "Ready for input");
  });

  pi.registerCommand("chime", {
    description: "Chime settings — test notification or change sound",
    handler: async (_args, ctx) => {
      await showSettingsMenu(ctx);
    },
  });
};
