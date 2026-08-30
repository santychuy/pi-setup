import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const GRILL_TOOL_NAMES = new Set(["read", "ls", "web_search", "web_fetch", "ask_user_question"]);
const ORCHESTRATOR_TOOL_NAMES = new Set([
  "read",
  "subagent",
  "subagent_wait",
  "subagent_supervisor",
]);

type Mode = "normal" | "grilling" | "orchestrator";

interface ModeState {
  mode: Mode;
  normalTools: string[];
}

const GRILLING_INSTRUCTIONS = `[GRILLING MODE ACTIVE — STRESS-TEST, NO WRITES]

You are in Grilling mode. Force shared understanding of one user idea toward one named goal. Do not implement, create tickets, or make irreversible changes.

Done when: shared understanding + kill-tests run + remaining assumptions named. Not when you "have a plan."

Available tools:
{{TOOLS}}

All other tools are unavailable. No bash, write, edit, or side effects. If a request needs a blocked tool, say Grilling mode blocks it and that /mode normal allows it. Do not imply the action ran.

Every turn, in order:
1. Restate the idea in the user's words, then your steelman. If they diverge, ask. Do not silently improve the idea.
2. Investigate blocking facts yourself (repo, docs, constraints). Do not interview for discoverable facts.
3. Hard-test: at least one kill criterion, alternative that deletes the idea, blast radius, rollback, owner, or cheapest validation.
4. Ask only unlocked frontier decisions (3–5 max, high-irreversibility first). Facts = agent. Decisions = user.
5. Wait for answers. Recompute. Do not assume unanswered decisions.

Keep these cards live and short. Rewrite each round.

## Goal
- Outcome:
- Success measure:
- In / out of scope:
- Stop condition:

## Idea (steelman)
- User claim:
- Agent restatement:
- What would make this false:

## Grilling map
- Settled:
- Open facts (agent-owned):
- Frontier decisions (user-owned):
- Material risks / irreversible bets:
- Context added this round:

No cosmetic branches. No fake certainty. Finish with: recommended path, rejected alternatives, remaining assumptions, top risks, and an explicit ask that shared understanding is reached. Do not act until the user confirms.`;

export default function modes(pi: ExtensionAPI): void {
  let mode: Mode = "normal";
  let normalTools: string[] = [];

  function availableTools(toolNames: Set<string>): string[] {
    const registered = new Set(pi.getAllTools().map((tool) => tool.name));
    return [...toolNames].filter((name) => registered.has(name));
  }

  function isRestrictedMode(value: Mode): value is "grilling" | "orchestrator" {
    return value === "grilling" || value === "orchestrator";
  }

  function allowedToolsFor(value: "grilling" | "orchestrator"): string[] {
    return availableTools(value === "grilling" ? GRILL_TOOL_NAMES : ORCHESTRATOR_TOOL_NAMES);
  }

  function persist(): void {
    pi.appendEntry<ModeState>("agent-mode", { mode, normalTools });
  }

  function updateUI(ctx: ExtensionContext): void {
    const status =
      mode === "grilling"
        ? "MODE: GRILLING (stress-test)"
        : mode === "orchestrator"
          ? "MODE: ORCHESTRATOR (delegate-only)"
          : "MODE: NORMAL";
    ctx.ui.setStatus("agent-mode", status);
  }

  function setMode(nextMode: Mode, ctx: ExtensionContext, save = true): void {
    const leavingRestrictedMode = isRestrictedMode(mode) && nextMode === "normal";
    if (isRestrictedMode(nextMode)) {
      if (!isRestrictedMode(mode)) normalTools = pi.getActiveTools();
      mode = nextMode;
      pi.setActiveTools(allowedToolsFor(nextMode));
    } else {
      mode = "normal";
      pi.setActiveTools(normalTools);
      if (leavingRestrictedMode && save) {
        pi.sendMessage(
          {
            customType: "normal-mode-instructions",
            display: false,
            content:
              "[NORMAL MODE ACTIVE]\n\nYou are back in Normal mode. Follow the user's request directly using your usual tools and capabilities; no special mode restrictions or instructions apply.",
          },
          { deliverAs: "nextTurn" },
        );
      }
    }

    updateUI(ctx);
    if (save) persist();
  }

  function restore(ctx: ExtensionContext): void {
    let saved: ModeState | { mode: string; normalTools?: string[] } | undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === "agent-mode") {
        saved = entry.data as ModeState;
      }
    }

    if (saved?.mode === "plan") saved = { ...saved, mode: "grilling" };
    if (saved?.mode === "grilling" || saved?.mode === "orchestrator" || saved?.mode === "normal") {
      mode = saved.mode;
      if (Array.isArray(saved.normalTools)) normalTools = saved.normalTools;
    }
    setMode(mode, ctx, false);
  }

  pi.registerCommand("mode", {
    description: "Switch tool mode: grilling, orchestrator, normal, or status",
    getArgumentCompletions: (prefix) => {
      const items = ["grilling", "orchestrator", "normal", "status"]
        .filter((value) => value.startsWith(prefix.toLowerCase()))
        .map((value) => ({ value, label: value }));
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      const choice = args.trim().toLowerCase();
      if (choice === "grilling" || choice === "orchestrator" || choice === "normal") {
        setMode(choice, ctx);
        ctx.ui.notify(`Mode changed to ${choice}.`, "info");
        return;
      }
      if (choice === "status" || choice === "") {
        ctx.ui.notify(`Current mode: ${mode}`, "info");
        return;
      }
      ctx.ui.notify("Usage: /mode grilling | orchestrator | normal | status", "error");
    },
  });

  pi.registerShortcut("ctrl+alt+p", {
    description: "Cycle tool mode",
    handler: async (ctx) => {
      const nextMode: Mode =
        mode === "normal" ? "grilling" : mode === "grilling" ? "orchestrator" : "normal";
      setMode(nextMode, ctx);
      ctx.ui.notify(`Mode changed to ${nextMode}.`, "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    normalTools = pi.getActiveTools();
    restore(ctx);
  });
  pi.on("session_tree", async (_event, ctx) => restore(ctx));

  pi.on("before_agent_start", async () => {
    if (mode === "normal") return;

    if (mode === "grilling") {
      const allowedTools = allowedToolsFor(mode);
      return {
        message: {
          customType: "grilling-mode-instructions",
          display: false,
          content: GRILLING_INSTRUCTIONS.replace(
            "{{TOOLS}}",
            allowedTools.map((name) => `- ${name}`).join("\n") || "- none",
          ),
        },
      };
    }

    const allowedTools = allowedToolsFor(mode);
    return {
      message: {
        customType: "orchestrator-mode-instructions",
        display: false,
        content: `[ORCHESTRATOR MODE ACTIVE — DELEGATE-ONLY]

You are the orchestrator. Plan, delegate, supervise, and synthesize; do not do execution work yourself.

Your allowed tools:
${allowedTools.map((name) => `- ${name}`).join("\n") || "- none"}

All other tools are unavailable. Do not use or claim to use shell commands, edits, writes, web tools, browsers, MCP tools, or integrations.

For every task that needs work beyond directly reading a file:
1. Use subagent({ action: "list" }) to discover the available agents, chains, roles, and capabilities.
2. Select the most suitable available subagent(s) based on the request.
3. Choose the most efficient supported delegation strategy: a single agent for focused work, parallel agents for independent read-only work, a chain for dependent stages, one writer for shared-worktree changes, and async work when it can proceed independently.
4. Give selected agents the user’s goal, relevant context, constraints, expected result, and any necessary validation.
5. Supervise results, answer child decision requests, request follow-ups when needed, and synthesize the evidence for the user.

Use the Pi subagent tool and its available strategies intelligently. Do not assume a fixed agent roster: inspect discovery first and route work according to the agents and workflows actually available.

Never claim work is complete without delegated evidence. State what was verified, what remains uncertain, and any remaining risks.`,
      },
    };
  });

  pi.on("tool_call", async (event) => {
    if (!isRestrictedMode(mode)) return;
    const allowed = mode === "grilling" ? GRILL_TOOL_NAMES : ORCHESTRATOR_TOOL_NAMES;
    if (allowed.has(event.toolName)) return;
    return {
      block: true,
      reason: `${mode === "grilling" ? "Grilling" : "Orchestrator"} mode blocked "${event.toolName}": switch to Normal mode with /mode normal to use it.`,
    };
  });
}
