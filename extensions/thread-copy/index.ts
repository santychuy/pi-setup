import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
  UserMessage,
} from "@earendil-works/pi-ai";
import { spawn } from "node:child_process";

interface ClipboardCommand {
  command: string;
  args: string[];
  installHint: string;
}

const IMAGE_PLACEHOLDER_PREFIX = "[image omitted";

const getClipboardCommands = (): ClipboardCommand[] => {
  switch (process.platform) {
    case "darwin":
      return [{ command: "pbcopy", args: [], installHint: "pbcopy should be available on macOS." }];
    case "win32":
      return [{ command: "clip", args: [], installHint: "clip should be available on Windows." }];
    default:
      return [
        {
          command: "wl-copy",
          args: [],
          installHint: "Install wl-clipboard for Wayland sessions.",
        },
        {
          command: "xclip",
          args: ["-selection", "clipboard"],
          installHint: "Install xclip for X11 sessions.",
        },
        {
          command: "xsel",
          args: ["--clipboard", "--input"],
          installHint: "Install xsel for X11 sessions.",
        },
      ];
  }
};

const writeClipboardWithCommand = (clipboard: ClipboardCommand, text: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(clipboard.command, clipboard.args, { stdio: ["pipe", "ignore", "pipe"] });
    const stderr: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const detail = Buffer.concat(stderr).toString("utf8").trim();
      reject(new Error(detail || `${clipboard.command} exited with code ${code}`));
    });

    child.stdin.end(text);
  });

const copyToClipboard = async (text: string): Promise<string> => {
  const commands = getClipboardCommands();
  const errors: string[] = [];

  for (const clipboard of commands) {
    try {
      await writeClipboardWithCommand(clipboard, text);
      return clipboard.command;
    } catch (error) {
      errors.push(
        `${clipboard.command}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const hints = commands.map((command) => `- ${command.installHint}`).join("\n");
  throw new Error(`No clipboard command worked.\n${hints}\n\n${errors.join("\n")}`);
};

const isTextContent = (content: unknown): content is TextContent =>
  typeof content === "object" && content !== null && "type" in content && content.type === "text";

const isImageContent = (content: unknown): content is ImageContent =>
  typeof content === "object" && content !== null && "type" in content && content.type === "image";

const isThinkingContent = (content: unknown): content is ThinkingContent =>
  typeof content === "object" &&
  content !== null &&
  "type" in content &&
  content.type === "thinking";

const isToolCall = (content: unknown): content is ToolCall =>
  typeof content === "object" &&
  content !== null &&
  "type" in content &&
  content.type === "toolCall";

const formatImagePlaceholder = (image: ImageContent, index: number): string => {
  const size = Buffer.byteLength(image.data, "base64");
  const sizeLabel = size >= 1024 ? `${Math.round(size / 1024)}KB` : `${size}B`;
  return `${IMAGE_PLACEHOLDER_PREFIX}: #${index}, ${image.mimeType}, ${sizeLabel}]`;
};

const formatUserMessage = (message: UserMessage, imageCounter: { value: number }): string => {
  if (typeof message.content === "string") return message.content;

  return message.content
    .map((content) => {
      if (isTextContent(content)) return content.text;
      if (isImageContent(content)) {
        imageCounter.value += 1;
        return formatImagePlaceholder(content, imageCounter.value);
      }
      return "[unsupported user content omitted]";
    })
    .join("\n\n");
};

const formatAssistantMessage = (message: AssistantMessage): string =>
  message.content
    .map((content) => {
      if (isTextContent(content)) return content.text;
      if (isThinkingContent(content)) return "[thinking omitted]";
      if (isToolCall(content)) return `[tool call omitted: ${content.name}]`;
      return "[unsupported assistant content omitted]";
    })
    .filter((text) => text.trim().length > 0)
    .join("\n\n");

const formatThread = (
  ctx: Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1],
): string => {
  const imageCounter = { value: 0 };
  const sections: string[] = [];

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;

    const { message } = entry;
    if (message.role === "user") {
      sections.push(`## User\n\n${formatUserMessage(message, imageCounter).trim()}`);
    } else if (message.role === "assistant") {
      const content = formatAssistantMessage(message).trim();
      if (content.length > 0) sections.push(`## Assistant\n\n${content}`);
    }
  }

  return sections.join("\n\n---\n\n").trimEnd() + "\n";
};

export default function threadCopyExtension(pi: ExtensionAPI): void {
  pi.registerCommand("copy-thread", {
    description: "Copy the current active session thread to the clipboard",
    handler: async (_args, ctx) => {
      const thread = formatThread(ctx);

      if (thread.trim().length === 0) {
        ctx.ui.notify("No user or assistant messages found in this thread.", "warning");
        return;
      }

      try {
        await copyToClipboard(thread);
        ctx.ui.notify("Copied thread to clipboard.", "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
