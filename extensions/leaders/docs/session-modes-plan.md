# Leaders session modes plan

Status: implemented in `extensions/leaders/index.ts`.

## Goal

Add explicit session behavior to `leaders` so a leader run can be either:

- **ephemeral**: one-shot delegation with no saved child conversation
- **persistent**: delegation with a saved child session file that can be inspected or reused later

The recommended default is **ephemeral**. Persistence should be intentional.

## Why this matters

Not every subagent needs memory. Most delegated tasks are one-shot, and some leader tasks are quick and disposable:

- codebase exploration
- API research
- documentation reading
- validation reviews
- inspect a narrow file or function
- summarize a short diff
- answer a direct implementation question
- provide a quick second opinion

For those tasks, keeping a permanent `.jsonl` session adds filesystem clutter without much value.

Other leader tasks benefit from memory, continuity, and traceability:

- follow-up sessions
- important planning threads
- long-running migration or refactor discussions
- specialized review across multiple iterations
- future continuation with `/leader-cont`
- debugging how the leader reached a conclusion
- audit trail for important decisions

Those tasks should opt into a saved session.

## Proposed modes

### `ephemeral`

Ephemeral leaders do not save a Pi session file.

Child command shape:

```bash
pi --mode json -p \
  --no-session \
  --no-extensions \
  --tools read,bash,grep,find,ls \
  --model <current-provider>/<current-model> \
  "Task: <task>"
```

Expected result header:

```text
Leader completed.
Mode: ephemeral

<output>
```

Use this for direct, disposable tasks where the parent only needs the answer: codebase exploration, API research, documentation reading, validation reviews, quick inspection, summarization, direct Q&A, and isolated second opinions.

### `persistent`

Persistent leaders save a child session file under:

```text
~/.pi/agent/sessions/leaders/
```

Child command shape:

```bash
pi --mode json -p \
  --session ~/.pi/agent/sessions/leaders/<session>.jsonl \
  --no-extensions \
  --tools read,bash,grep,find,ls \
  --model <current-provider>/<current-model> \
  "Task: <task>"
```

Expected result header:

```text
Leader completed.
Mode: persistent
Session: ~/.pi/agent/sessions/leaders/<session>.jsonl

<output>
```

Use this when the leader's conversation may matter later: follow-up sessions, important multi-step planning, iterative review, specialist continuity, future continuation, or audit/debugging.

## Public API

### Tool schema

Add an optional `mode` parameter:

```ts
type LeaderSessionMode = "ephemeral" | "persistent";
```

Tool call examples:

```json
{
  "task": "Check the docs for this library and summarize the current API.",
  "mode": "ephemeral"
}
```

```json
{
  "task": "Review this architecture and keep the session for future continuation.",
  "mode": "persistent"
}
```

Default:

```text
ephemeral
```

### Slash command

Default ephemeral:

```text
/leader check the docs for hono routing
```

Explicit persistent:

```text
/leader --persistent review this implementation plan
```

Optional explicit ephemeral:

```text
/leader --ephemeral check the docs for hono routing
```

## Internal type changes

Current result shape:

```ts
type LeaderRunResult = {
  output: string;
  sessionFile: string;
  exitCode: number | null;
};
```

Proposed result shape:

```ts
type LeaderSessionMode = "ephemeral" | "persistent";

type LeaderRunResult = {
  output: string;
  mode: LeaderSessionMode;
  sessionFile?: string;
  exitCode: number | null;
};
```

`sessionFile` only exists in persistent mode.

## Internal flow changes

### Current flow

```text
runLeader(task)
  ↓
makeSessionFile()
  ↓
build args with --session <file>
  ↓
spawn child
```

### Proposed flow

```text
runLeader(task, mode)
  ↓
if persistent:
  makeSessionFile()
  build args with --session <file>
else:
  build args with --no-session
  ↓
spawn child
```

## Implementation plan

1. Add `LeaderSessionMode` type.
2. Add `DEFAULT_SESSION_MODE = "ephemeral"`.
3. Update `LeaderRunResult` so `sessionFile` is optional and `mode` is required.
4. Update `buildLeaderArgs` to receive `{ task, ctx, mode, sessionFile? }` or equivalent options.
5. Update `runLeader` to accept `mode`.
6. In `runLeader`, only call `makeSessionFile()` when mode is `persistent`.
7. For ephemeral mode, pass `--no-session` instead of `--session`.
8. Add `mode` to the `leader` tool schema.
9. Update tool execution to default missing mode to `ephemeral`.
10. Add slash flag parser for:
    - `--persistent`
    - `--ephemeral`
11. Update result formatting to show mode and only show session path when present.
12. Update README usage and examples.
13. Update `learning-process.md` to describe both modes.
14. Run `bun run check`.

## Error handling and validation

- Invalid tool `mode` should be prevented by the schema.
- Slash command conflicting flags should fail early:

```text
/leader --persistent --ephemeral task
```

Recommended response:

```text
Use only one mode flag: --ephemeral or --persistent
```

- Slash command with no task should keep current behavior:

```text
Usage: /leader [--ephemeral|--persistent] <task>
```

## Future extensions enabled by this design

Persistent mode prepares the ground for:

- `/leader-list`
- `/leader-cont <id> <task>`
- named persistent leaders
- session metadata registry
- background persistent leaders

Ephemeral mode prepares the ground for:

- cheap one-shot documentation lookups
- disposable reviewers
- parallel quick checks without session clutter

## Acceptance criteria

- `leader` tool defaults to ephemeral mode.
- `/leader <task>` defaults to ephemeral mode.
- `mode: "persistent"` creates and reports a session file.
- `mode: "ephemeral"` uses `--no-session` and does not report a session file.
- `/leader --persistent <task>` creates and reports a session file.
- `/leader --ephemeral <task>` does not report a session file.
- Result text clearly shows the mode.
- `bun run check` passes.
