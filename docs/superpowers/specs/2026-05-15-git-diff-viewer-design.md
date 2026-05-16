# Git Diff Viewer Extension Design

Date: 2026-05-15

## Goal

Create a private Pi extension that gives the user rich visual feedback for file changes made during agent work and an easy path to inspect those changes in Zed.

The extension will provide:

- Pierre-style inline rendering for Pi `edit` and `write` tool results.
- A `/diff` command for viewing last-agent-run and Git working-tree changes.
- An agent-callable `show_git_diff` tool.
- Zed integration that opens visual diffs with `zed --diff`.

## Non-goals

- Publishing to npm.
- Replacing Git or Zed workflows outside Pi.
- Supporting editors other than Zed in the first version.
- Implementing accept/reject hunk actions in v1.

## Extension location

The extension will live at:

```text
extensions/git-diff-viewer/
```

It is private/local for now. Its package metadata should avoid public publishing fields.

## Architecture

Use a structured extension layout:

```text
extensions/git-diff-viewer/
  index.ts
  package.json
  README.md
  src/
    commands.ts
    git.ts
    pierre.ts
    render.ts
    snapshots.ts
    state.ts
    tools.ts
    zed.ts
```

### Module responsibilities

- `index.ts`: wires all extension features into Pi.
- `tools.ts`: registers wrapped `edit` and `write` tools and the `show_git_diff` custom tool.
- `commands.ts`: registers `/diff` and handles user-facing command flows.
- `git.ts`: parses Git status, reads `HEAD` content, and detects file states.
- `snapshots.ts`: captures before/after file content and creates temp files for Zed.
- `pierre.ts`: creates Pierre diff metadata/highlight payloads using `@pierre/diffs`.
- `render.ts`: renders compact Pierre-style TUI diff blocks.
- `state.ts`: tracks baseline Git status, last-agent-run files, and tool-touched snapshots.
- `zed.ts`: builds and executes `zed --diff` commands.

## Pi APIs used

- `pi.registerTool()` for:
  - wrapped `edit`
  - wrapped `write`
  - `show_git_diff`
- `pi.registerCommand("diff", ...)` for user command access.
- Lifecycle events:
  - `agent_start`: capture Git baseline for the turn.
  - `tool_result`: record touched files and snapshots.
  - `agent_end`: compute last-agent-run changed files and notify.
  - `session_shutdown`: clean temporary resources when practical.
- `ctx.ui.notify`, `ctx.ui.select`, and possibly `ctx.ui.custom` for interactive UI.
- `pi.exec()` for Git and Zed commands.

## Inline edit/write rendering

The extension will re-register Pi's built-in `edit` and `write` tools, delegate actual file mutation to Pi's original tool definitions, then attach diff payloads to the result details.

Flow:

1. Capture file content before the tool runs.
2. Execute Pi's original tool implementation.
3. If the original tool failed, return its result unchanged.
4. Capture file content after the tool runs.
5. Generate diff metadata with `@pierre/diffs`.
6. Render a compact Pierre-style inline block in the chat.
7. If Pierre rendering fails, fall back to Pi's original rendering.

The implementation may need a small isolated compatibility patch to remove Pi's default tool-result background for `edit` and `write`, following the reference extension. If needed, this patch must be isolated and guarded so future Pi UI changes are easy to address.

## Git and last-agent-run behavior

The extension tracks two scopes:

1. **Last agent run**: files changed or touched by the most recent agent turn.
2. **Git working tree**: all changed files reported by Git.

Default behavior should favor focus:

- `/diff` shows last-agent-run changes.
- `/diff all` shows all Git working-tree changes.

Git status should include:

- modified files
- added files
- deleted files
- renamed files, using the destination path
- untracked files
- staged and unstaged changes

## `/diff` command

Supported command forms:

```text
/diff
/diff all
/diff staged
/diff file <path>
/diff open
/diff open <path>
/diff open-all
/diff list
/diff clear
```

Behavior:

- `/diff`: interactive view of last-agent-run changes.
- `/diff all`: interactive view of all Git working-tree changes.
- `/diff staged`: show staged changes.
- `/diff file <path>`: show one file diff inline in Pi.
- `/diff open`: choose a file, then open visual diff in Zed.
- `/diff open <path>`: open that path in Zed visual diff.
- `/diff open-all`: open all selected/default changes in Zed as multiple diff pairs.
- `/diff list`: show tracked last-agent-run files.
- `/diff clear`: clear last-agent-run state and reset baseline.

## Agent tool: `show_git_diff`

The custom tool lets the agent explicitly show or open diffs without relying on a slash command.

Initial parameters:

- `scope`: `last-run`, `all`, or `staged`.
- `path`: optional file path.
- `mode`: `inline`, `zed`, or `summary`.

The tool must be read-only except for temporary snapshot files used to open Zed diffs.

## Zed integration

Opening a diff defaults to Zed's visual diff mode:

```bash
zed --diff <old-snapshot> <new-file-or-snapshot>
```

Multiple files use repeated `--diff` arguments:

```bash
zed --diff old1 new1 --diff old2 new2
```

Snapshot strategy:

- Modified tracked file:
  - old = temp file from `git show HEAD:<path>` or captured before snapshot
  - new = current project file
- Untracked/new file:
  - old = empty temp file
  - new = current project file
- Deleted file:
  - old = temp file from `git show HEAD:<path>` or captured before snapshot
  - new = empty temp file
- Last-run-only snapshot:
  - old = captured before content
  - new = captured after content or current project file

Use `zed --diff` as the default. Opening the raw changed file may be added later as a secondary action, but is not the default.

## Dependencies

Runtime dependencies:

- `@pierre/diffs`
- likely `@pierre/theme` if needed for palette/highlight parity with the reference
- `typebox` for custom tool parameter schemas

Peer dependencies:

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui` if importing TUI helpers/components
- `@earendil-works/pi-ai` if using `StringEnum`

Use Bun with exact installs:

```bash
bun add -E <package>
```

## Error handling

- If not inside a Git repository, `/diff all` reports a friendly warning.
- If Zed is missing, show instructions to install the CLI with Zed's `cli: install` command.
- If `git show HEAD:<path>` fails, fall back to captured snapshots where available.
- If Pierre metadata or rendering fails, fall back to Pi's original tool renderer.
- If temp snapshot creation fails, keep inline Pi diff functional and report the Zed open failure.
- Limit large diff output to avoid flooding the TUI/context.

## Privacy and security

- The extension runs locally and does not make network calls at runtime.
- File contents are passed only to local Pi rendering, local temp snapshot files, Git, and Zed.
- Temporary snapshot files should be stored under the OS temp directory with a Pi-specific prefix.
- Snapshot cleanup should run on session shutdown where possible.

## Testing and validation

Manual validation should cover:

1. Inline diff renders after `edit`.
2. Inline diff renders after `write`.
3. Failed `edit`/`write` falls back safely.
4. `/diff` shows last-agent-run files.
5. `/diff all` shows Git working-tree files.
6. `/diff file <path>` renders one diff inline.
7. `/diff open <path>` opens Zed with `zed --diff`.
8. `/diff open-all` passes repeated `--diff` pairs.
9. Modified, new, deleted, renamed, and untracked files work.
10. Non-Git directories fail gracefully.

Repository gates:

```bash
bun install
bun run check
pi -e ./extensions/git-diff-viewer/index.ts
```

## Implementation notes

Start from the reference ideas, but adapt them to current package names and this repo's conventions:

- Use `@earendil-works/pi-coding-agent`, not older package names.
- Keep private package metadata minimal.
- Isolate any Pi-internal UI patch.
- Prefer small modules over a single large file because this extension has multiple moving parts.
