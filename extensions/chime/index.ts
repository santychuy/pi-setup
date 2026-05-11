import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";

type TerminalType = "kitty" | "wezterm" | "ghostty" | "macos-terminal" | "warp" | "unknown";

const detectTerminal = (): TerminalType => {
  if (process.env.KITTY_WINDOW_ID) return "kitty";
  if (process.env.WEZTERM_PANE_ID) return "wezterm";
  if (process.env.GHOSTTY_WINDOWS_DIR) return "ghostty";
  if (process.env.TERM_PROGRAM === "Apple_Terminal") return "macos-terminal";
  if (process.env.TERM_PROGRAM === "WarpTerminal" || process.env.WARP_HONOR_PS1) return "warp";
  return "unknown";
};

const notifyOSC777 = (title: string, body: string): void => {
  process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
};

const notifyOSC99 = (title: string, body: string): void => {
  process.stdout.write(`\x1b]99;i=1:d=0;${title}\x1b\\`);
  process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
};

const notifyMacOS = (title: string, body: string): void => {
  const script = `display notification "${body}" with title "${title}"`;
  execFile("osascript", ["-e", script], (err) => {
    if (err) return;
  });
};

const notifyBEL = (): void => {
  process.stdout.write("\x07");
};

const chime = (title: string, body: string): void => {
  const terminal = detectTerminal();

  switch (terminal) {
    case "kitty":
      notifyOSC99(title, body);
      break;
    case "macos-terminal":
      notifyMacOS(title, body);
      break;
    default:
      notifyOSC777(title, body);
      break;
  }

  notifyBEL();
};

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
