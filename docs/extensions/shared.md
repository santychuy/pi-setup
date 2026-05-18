# Shared Extension Utilities

This repository may use `extensions/shared/*` for small, reusable utilities shared by multiple Pi extensions.

## Why this folder exists

Some extension behavior crosses extension boundaries. The editor border color is one example: `modes` wants to show plan mode, while `footer-mode` wants to show manual bash input. If each extension independently mutates `editor.borderColor`, render order can cause one extension to overwrite another.

Shared utilities make these cross-cutting decisions explicit, tested in one place, and easier to reuse in future extensions.

## Current shared utilities

### `extensions/shared/editor-border-resolver.ts`

Provides the canonical editor border priority:

1. Bash input wins when text starts with `!` after leading whitespace.
2. Plan mode wins when bash input is not active.
3. Base/default border is the fallback.

The bash detector intentionally matches Pi core behavior:

```ts
text.trimStart().startsWith("!");
```

## Guidelines for future shared code

- Keep shared utilities pure when possible.
- Do not depend on extension runtime state unless necessary.
- Keep Pi UI side effects inside the owning extension, not the shared utility.
- Prefer narrow utilities over broad frameworks.
- Add shared code only when at least two extensions need the same rule or behavior.
- Document priority rules when utilities resolve conflicts between extensions.

## Editor border ownership

Extensions that install custom editors should use `resolveEditorBorder()` rather than hard-coding border priority. This avoids conflicts where one extension detects bash mode but another extension overwrites the border during render.
