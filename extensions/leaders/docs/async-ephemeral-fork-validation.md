# Async Ephemeral-Fork Manual Validation

Use this runbook after implementation changes when manually validating async `ephemeral-fork` behavior. No automated tests are assumed here.

## Scenarios

1. Success cleanup
   - Run: `leader({ task: "Summarize current context", mode: "ephemeral-fork", async: true })`
   - Wait for completion and check status by ID.
   - Expected: terminal status; no session file exposed in the result; temporary branch deleted.

2. Startup/fork failure
   - Start from a parent without persisted session support if possible.
   - Run async `ephemeral-fork`.
   - Expected: failed status written; no child process spawned; clear fork error message.

3. Child error cleanup
   - Trigger a task or agent configuration that fails after spawn.
   - Expected: failed status; cleanup attempted; if successful, session metadata cleared.

4. Stale process recovery
   - Start async `ephemeral-fork`.
   - Interrupt the parent before the child close handler can run, or simulate a stale PID in status.
   - Start a new parent session.
   - Expected: stale run marked failed and cleanup retried.

5. Forced cleanup failure persistence
   - Make the temporary session file temporarily undeletable, or mock/simulate deletion failure.
   - Run cleanup sweep or `leader({ action: "cleanup" })`.
   - Expected: run directory remains; `sessionFile` remains; status shows cleanup pending.

6. Later retry success
   - Restore file deletability.
   - Start a new session or trigger `leader({ action: "cleanup" })`.
   - Expected: session file deleted; `sessionFile` cleared; old terminal run becomes eligible for pruning.

## Notes

- Pending cleanup means `cleanupSessionFile === true && sessionFile` is still present in `status.json`.
- Filesystem deletion behavior varies by OS; use simulation/mocking if making a file undeletable is unreliable.
