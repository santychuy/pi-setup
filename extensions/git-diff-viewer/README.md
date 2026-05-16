# pi-git-diff-viewer

Private Pi extension for Pierre-style inline diffs and Zed visual diff review.

## Features

- Re-renders `edit` and `write` tool results as compact colored diffs.
- Tracks files changed during the last agent run.
- Adds `/diff` commands for inline review and Zed review.
- Adds `show_git_diff` for agent-triggered diff summaries or Zed opening.
- Opens Zed visual diffs with `zed --diff`.

## Usage

```txt
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

`/diff open` defaults to Zed visual diff mode, not a plain file open.

## Zed requirement

Install the Zed CLI from Zed's command palette:

```txt
cli: install
```

The extension invokes:

```bash
zed --diff <old-snapshot> <new-file-or-snapshot>
```

## Privacy

No network calls are made at runtime. File contents are used locally for Pi rendering, temp snapshots, Git, and Zed.
