# Leaders learning process

This document tracks how the `leaders` extension works and how we plan to learn from it.

## Purpose

`leaders` is a private experiment for understanding subagent delegation in Pi. The first version does not try to compete with full systems like `pi-subagents`. It exists to make the core flow obvious and hackable.

## Mental model

A leader is a child Pi process.

```text
Parent Pi session
  └─ leaders extension
      └─ spawn("pi", ["--mode", "json", "-p", ...])
          └─ child Pi session
```

The parent does not create a special in-memory agent. It launches another Pi CLI process, gives it a task, reads its JSON output, and returns the result.

## Foreground MVP flow

```text
parent calls leader tool or /leader command
  ↓
leaders extension chooses ephemeral or persistent mode
  ↓
if persistent, it creates a session file
  ↓
leaders extension spawns child Pi
  ↓
child Pi emits JSON lines on stdout
  ↓
extension extracts assistant text deltas
  ↓
child exits
  ↓
extension returns the final text to parent
```

## Child command shape

Ephemeral mode launches children with no saved session:

```bash
pi --mode json -p \
  --no-session \
  --no-extensions \
  --tools read,bash,grep,find,ls \
  --model <current-provider>/<current-model> \
  "Task: <task>"
```

Persistent mode launches children with a saved session:

```bash
pi --mode json -p \
  --session ~/.pi/agent/sessions/leaders/<session>.jsonl \
  --no-extensions \
  --tools read,bash,grep,find,ls \
  --model <current-provider>/<current-model> \
  "Task: <task>"
```

## Why JSON mode matters

`--mode json` makes the child process emit structured events instead of terminal UI output. The extension can parse those events line by line and collect assistant text.

The MVP currently watches primarily for:

- `message_update` events with `assistantMessageEvent.type === "text_delta"`
- final-ish `message` content when available

This can be expanded as we learn the exact event shapes we care about.

## Why sessions matter

Leader runs can be designed around two session modes:

- **ephemeral**: no saved child session; useful for direct one-shot work
- **persistent**: saved child session; useful when we may inspect or continue the leader later

The recommended default is ephemeral because many delegated tasks only need an answer and do not need long-term conversation state.

Persistent sessions are still important for future workflows:

- `/leader-cont <id> <task>`
- named session tracking
- resume from previous leader session
- child session inspection

Important distinction:

```text
Continuing a leader later does not require the same OS process.
It can spawn a new Pi process with the old session file.
```

See [`session-modes-plan.md`](session-modes-plan.md) for the detailed implementation plan.

## Current safety boundaries

The MVP intentionally limits behavior:

- Foreground only: parent waits for result.
- `--no-extensions`: child does not inherit extensions.
- Small tool allowlist: `read,bash,grep,find,ls`.
- `PI_LEADERS_CHILD=1`: marks child processes for future guards.
- Abort signal handling: interruption sends `SIGTERM` to the child.

## What to learn next

Suggested sequence:

1. Validate basic foreground child spawning.
2. Inspect real JSON event shapes from child runs.
3. Improve final-output extraction if needed.
4. Add simple leader profiles, such as `reviewer`, `planner`, and `scout`.
5. Add foreground parallel runs.
6. Add background mode and result follow-ups.
7. Add widgets for running leaders.
8. Add session continuation.
9. Consider forked parent context.

## Future architecture ideas

Potential future files if the extension grows:

```text
extensions/leaders/
  index.ts
  src/
    spawn.ts       # child process and args
    events.ts      # JSON event parsing
    sessions.ts    # leader session registry
    profiles.ts    # named leader definitions
    render.ts      # widgets/result rendering
```

For now, everything stays in `index.ts` to keep the first learning version easy to read.
