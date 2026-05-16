# pi-bash-block

Private Pi extension to toggle hard blocking of the built-in `bash` tool.

## Behavior

- Bash starts allowed.
- `/bash-block` toggles between allowed and blocked.
- When blocked, only agent `bash` tool calls are rejected.
- Other tools are untouched.
- User `!` / `!!` shell commands are not blocked.

## Command

- `/bash-block` — toggle bash tool blocking for the current extension runtime.

## Notes

State is intentionally in-memory and minimal. Reloading Pi or starting a new session resets bash to allowed.
