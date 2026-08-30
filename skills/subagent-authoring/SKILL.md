---
name: subagent-authoring
description: Design, onboard, create, update, or refine Pi subagents from a plain-English idea. Use whenever the user wants a new agent, custom subagent, agent role, agent prompt, agent configuration, tool/skill permissions, subagent workflow, or a guided setup for pi-subagents—even if they do not know the extension schema.
---

# Subagent Authoring

Turn a plain-English agent idea into a small, valid Pi subagent configuration. This is a parent-only workflow: create role specialists, not child orchestrators.

## Start with evidence

1. Call `subagent({ action: "list" })` before proposing a new agent.
2. If a builtin or existing custom agent already fits, recommend a one-run override or a settings override. Use `eject` only when the user needs a substantial persistent change to a builtin.
3. For a proposed update, call `subagent({ action: "get", agent: "…" })` first. Preserve unrelated configuration.
4. Explain that persistent agents live at user or project scope. Choose **project** when the role only makes sense for one repository; otherwise choose **user**.

Do not make local changes until the user approves the final proposal.

## Guided onboarding

First extract what is already clear: intended outcome, input/evidence, whether it edits, expected result, and whether it is reusable. Ask only for missing decisions.

Use one `ask_user_question` call with at most four relevant questions. Do not make the user learn extension jargon. Keep choices adaptive; omit questions whose answer is obvious.

Useful question set:

- **Role** — `Scout / Researcher / Reviewer / Worker` or a custom specialty. Explain each in terms of the requested result.
- **Work shape** — `One focused task / Parallel read-only fanout / Sequential chain / Long-running async`. Offer chain or fanout only if the user actually described multiple independent or ordered steps.
- **Access** — `Read-only (Recommended) / Write project files / Isolated worktree`. Writing needs an explicit reason; worktrees are only for parallel tasks in a clean git repo.
- **Context** — `Fresh (Recommended) / Inherit project context / Fork this conversation`. Fork is a real session branch, not a smaller context window.
- **Capabilities** — ask as a multi-select only when relevant: `Existing skills`, `Specific extensions`, `Narrow tool allowlist`, `No extra capabilities`.
- **Persistence** — `User-wide (Recommended) / This project only`.

When tools or skills are requested, inspect available agents and capabilities first. Only propose an installed skill or an actually provided extension. A `tools` entry is a strict child allowlist, and naming a tool does not load its provider. Omit `tools` for ordinary roles unless a restrictive allowlist is genuinely required. Never grant `subagent` to an ordinary child; only a purpose-built, explicitly approved fanout role may receive it.

## Choose the smallest correct design

Prefer a single agent over a chain, and a run-time override over another persistent agent. Default to:

- `defaultContext: fresh`
- Read-only access and `acceptanceRole: read-only` for scouts, researchers, and reviewers
- One writer in an active worktree; never parallel writers
- Targeted skills only; do not expose the global skill catalog by default
- Distinct output paths for parallel work
- `timeoutMs` only when a real outer deadline is needed

Do not put hard turn/tool budgets on an agent that can modify files. Tool budgets are not write isolation; their default block does not stop `bash`, `write`, or `edit`.

Use a chain only for a reusable ordered workflow. Use parallelism only for independent, read-only tasks. Prefer async only for work that should outlive the current interaction.

## Draft the agent contract

Before creating anything, show a concise proposal containing:

1. **Name and scope** — lowercase kebab-case name; user or project scope.
2. **Purpose** — one clear description suitable for discovery.
3. **Configuration** — only non-default fields: context/inheritance, tools, skills, extensions, model, output, acceptance role, and relevant limits.
4. **Prompt contract** — goal; supplied evidence; success criteria; real constraints; focused validation; output format; stop/escalation rule.
5. **Safety note** — why it can or cannot edit, and how it avoids conflicting writers.

Ask for confirmation after presenting the proposal. If the user wants a prompt only, stop there and do not create a file.

## Create or update

After explicit approval, use the `subagent` management API, not hand-written files:

- New agent: `subagent({ action: "create", config: { ... }, agentScope: "user" | "project" })`
- Existing agent: `subagent({ action: "update", agent: "…", config: { ... }, agentScope: "…" })`
- Substantial builtin customization: `subagent({ action: "eject", agent: "…", agentScope: "…" })`, then update it.

Use documented frontmatter fields only. Provide `name`, `description`, and the Markdown prompt body. Keep complex `turnBudget` and `toolBudget` values as JSON objects. Do not invent YAML nesting; the parser is deliberately limited.

For a saved workflow, create a chain only after the user confirms that it is reusable. Use `.chain.md` for simple static sequencing. Use `.chain.json` only for a bounded structured dynamic fanout.

## Verify and report

Immediately call `subagent({ action: "list" })` and `subagent({ action: "get", agent: "…" })` after creation or update. Confirm the runtime name, scope, resolved configuration, and any discovery warnings.

Report only:

- created/updated agent and scope
- capabilities granted
- how to invoke it
- validation result
- one residual limitation, if any

If an agent was renamed, explicitly check and warn about saved chain references; rename does not rewrite them.

## Prompt template

Use this shape for the Markdown body, adapting it to the role:

```markdown
You are the [role].

Goal: [concrete outcome].
Context: [files, user input, and permitted evidence].
Success: [observable completion conditions].
Constraints: [only real boundaries; whether edits are allowed].
Validation: [smallest meaningful check].
Output: [report/artifact format].
Stop: [when to escalate or stop searching].
```

Do not prescribe an unnecessary procedure. Clear outcomes and boundaries create more reliable agents than long scripts.
