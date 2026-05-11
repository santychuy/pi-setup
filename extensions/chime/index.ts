import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";

type TerminalType =
  | "kitty"
  | "wezterm"
  | "ghostty"
  | "iterm2"
  | "macos-terminal"
  | "warp"
  | "unknown";

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

const notifyMacOS = (title: string, body: string): void => {
  const script = `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"`;
  execFile("osascript", ["-e", script], (err) => {
    if (err) return;
  });
};

// ── Main chime routine ──────────────────────────────────────────────────────

const chime = (title: string, body: string): void => {
  const terminal = detectTerminal();

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
    notifyMacOS(title, body);
  }

  // 3. Universal BEL fallback
  notifyBEL();
};

// ── Extension entrypoint ────────────────────────────────────────────────────

export default (pi: ExtensionAPI): void => {
  pi.on("agent_end", () => {
    chime("Pi", "Ready for input");
  });

  pi.registerCommand("chime", {
    description: "Send a test terminal notification",
    handler: async (_args, ctx) => {
      const terminal = detectTerminal();
      chime("Pi Chime", "Test notification");
      ctx.ui.notify(`Chime sent (detected: ${terminal})`, "info");
    },
  });
};
