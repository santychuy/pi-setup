# Leaders Extension — Architecture & Implementation Guide

This document explains how the `leaders` extension works, what each module does, and how the pieces fit together. It is written for someone reading the codebase for the first time.

## What leaders does

Leaders lets a parent Pi session delegate tasks to focused child Pi processes. Each child runs in isolation with its own context, tools, and optional system prompt. The parent gets back a structured result with the child's output, usage stats, tool calls, and exit status.

## Mental model

```
Parent Pi session
  └─ leaders extension (runs inside the parent process)
      ├─ Discovers agent profiles from .md files
      ├─ Resolves which agent + mode + task to run
      ├─ For foreground:
      │   └─ spawn("pi", ["--mode", "json", "-p", ...])
      │       └─ child Pi process (blocked, parent waits)
      │           └─ stdout JSON lines → parsed into LeaderSingleResult
      └─ For background:
          └─ spawn("pi", [...], { detached: true })
              └─ child Pi process (independent, parent continues)
                  └─ writes to ~/.pi/agent/sessions/leaders/async/<id>/
                      ├─ status.json   → run metadata + results
                      └─ output.log    → raw child output
```

The parent never creates an in-memory agent. It spawns a real `pi` CLI process, gives it a task, and collects the result.

## Module map

```
extensions/leaders/
  index.ts              Extension entry point
    ├─ Tool + command registration
    ├─ Agent discovery (built-in + user)
    ├─ Forked context (SessionManager.createBranchedSession)
    ├─ runLeader() — foreground execution (with tracker integration)
    ├─ Widget update helper (updateWidget)
    ├─ Slash command parser (/leader @scout --fork task)
    ├─ Global LeaderTracker instance
    ├─ Session lifecycle hook (widget setup + cleanup)
    ├─ turn_end / agent_end hooks (prune completed entries)
    └─ Tracker → widget re-render via onUpdate callback

  agents/               Built-in agent .md profiles
    scout.md            Fast codebase recon (haiku)
    planner.md          Implementation planning (sonnet, read-only)
    reviewer.md         Code review (sonnet)
    worker.md           Full implementation (sonnet, all tools)
    oracle.md           Second opinion, no edits (sonnet)

  src/
    types.ts            All shared type definitions
      ├─ LeaderSessionMode: "ephemeral" | "persistent" | "fork"
      ├─ LeaderUsageStats: input/output/cache tokens, cost, turns
      ├─ LeaderDisplayItem: text | toolCall | toolResult
      ├─ LeaderSingleResult: full structured result
      ├─ LeaderAgentConfig: agent profile definition
      └─ DEFAULT_AGENT + DEFAULT_TOOLS

    stream-parser.ts    JSON event stream parser
      ├─ processStreamLine()  → parses one JSON line, mutates state
      ├─ processStreamChunk() → processes a chunk of stdout
      ├─ getFinalOutput()    → extracts last assistant text
      └─ createStreamParseState() → initial empty state

    format.ts           Result formatting for the parent agent
      ├─ formatLeaderResult()  → human-readable multi-line result
      ├─ formatUsageStats()   → "3 turns ↑12k ↓2k R5k W1k $0.0234"
      └─ formatDisplayItems() → collapsed view of tool calls + text

    spawn-builder.ts    Shared CLI argument builder
      └─ buildLeaderArgs(task, ctx, agent, mode, sessionFile?, tmpPromptPath?)
          ├─ Session flags: --session / --no-session
          ├─ --no-extensions (safety)
          ├─ --tools <comma-separated>
          ├─ --model <provider/id>
          ├─ --append-system-prompt <temp-file>
          └─ Task as positional argument

    async.ts            Background execution
      ├─ spawnAsyncLeader()   → detach child, return run ID
      ├─ readAsyncStatus()    → read status.json by run ID
      ├─ listAsyncRuns()      → list all async runs
      ├─ cleanupOldAsyncRuns() → delete runs older than 24h
      └─ formatAsyncStatus()  → human-readable run summary

    tracker.ts          In-memory subagent state tracker
      ├─ LeaderStatus type: spawning | running | completed | failed | cancelled
      ├─ LeaderEntry interface: id, agent, task, mode, status, timestamps
      ├─ LeaderTracker class:
      │   ├─ add(agent, task, mode) → entry id
      │   ├─ markRunning(id) / markCompleted(id, exitCode)
      │   ├─ markFailed(id, exitCode?) / markCancelled(id)
      │   ├─ getAll() / get(id) / hasActive
      │   ├─ pruneCompleted() → remove terminal entries
      │   ├─ clear() → remove all entries
      │   └─ onUpdate(callback) → register change listener

    widget.ts            TUI widget renderer
      ├─ STATUS_ICONS: ◌ ● ✓ ✗ ⊘  (maps status → symbol)
      ├─ STATUS_COLORS: maps status → theme.fg() color function
      └─ renderLeadersWidget(entries, theme) → string[] | undefined
          Returns styled lines for each entry, or undefined when empty

    utils.ts            Shared utilities
      ├─ SESSION_DIR, ASYNC_DIR  → path constants
      ├─ makeSessionFile()       → create persistent session path
      ├─ writePromptToTempFile() → temp .md for --append-system-prompt
      ├─ cleanupTempFile()       → remove temp files
      └─ modelArg()              → resolve "provider/model" from context
```

## How a foreground run works

```
1. Parent calls leader tool: { task: "review this", agent: "reviewer", mode: "fork" }

2. `tracker.add("reviewer", task, "fork")` → creates entry in "spawning" state
   → Widget appears above editor: `◌ reviewer Review this... fork`

3. discoverLeaderAgents()
   Loads builtin agents from agents/*.md
   Loads user agents from ~/.pi/agent/leaders/*.md
   User overrides builtin on name collision

3. resolveAgent("reviewer", discovery)
   Finds the agent config or returns an error string

4. Session setup
   mode = "ephemeral" → --no-session
   mode = "persistent" → --session <new-file>
   mode = "fork" → SessionManager.open(parentFile).createBranchedSession(leafId)
     If fork fails (no parent session) → return error result

5. writePromptToTempFile(agent.name, agent.systemPrompt)
   Agent's system prompt body → temp .md file → --append-system-prompt

6. buildLeaderArgs(task, ctx, agent, mode, sessionFile, tmpPromptPath)
   Assembles the full CLI argument vector

7. `tracker.markRunning(entryId)` → entry transitions to "running"
   → Widget updates: `● reviewer Review this... fork`

8. spawn("pi", args, { cwd, env: { PI_LEADERS_CHILD: "1" } })
   Child runs, emits JSON lines on stdout

8. processStreamChunk() accumulates stream state:
   - message_end → usage, display items, model, stop reason
   - tool_result_end → tool result display items
   - message_update (text_delta) → live progress text

9. On child exit → assemble LeaderSingleResult
   - finalOutput from last assistant text
   - displayItems with all tool calls/results
   - usage stats (input/output/cache tokens, cost, turns)
   - model, stopReason, errorMessage

10. On child exit → assemble LeaderSingleResult + `tracker.markCompleted/markFailed/markCancelled(entryId)`
    → Widget briefly shows final icon: `✓ reviewer Review this... fork`
    → On next turn_end, completed entry is pruned and widget disappears

11. formatLeaderResult() → human-readable string
    Leader ✓ reviewer completed.
    Mode: fork
    Session: ~/.pi/agent/sessions/leaders/leader-fork-...

    Usage: 3 turns ↑12k ↓2k R5k $0.0234 claude-sonnet-4-5

    [structured output text]
```

## How a background run works

```
1. Parent calls leader tool: { task: "analyze codebase", agent: "scout", async: true }

2. Same agent resolution as foreground

3. spawnAsyncLeader(task, ctx, agent, mode)
   - Creates run ID (UUID)
   - mkdir ~/.pi/agent/sessions/leaders/async/<id>/
   - Writes initial status.json (status: "running")
   - spawn("pi", args, { detached: true })
   - proc.unref() → parent continues immediately
   - Returns { id, agent, task, mode, status: "running", ... }

4. Child runs independently
   - stdout/stderr piped to output.log
   - On exit → status.json updated with "completed"/"failed"
   - Result parsed from log file into LeaderSingleResult

5. Parent checks back later:
   leader({ action: "status", id: "<run-id>" })
   → reads status.json → returns formatted result
```

## Agent profiles

Each agent is a Markdown file with YAML frontmatter:

```markdown
---
name: scout
description: Fast codebase recon
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
systemPromptMode: replace
inheritProjectContext: false
inheritSkills: false
sessionMode: ephemeral
---

You are a scout. Quickly investigate a codebase...
```

### Frontmatter fields

| Field                   | Required | Default                  | Description                                              |
| ----------------------- | -------- | ------------------------ | -------------------------------------------------------- |
| `name`                  | ✅       | —                        | Lookup key for agent resolution                          |
| `description`           | ✅       | —                        | Shown in `leader({ action: "list" })`                    |
| `tools`                 | ❌       | `read,bash,grep,find,ls` | Comma-separated tool allowlist                           |
| `model`                 | ❌       | Parent model             | Per-agent model override                                 |
| `systemPromptMode`      | ❌       | `replace`                | `replace` (clean prompt) or `append` (adds to Pi's base) |
| `inheritProjectContext` | ❌       | `false`                  | Whether child sees project `AGENTS.md`                   |
| `inheritSkills`         | ❌       | `false`                  | Whether child sees skills catalog                        |
| `sessionMode`           | ❌       | `ephemeral`              | Default session mode for this agent                      |

The **body** of the file (after `---`) becomes the agent's system prompt.

### Discovery order

1. **Default agent** — always available, no system prompt, inherits parent model
2. **Built-in agents** — from `agents/*.md` in the extension directory
3. **User agents** — from `~/.pi/agent/leaders/*.md`

Name collisions: user > built-in > default.

## Session modes

### Ephemeral (default)

No saved session. The child runs with `--no-session`. Best for one-shot tasks where only the answer matters.

Use cases: codebase exploration, API research, documentation reading, validation reviews, quick inspection, summarization, direct Q&A, isolated second opinions.

### Persistent

Saves a session file to `~/.pi/agent/sessions/leaders/`. The child runs with `--session <file>`. Best when the conversation might need follow-up, continuity, or audit.

Use cases: important planning threads, iterative review across multiple passes, debugging how a conclusion was reached.

### Fork

Creates a real branched session from the parent's current conversation tree. Uses `SessionManager.open(parentFile).createBranchedSession(leafId)`. The child inherits full parent context — all prior messages, tool calls, and results.

Use cases: "continue this refactor with what we discussed," "review the plan we just made," "inspect the code we were talking about."

**Fork fails gracefully** if the parent has no session file (e.g., running with `--no-session`) or no entries — returns an error result suggesting persistent or ephemeral mode instead.

## Structured results

Every foreground run returns a `LeaderSingleResult`:

```ts
interface LeaderSingleResult {
  agent: string; // "default", "scout", "reviewer", etc.
  agentSource: string; // "builtin", "user", "project", "default"
  task: string; // Original task text
  exitCode: number; // Child process exit code (0 = success)
  signal: NodeJS.Signals | null; // SIGTERM if aborted
  mode: LeaderSessionMode; // "ephemeral" | "persistent" | "fork"
  sessionFile?: string; // Path if persistent/fork
  model?: string; // Model the child actually used
  stopReason?: string; // "stop" | "error" | "aborted" | "length" | "toolUse"
  errorMessage?: string; // LLM error message if any
  usage: LeaderUsageStats; // Token counts, cost, turns
  displayItems: LeaderDisplayItem[]; // Structured output trace
  finalOutput: string; // Last assistant text
  stderr: string; // Child stderr output
}
```

### Usage stats format

```
3 turns ↑12.5k ↓2.1k R5k W800 $0.0234 ctx:45k claude-sonnet-4-5
```

- turns: number of assistant responses
- ↑input / ↓output: token counts
- R cache-read / W cache-write: cache token counts
- $cost: total cost in USD
- ctx: context window tokens
- model: which model ran

## Security boundaries

- **`--no-extensions`**: children never load extensions (prevents recursive leader calls)
- **`PI_LEADERS_CHILD=1`**: environment marker for future guard use
- **`--tools <allowlist>`**: children only get the tools specified in the agent profile
- **Agent profiles**: `systemPromptMode: "replace"` strips Pi's base prompt for isolation
- **Fork context**: children get full parent conversation but cannot call the `leader` tool (no extensions)
- **Project-local agents**: not currently scanned (future: `agentScope` parameter with confirmation)

## TUI Widget

The leaders extension renders a compact status bar above the input editor showing active and recently-completed subagents.

### How it works

1. A global `LeaderTracker` instance tracks the lifecycle of every foreground leader run
2. When a leader is spawned, `tracker.add()` creates a "spawning" entry
3. When the child process starts, `tracker.markRunning()` transitions it
4. On completion/failure/cancellation, the tracker transitions to the terminal state
5. The tracker's `onUpdate` callback triggers `updateWidget()`, which reads all entries, renders them with theme colors, and calls `ctx.ui.setWidget(WIDGET_KEY, lines, { placement: "aboveEditor" })`
6. On `turn_end` and `agent_end`, completed entries are pruned so the widget disappears when no longer relevant

### Widget rendering

Each entry is rendered as:

```
● scout Analyze the auth module for... ephemeral
```

Where:

- `●` = status icon (◌ spawning, ● running, ✓ completed, ✗ failed, ⊘ cancelled)
- `scout` = agent name (muted color)
- Task text (truncated to 60 chars)
- `ephemeral` = session mode (dim color)

Status icons use theme-aware colors:

- spawning → dim, running → accent, completed → success, failed → error, cancelled → warning

### Cleanup strategy

- Completed/failed/cancelled entries are pruned on `turn_end` and `agent_end`
- All entries are cleared on `session_start`
- The widget is removed (set to `undefined`) when no entries remain

## What's not yet implemented

These are ideas for future iterations:

- **Interactive widget**: Arrow-key cycling through entries, Enter to view details
- **Async run polling**: Show background leaders in the widget with status polling
- **Expand/collapse full output**: Click or key to expand a leader's full result in a TUI overlay
- **Parallel leaders**: run multiple leaders concurrently with `tasks: [...]`
- **Chain execution**: sequential `scout → planner → worker` with `{previous}` template substitution
- **Session continuation**: `/leader-cont <id> <task>` to re-attach to a persistent session
- **Intercom**: child-to-parent communication for mid-task questions
- **Context filtering**: strip leader tool calls from forked sessions
- **Project-local agents**: `.pi/leaders/agents/*.md` with confirmation dialog
- **Worktrees**: git worktree isolation for parallel file-editing leaders
