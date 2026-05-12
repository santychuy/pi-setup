---
name: ship
description: "Analyze git changes and create well-structured grouped commits following conventional commits, then push. Use when the user wants to commit and push their work, says 'ship it', 'commit this', 'push changes', or wants to organize their git history into clean, logical commits instead of dumping everything in one commit."
---

# Ship: Structured Commit & Push

Turn a batch of file changes into a clean, logical git history using conventional commits, then push.

## When This Matters

A single catch-all commit like "add feature X" that touches config, types, utils, and UI in one shot hides intent. Future readers (including you) can't tell what changed where or why. This skill insists on grouping related changes into focused commits so the history tells a story.

## Workflow

### 1. Analyze the working tree

Run the following to understand the full picture:

```bash
git status --short
git diff --stat           # unstaged changes
git diff --cached --stat  # staged changes
```

If there are no changes at all, tell the user and stop.

### 2. Deep-dive into the diffs

For each changed file, read the actual diff content:

```bash
git diff          # unstaged diffs
git diff --cached # staged diffs
```

Read the diffs carefully. Understand what each hunk does, which module/layer/feature it belongs to, and how changes relate to each other. This is the most important step — the quality of grouping depends on actually understanding the changes, not just file names.

### 3. Propose a commit plan

Group the changes into an ordered list of commits. Present the plan to the user before making any commits using this format:

```
📦 Commit Plan

1. feat(scope): short description
   - path/to/file1.ts: what changed
   - path/to/file2.ts: what changed

2. refactor(scope): short description
   - path/to/file3.ts: what changed

3. chore: short description
   - path/to/config.ts: what changed
```

**Grouping logic:**

- Changes that form a single logical unit go together (e.g., a new feature's types, implementation, and tests).
- Changes to different concerns get separate commits (e.g., a bug fix mixed in with a refactor gets its own commit).
- Order matters: foundational changes (types, interfaces, config) before implementations that depend on them.
- If there are very few changes (1–3 files that are all related), a single commit is fine — don't over-split.

**Conventional commit format:**

```
<type>(<scope>): <subject>

<body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`, `perf`, `build`, `ci`

- `scope` is optional but encouraged — the module or layer affected
- `subject` is imperative mood, lowercase, no period, ≤72 chars
- `body` is optional — use it when the "why" isn't obvious from the subject alone

### 4. Execute the plan

After the user approves (or adjusts) the plan:

For each commit group:

1. Stage only the files for that commit: `git add <files>`
2. Create the commit with the conventional commit message
3. Show the commit hash and summary

If the user wants changes to the plan — different grouping, different messages, add/remove commits — adjust and re-confirm before proceeding.

### 5. Push

Once all commits are created:

```bash
git push
```

Report the result. If there's a remote conflict, surface it clearly and suggest resolution steps.

## Edge Cases

- **Mixed staged and unstaged changes**: Staged changes belong to whatever was already staged. Include them in your analysis but respect the staging area — if the user already staged specific files for a reason, account for that.
- **Untracked files**: Include new files in your analysis. Ask the user whether any should be added or if some should go to `.gitignore`.
- **No changes**: Stop and tell the user there's nothing to commit.
- **Large number of changes**: If there are 10+ files with changes, lean towards more granular commits (3–6) rather than fewer, to keep each commit focused and reviewable.
- **Single meaningful change**: If all changes are clearly one logical unit, one commit is perfectly fine. Don't force unnecessary splitting.

## What NOT to Do

- Don't create one monolithic commit with dozens of files
- Don't push without showing the commit plan first
- Don't skip reading the actual diffs — file names alone don't tell the full story
- Don't use vague commit messages like "updates" or "changes"
- Don't force-push unless the user explicitly asks
