# pi-leaders

Private Pi extension for foreground leader subagents.

Leaders are focused child Pi processes that the parent session can delegate work to. This first version is intentionally small so we can learn the mechanics before adding background mode, named specialists, widgets, continuation, or parallelism.

## Usage

### Tool

Ask Pi naturally, for example:

```text
Use a leader to inspect this repository and summarize the extension structure.
```

The parent agent can call the `leader` tool with:

```json
{ "task": "Inspect this repository and summarize the extension structure." }
```

By default, leader runs are **ephemeral** and do not save a child session. This is right for most delegated tasks because they are one-shot and only the final answer matters. Request a **persistent** session when the leader conversation should be kept for follow-up or important continuity:

```json
{
  "task": "Review this plan and keep context for a later follow-up.",
  "mode": "persistent"
}
```

### Slash command

```text
/leader inspect this repository and summarize the extension structure
```

Explicit session modes:

```text
/leader --ephemeral check the docs for this library
/leader --persistent review this implementation plan
```

## Choosing a session mode

### Use ephemeral by default

Ephemeral mode uses `--no-session`. It is best for one-shot delegation where only the final answer matters.

Examples:

- codebase exploration: “Find where the auth middleware is wired.”
- API research: “Check how the GitHub CLI exposes release metadata.”
- documentation reading: “Read the current Hono docs for route groups.”
- validation reviews: “Review this small change for obvious bugs.”
- quick inspection: “Look at this config and tell me what it does.”
- summarization: “Summarize the extension structure.”
- direct Q&A: “Does this TypeScript type preserve literals?”
- isolated second opinion: “Challenge this approach once.”

### Use persistent intentionally

Persistent mode uses `--session` and saves the child conversation under `~/.pi/agent/sessions/leaders/`. Use it when the leader thread itself is important and may need to continue.

Examples:

- follow-up sessions: “Keep this leader around; we’ll continue later.”
- important planning: “Plan this migration and preserve the reasoning.”
- iterative review: “Act as reviewer for this feature across multiple passes.”
- specialist continuity: “Stay as the architecture leader for this refactor.”
- audit/debugging: “Save the session so I can inspect how the conclusion was reached.”

## What happens

1. The extension chooses a session mode.
2. It spawns a child Pi process in JSON mode.
3. The child runs with extensions disabled and a small tool allowlist.
4. The extension parses streamed JSON output.
5. The parent receives the leader result after the child exits.

Ephemeral child command shape:

```bash
pi --mode json -p \
  --no-session \
  --no-extensions \
  --tools read,bash,grep,find,ls \
  --model <current-provider>/<current-model> \
  "Task: <task>"
```

Persistent child command shape:

```bash
pi --mode json -p \
  --session ~/.pi/agent/sessions/leaders/<session>.jsonl \
  --no-extensions \
  --tools read,bash,grep,find,ls \
  --model <current-provider>/<current-model> \
  "Task: <task>"
```

## Current scope

Included:

- Foreground delegation
- `leader` tool
- `/leader` command
- Session modes: `ephemeral` by default, `persistent` when explicitly requested
- Basic JSON stream parsing
- Basic output truncation
- Abort signal kills the child process

Not included yet:

- Background mode
- Widgets
- Named leader profiles
- Parallel leader runs
- Session continuation
- Forked parent context
- Intercom-style child-to-parent questions

## Security notes

This extension spawns a real `pi` process. The child receives only these builtin tools in the MVP:

```text
read,bash,grep,find,ls
```

Child extensions are disabled with `--no-extensions` to avoid accidental recursion or surprising inherited behavior.

## Development notes

See [`docs/learning-process.md`](docs/learning-process.md) for the learning plan and internal architecture notes.
