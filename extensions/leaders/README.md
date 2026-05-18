# pi-leaders

Leader subagents for Pi — delegate focused tasks to child Pi processes with isolated context.

## Features

- **Agent profiles**: Named specialists (scout, planner, reviewer, worker, oracle) with custom system prompts, tools, and models
- **Session modes**: Ephemeral (default), persistent (saved), fork (saved branch), and ephemeral-fork (temporary branch with cleanup/recovery)
- **Structured results**: Full usage stats, tool calls, model info, stop reasons — not just text
- **Async/background**: Run leaders in the background while the parent continues working
- **Live streaming**: Real-time progress updates during foreground runs

### Add-ons (simple overview)

- **Delegation contract (V1)**: Optional `contract` input to request structured final output.
- **Contract validation**: Contracted runs validate final output; invalid shape returns `schema_error`.
- **Budget policy (V1)**: Optional `budget` input for runtime limits.
- **Default depth guardrail**: `maxDelegationDepth = 1` (leaders spawn only one level for now).

## Usage

### Tool

Ask Pi naturally, or call the `leader` tool directly:

```json
{ "task": "Inspect this repository and summarize the auth middleware." }
```

```json
{ "task": "Review this diff for correctness", "agent": "reviewer" }
```

```json
{ "task": "Continue this refactor", "mode": "fork", "agent": "worker" }
```

```json
{
  "task": "Audit auth flow",
  "agent": "reviewer",
  "contract": { "version": "1.0", "taskId": "auth-audit-1", "goal": "Find auth risks" }
}
```

```json
{
  "task": "Run scoped analysis",
  "agent": "scout",
  "budget": {
    "version": "1.0",
    "limits": {
      "maxAgentsPerRun": 3,
      "maxParallel": 2,
      "maxDelegationDepth": 1,
      "maxDurationMs": 300000
    }
  }
}
```

```json
{ "task": "Run background analysis", "agent": "scout", "async": true }
```

```json
{ "action": "list" }
```

```json
{ "action": "status" }
```

```json
{ "action": "status", "id": "abc123..." }
```

```json
{ "action": "cleanup" }
```

### Slash command

```
/leader inspect this repository
/leader --persistent @reviewer review this plan
/leader --fork @worker continue this refactor
/leader --ephemeral-fork @reviewer review using current context without saving the child session
```

## Agent Profiles

| Agent      | Purpose                            | Model             | Tools                      |
| ---------- | ---------------------------------- | ----------------- | -------------------------- |
| `default`  | General-purpose (no system prompt) | Parent model      | read, bash, grep, find, ls |
| `scout`    | Fast codebase recon                | claude-haiku-4-5  | read, grep, find, ls, bash |
| `planner`  | Implementation plans (read-only)   | claude-sonnet-4-5 | read, grep, find, ls       |
| `reviewer` | Code review                        | claude-sonnet-4-5 | read, grep, find, ls, bash |
| `worker`   | Full implementation                | claude-sonnet-4-5 | all defaults               |
| `oracle`   | Second opinion (no edits)          | claude-sonnet-4-5 | read, grep, find, ls       |

### Custom agents

Create `.md` files in `~/.pi/agent/leaders/` with YAML frontmatter:

```markdown
---
name: my-agent
description: What this agent does
tools: read, grep, find, ls
model: claude-haiku-4-5
systemPromptMode: replace
inheritProjectContext: false
inheritSkills: false
sessionMode: ephemeral
---

Your system prompt goes here.
```

User agents override built-in agents with the same name.

## Session Modes

### Ephemeral (default)

No saved session. Best for one-shot tasks: exploration, research, reviews, Q&A.

### Persistent

Saves session to `~/.pi/agent/sessions/leaders/`. Use for follow-up, continuity, or audit trails.

### Fork

Branches from the parent's current conversation. The leader inherits full context and appends its work to the branched session file. Best for context-aware tasks: continuing a discussion, reviewing in-context code, building on a plan.

Fork requires the parent session to be persisted and have a current leaf. If that is not available, the run fails clearly instead of silently falling back to another mode.

### Ephemeral fork

Branches from the parent's current conversation so the leader gets full context, then deletes the branched child session after the child exits. Best for context-aware one-shot tasks where only the final answer should remain.

In async mode, cleanup metadata is stored with the async run so interrupted parents can retry deletion on the next session start or via `leader({ action: "cleanup" })`.

## Background/Async

Add `async: true` to run in the background. Async is an execution mode and can be combined with any session mode. Async `fork` uses the same persisted branched-session behavior as foreground `fork`.

Async `ephemeral-fork` creates a temporary branch, runs the detached child with parent context, and records cleanup metadata in `status.json`.

Cleanup is attempted when the child closes, when the child fails to start, when a later parent session detects stale/interrupted async runs, or when `leader({ action: "cleanup" })` is called.

If cleanup fails, async run metadata is kept so cleanup can be retried later. Old async run directories are only pruned after their temporary session cleanup has succeeded or no cleanup is required. If status shows `Cleanup: pending`, the leader result is terminal but the temporary fork session file still needs deletion retry.

```json
{ "task": "Analyze the codebase architecture", "agent": "scout", "async": true }
```

Returns a run ID immediately. Check status:

```json
{ "action": "status", "id": "abc123..." }
```

List all async runs:

```json
{ "action": "status" }
```

## Architecture

```
extensions/leaders/
  index.ts              # Extension entry point
  agents/               # Built-in agent .md profiles
    scout.md
    planner.md
    reviewer.md
    worker.md
    oracle.md
  src/
    types.ts            # All type definitions
    stream-parser.ts    # JSON event stream parsing
    format.ts           # Result formatting and display
    spawn-builder.ts    # CLI arg builder (shared by sync/async)
    session.ts          # Session mode resolution (shared by sync/async)
    async.ts            # Background execution and status tracking
    utils.ts            # Paths, temp files, constants
```

## What happens

1. The extension resolves the agent profile (or defaults to no system prompt)
2. It builds CLI args with the right session mode, tools, model, and system prompt
3. It spawns a `pi --mode json -p` child process
4. For foreground: streams events and returns structured result
5. For background: detaches the child and writes status to filesystem

Forked sessions use `SessionManager.open(parentFile).createBranchedSession(leafId)` to create a real session branch.

## Security

- Child processes run with `--no-extensions` (no inherited extensions)
- `PI_LEADERS_CHILD=1` environment variable marks child processes
- Forked context: children cannot call the `leader` tool (no extensions)
- Project-local agents require confirmation (not yet implemented in leaders)

## Development

See [`docs/learning-process.md`](docs/learning-process.md) for architecture notes, [`docs/session-modes-plan.md`](docs/session-modes-plan.md) for the session modes design, and [`docs/async-ephemeral-fork-validation.md`](docs/async-ephemeral-fork-validation.md) for manual async ephemeral-fork validation.
