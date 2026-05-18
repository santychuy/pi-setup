import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { resolveEditorBorder, type Colorize } from "../shared/editor-border-resolver";

type AgentMode = "default" | "plan";

type ModeEditorOptions = {
  tui: TUI;
  theme: EditorTheme;
  keybindings: KeybindingsManager;
  getMode: () => AgentMode;
  baseBorder: Colorize;
  bashBorder: Colorize;
  planBorder: Colorize;
};

const STATE_TYPE = "modes-state";
const SWITCH_SHORTCUT = "alt+m";
const FALLBACK_SWITCH_SHORTCUT = "ctrl+shift+m";
const PLAN_TOOL_NAMES = ["read", "grep", "find", "ls", "web_search", "fetch_content"] as const;

const PLAN_MODE_PROMPT = `You are in Pi Plan Mode.

Plan Mode is a read-only, free-form planning and research mode. Your job is to understand, investigate, explain, compare options, identify risks, and help the user shape an approach before implementation.

Rules while Plan Mode is active:
- Do not modify files or propose tool calls that modify files.
- Do not run shell commands. The bash/process tools are intentionally unavailable.
- Use local read/search/list tools to inspect the codebase when project context is needed.
- When the user asks for current information, external documentation, web research, package/library docs, comparisons, or anything that depends on the web, use the available web research tools.
- Use web_search for broad research when no specific URL is provided.
- Use fetch_content when the user provides a direct URL and asks to read, fetch, inspect, summarize, or analyze that page.
- Keep the conversation natural and free-form. Do not force a structured plan unless the user asks for one or it is clearly useful.
- Ask clarifying questions when requirements are ambiguous.
- If the user asks to grill him/her with questions related to the request or conversation, engage in a friendly, informative discussion, to extract relevant information and ideas, don't abuse on asking too many questions.
- Discuss trade-offs, risks, constraints, and verification ideas.
- If the user asks you to implement, edit files, run commands, install dependencies, or otherwise act on the plan, explain that they should switch back to default mode first.`;

const isAgentMode = (value: unknown): value is AgentMode => value === "default" || value === "plan";

const createModeAwareEditor = ({
  tui,
  theme,
  keybindings,
  getMode,
  baseBorder,
  bashBorder,
  planBorder,
}: ModeEditorOptions): CustomEditor => {
  const editor = new CustomEditor(tui, { ...theme, borderColor: baseBorder }, keybindings);

  const applyModeBorder = (): void => {
    editor.borderColor = resolveEditorBorder({
      text: editor.getText(),
      mode: getMode(),
      baseBorder,
      bashBorder,
      planBorder,
    });
  };

  applyModeBorder();

  const baseHandleInput = editor.handleInput.bind(editor);
  const baseSetText = editor.setText.bind(editor);
  const baseInsertTextAtCursor = editor.insertTextAtCursor.bind(editor);
  const baseRender = editor.render.bind(editor);

  editor.handleInput = (data: string): void => {
    baseHandleInput(data);
    applyModeBorder();
  };

  editor.setText = (text: string): void => {
    baseSetText(text);
    applyModeBorder();
  };

  editor.insertTextAtCursor = (text: string): void => {
    baseInsertTextAtCursor(text);
    applyModeBorder();
  };

  editor.render = (width: number): string[] => {
    applyModeBorder();
    return baseRender(width);
  };

  return editor;
};

const restoreMode = (ctx: ExtensionContext): AgentMode => {
  const entries = ctx.sessionManager.getEntries();

  return entries.reduce<AgentMode>((restoredMode, entry) => {
    if (entry.type !== "custom" || entry.customType !== STATE_TYPE) return restoredMode;

    const { data } = entry;
    if (!data || typeof data !== "object" || !("mode" in data)) return restoredMode;

    const candidate = (data as { mode?: unknown }).mode;
    return isAgentMode(candidate) ? candidate : restoredMode;
  }, "default");
};

export default function modesExtension(pi: ExtensionAPI): void {
  let mode: AgentMode = "default";
  let defaultTools: string[] | undefined;
  let activeTui: TUI | undefined;

  const requestRender = (): void => activeTui?.requestRender();

  const rememberMode = (): void => {
    pi.appendEntry(STATE_TYPE, { mode });
  };

  const getPlanTools = (): string[] => {
    const available = new Set(pi.getAllTools().map(({ name }) => name));
    return PLAN_TOOL_NAMES.filter((toolName) => available.has(toolName));
  };

  const applyTools = (): void => {
    if (mode === "plan") {
      pi.setActiveTools(getPlanTools());
      return;
    }

    if (defaultTools?.length) pi.setActiveTools(defaultTools);
  };

  const updateModeUI = (ctx: ExtensionContext, notify = false): void => {
    if (!ctx.hasUI) return;

    ctx.ui.setStatus(
      "modes",
      mode === "plan" ? ctx.ui.theme.fg("accent", "mode: plan") : undefined,
    );
    requestRender();

    if (notify) ctx.ui.notify(`Mode: ${mode}`, "info");
  };

  const setMode = (ctx: ExtensionContext, nextMode: AgentMode, notify = true): void => {
    mode = nextMode;
    rememberMode();
    applyTools();
    updateModeUI(ctx, notify);
  };

  const cycleMode = (ctx: ExtensionContext): void => {
    setMode(ctx, mode === "default" ? "plan" : "default");
  };

  const installModeEditor = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI) return;

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      activeTui = tui;
      return createModeAwareEditor({
        tui,
        theme,
        keybindings,
        getMode: () => mode,
        baseBorder: (text) => ctx.ui.theme.fg("borderMuted", text),
        bashBorder: (text) => ctx.ui.theme.fg("warning", text),
        planBorder: (text) => ctx.ui.theme.fg("accent", text),
      });
    });
  };

  pi.on("session_start", (_event, ctx) => {
    mode = restoreMode(ctx);
    defaultTools = pi.getActiveTools();
    installModeEditor(ctx);
    applyTools();
    updateModeUI(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus("modes", undefined);
    activeTui = undefined;
  });

  pi.on("before_agent_start", async (event) => {
    if (mode !== "plan") return;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${PLAN_MODE_PROMPT}`,
    };
  });

  pi.on("tool_call", async (event) => {
    if (mode !== "plan") return;

    const allowedTools = new Set(getPlanTools());
    if (allowedTools.has(event.toolName)) return;

    return {
      block: true,
      reason: `Plan mode blocks tool '${event.toolName}'. Switch to default mode to use implementation or shell tools.`,
    };
  });

  pi.registerShortcut(SWITCH_SHORTCUT, {
    description: "Cycle agent mode between default and plan",
    handler: async (ctx) => cycleMode(ctx),
  });

  pi.registerShortcut(FALLBACK_SWITCH_SHORTCUT, {
    description: "Cycle agent mode between default and plan",
    handler: async (ctx) => cycleMode(ctx),
  });
}
