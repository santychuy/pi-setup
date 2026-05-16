# Leaders Learning Process

> **This document is superseded.** The original learning notes are preserved below for historical context. For current architecture and implementation details, see [architecture.md](architecture.md). For session modes and expected results, see [session-modes-plan.md](session-modes-plan.md).

## Original Learning Notes (MVP era)

### Purpose

`leaders` started as a minimal experiment for understanding subagent delegation in Pi. The first version was intentionally small to learn the mechanics before adding background mode, named specialists, widgets, continuation, or parallelism.

### Mental model

A leader is a child Pi process:

```
Parent Pi session
  └─ leaders extension
      └─ spawn("pi", ["--mode", "json", "-p", ...])
          └─ child Pi session
```

The parent launches a Pi CLI process, gives it a task, reads its JSON output, and returns the result.

### What we learned

1. **JSON mode works well** — Pi's `--mode json` emits `message_end`, `message_update`, `tool_result_end`, and `tool_execution_*` events as newline-delimited JSON. Parsing these gives much richer data than just extracting text deltas.

2. **Session files are just JSONL trees** — Pi sessions support branching via `id`/`parentId`. `SessionManager.open(file).createBranchedSession(leafId)` creates a child session that inherits the full parent context. This is how `fork` mode works.

3. **`--append-system-prompt` with temp files** — Agent system prompts are written to temp `.md` files and passed to the child via `--append-system-prompt`. The child's Pi instance reads the file and appends it to (or replaces) its base prompt. Temp files are cleaned up after the child exits.

4. **`--no-extensions` is essential** — Without it, child processes would load the leaders extension and could recursively spawn leaders. The `PI_LEADERS_CHILD=1` env var is a secondary guard for the future.

5. **Detached processes for async** — `spawn(..., { detached: true })` + `proc.unref()` lets the parent continue while the child runs. Results are tracked via filesystem artifacts (`status.json` + `output.log`).

6. **Agent profiles are simpler than expected** — A Markdown file with YAML frontmatter is enough. Pi's SDK provides `parseFrontmatter()` for free. The pattern is proven by pi-subagents and the built-in subagent example.

### What's next

See the "What's not yet implemented" section in [architecture.md](architecture.md) for planned features.
