# Leaders — Session Modes & Expected Results

This document explains the four session modes, how each one works internally, and what results look like for each.

## Session modes at a glance

| Mode             | CLI flag                    | Session behavior                                                                             | When to use                                                   |
| ---------------- | --------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `ephemeral`      | `--no-session`              | No file saved. Child runs and exits.                                                         | One-shot tasks: exploration, reviews, Q&A                     |
| `persistent`     | `--session <new-file>`      | New empty session file created.                                                              | Follow-up, continuity, audit trail                            |
| `fork`           | `--session <branched-file>` | Branch from parent's current conversation, saved.                                            | Context-aware tasks: continue a discussion, review in context |
| `ephemeral-fork` | `--session <branched-file>` | Branch from parent, delete after run; async stores cleanup metadata and retries on recovery. | Context-aware one-shot tasks                                  |

Another way to view the modes:

|                     | No parent context | Parent context   |
| ------------------- | ----------------- | ---------------- |
| Not saved after run | `ephemeral`       | `ephemeral-fork` |
| Saved after run     | `persistent`      | `fork`           |

## Ephemeral mode

### How it works

```bash
pi --mode json -p \
  --no-session \
  --no-extensions \
  --tools read,bash,grep,find,ls \
  --append-system-prompt /tmp/pi-leader-xxx/prompt-scout.md \
  --model claude-haiku-4-5 \
  "Check how the auth middleware validates tokens"
```

No session file is created. The child process has no memory of previous runs. This is the default because most delegated tasks only need an answer.

### Expected result

```
Leader ✓ scout completed.
Mode: ephemeral

Usage: 2 turns ↑8.2k ↓1.4k R3k W200 $0.0042 claude-haiku-4-5

## Files Retrieved
1. `src/middleware/auth.ts` (lines 45-89) - Token validation logic
2. `src/utils/jwt.ts` (lines 12-34) - JWT decode helper

## Key Findings
The auth middleware validates tokens by:
1. Extracting Bearer token from Authorization header
2. Calling `verifyToken()` which uses jwt.decode() with the secret
3. Checking expiry and scope claims

No session file is saved.
```

### When to choose ephemeral

- "Find where the auth middleware is wired"
- "Check the docs for this library and summarize the current API"
- "Review this small change for obvious bugs"
- "Summarize the extension structure"
- "Does this TypeScript type preserve literals?"

## Persistent mode

### How it works

```bash
pi --mode json -p \
  --session ~/.pi/agent/sessions/leaders/leader-1715788800000-12345-abc.jsonl \
  --no-extensions \
  --tools read,bash,grep,find,ls \
  --append-system-prompt /tmp/pi-leader-xxx/prompt-reviewer.md \
  --model claude-sonnet-4-5 \
  "Review this architecture for scalability issues"
```

A new session file is created under `~/.pi/agent/sessions/leaders/`. The child's entire conversation is saved there. You can later re-attach or inspect it.

### Expected result

```
Leader ✓ reviewer completed.
Mode: persistent
Session: ~/.pi/agent/sessions/leaders/leader-1715788800000-12345-abc.jsonl

Usage: 4 turns ↑18.3k ↓3.7k R8k $0.0521 claude-sonnet-4-5

### [Critical] — Database connection not pooled
- **Location**: `src/db/connection.ts:23`
- **Problem**: Creates a new connection per request
- **Fix**: Use a connection pool with configurable max size

### [Important] — No circuit breaker on external API calls
- **Location**: `src/services/payment.ts:67`
- **Fix**: Add retry with exponential backoff and circuit breaker

✗ 2 issues found, 1 suggestion
```

### When to choose persistent

- "Keep this leader around for follow-up questions later"
- "Plan this migration and preserve the reasoning"
- "Act as reviewer across multiple passes"
- "Save the session so I can inspect how the conclusion was reached"

Future: `leader({ action: "continue", id: "abc", task: "now check error handling" })` will re-attach to a persistent session.

## Fork mode

### How it works

```
1. Get parent session file from ctx.sessionManager.getSessionFile()
2. Get parent leaf ID from ctx.sessionManager.getLeafId()
3. SessionManager.open(parentFile).createBranchedSession(leafId)
   → copies the entire conversation tree from root to leaf
   → creates a new .jsonl file with the branched path
4. Pass --session <branched-file> to the child

   The child starts with ALL parent context:
   - Every message the parent sent
   - Every tool call and result
   - Compaction summaries
   - Branch summaries
   But NO extensions (so it cannot recursively call leader)
```

### Expected result

```
Leader ✓ worker completed.
Mode: fork
Session: ~/.pi/agent/sessions/leaders/leader-fork-1715788800-12345-def.jsonl

Usage: 5 turns ↑32.1k ↓4.2k R12k W1k $0.0891 claude-sonnet-4-5

I've continued the refactor based on our earlier discussion. Here's what I changed:

## Files Changed
- `src/auth/middleware.ts` - Extracted token validation into a utility
- `src/utils/token.ts` - New file with verifyToken() and decodeToken()

The session file is saved for inspection.
```

## Ephemeral fork mode

`ephemeral-fork` uses the same branch creation as `fork`, so the child receives the full parent context. The difference is cleanup: after the child exits, fails, or is aborted, the parent deletes the branched child session file.

Expected behavior:

```
Leader ✓ reviewer completed.
Mode: ephemeral-fork

Usage: 2 turns ↑18.2k ↓1.1k R8k $0.0210 claude-sonnet-4-5

The plan is sound, but I would tighten the rollback path...
```

No `Session:` line is shown in the final result because the temporary branch is deleted before the result is returned.

For async runs, the temporary branch is deleted when the child closes or fails to start. The async status file stores cleanup metadata so deletion can be retried if the parent process is interrupted or deletion fails.

Cleanup metadata is retained until deletion succeeds. This means a terminal async run may remain on disk past the normal pruning window if its temporary fork cleanup is still pending.

### When to choose fork

- "Continue this refactor with the context we discussed"
- "Review the plan we just made, keeping our earlier decisions"
- "Implement what we agreed on in the last few messages"
- "Inspect the code we were just talking about"

### Fork failure cases

Fork returns an error result (not a crash) when:

| Condition                                                                            | Error message                                                                                                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Parent has no session file (`ctx.sessionManager.getSessionFile()` returns undefined) | "Cannot fork: parent session has no persisted file or no entries. Use persistent or ephemeral mode instead." |
| Parent has no entries (`getLeafId()` returns undefined)                              | Same as above                                                                                                |
| Session file doesn't exist or can't be read                                          | Same as above                                                                                                |

When fork creation fails, foreground `fork` and `ephemeral-fork` runs return a valid `LeaderSingleResult` with `exitCode: 1` and the error message as `finalOutput`. Async `fork` and `ephemeral-fork` write a failed `status.json` with the same result shape and do not spawn a child process.

## Async mode (background)

Async is not a session mode — it's an execution mode. You can combine it with any session mode. Async uses the same session resolution helper as foreground runs: ephemeral has no session, persistent creates a new saved session, fork creates a real persisted branched session from the parent context, and ephemeral-fork creates a real branched session that is cleaned up after the run.

Async `ephemeral-fork` cleanup happens in three places: immediately on child close/error, as recovery on the next `session_start` for stale/interrupted runs, and via manual `leader({ action: "cleanup" })` retry. Cleanup is retriable: if deleting the temporary session file fails, `status.json` keeps the `sessionFile` path and the run directory is not pruned until cleanup succeeds.

### How it works

```json
{ "task": "Analyze the full codebase architecture", "agent": "scout", "async": true }
```

Returns immediately:

```
Leader started in background.
ID: f47ac10b-58cc-4372-a567-0e02b2d3ef47
Agent: scout
Mode: ephemeral
Status: running

Check status with: leader({ action: "status", id: "f47ac10b..." })
```

### Checking status

```json
{ "action": "status", "id": "f47ac10b-58cc-4372-a567-0e02b2d3ef47" }
```

While running:

```
⏳ leader scout [f47ac10b] running
    Task: Analyze the full codebase architecture
    Mode: ephemeral
```

After completion:

```
✓ leader scout [f47ac10b] completed (45.2s)
    Task: Analyze the full codebase architecture
    Mode: ephemeral

    Turns: 3
    Model: claude-haiku-4-5

## Architecture
The codebase follows a layered architecture...
```

### Listing all async runs

```json
{ "action": "status" }
```

```
Async leader runs:

✓ f47ac10b scout completed — Analyze the full codebase architecture
⏳ 8b3d2a1e worker running — Implement the auth refactor
✗ 1c9e4f32 oracle failed — Check this plan for risks
```

### Where async data lives

```
~/.pi/agent/sessions/leaders/async/
  └── <run-id>/
      ├── status.json    → run metadata + result + optional ephemeral-fork cleanup metadata
      └── output.log     → raw child stdout/stderr
```

Runs older than 24 hours are automatically cleaned up when a new session starts, except terminal runs with pending `ephemeral-fork` cleanup. Those are retained until the temporary branch is deleted successfully.

## Slash command reference

```
/leader <task>                                → ephemeral, default agent
/leader --ephemeral <task>                    → ephemeral, default agent
/leader --persistent <task>                  → persistent, default agent
/leader --fork <task>                         → fork, default agent
/leader --ephemeral-fork <task>               → ephemeral-fork, default agent
/leader @scout <task>                         → ephemeral, scout agent
/leader --fork @worker continue this refactor → fork, worker agent
```

## Tool parameter reference

```json
// Run a leader (foreground)
{ "task": "Review this diff", "agent": "reviewer", "mode": "ephemeral" }

// Run in background
{ "task": "Analyze the codebase", "agent": "scout", "async": true }

// List available agents
{ "action": "list" }

// Check all async runs
{ "action": "status" }

// Check specific async run
{ "action": "status", "id": "abc-123" }

// Retry pending async ephemeral-fork cleanup
{ "action": "cleanup" }
```
