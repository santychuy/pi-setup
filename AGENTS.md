# Pi Setup

This is a personal Pi coding agent setup repository. It is structured as an installable pi-package for portability across machines and sharing with others.

Use bun as package manager, instead of npm.
Every new package to install should be using the `-E` flag for installing the exact version, without declaring the fixed version.

When implementing or modifying JavaScript or TypeScript files, always load the `modern-javascript-patterns` and `typescript-advanced-types` skills before making code changes.

## How Pi Discovers This Repo

Two paths:

1. **Project-local**: When working in this repo, Pi auto-detects via `.pi/` directory symlinks
2. **Installed package**: `pi install git:https://github.com/santychuy/pi-setup` reads the `pi` key in `package.json`

## Pi Package Manifest

The root `package.json` contains a `pi` key that tells pi where to find extensions, skills, themes, and prompts:

```json
{
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

Pi auto-discovers content from these directories. The `pi-package` keyword makes it findable in package registries.

## Pi Docs

Check the source code of the package to analyze the documentation available.

## Extension Conventions

- Each extension is a directory under `extensions/` with an `index.ts` entry point
- Extensions export a default function receiving `ExtensionAPI`
- Extensions use `@earendil-works/pi-coding-agent` for types (devDependency)
- Pi loads extensions via `jiti` — no build step needed, TypeScript works directly

### Extension Template

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });
}
```

## Skill Conventions

- Skills are Markdown files in `skills/`
- Each skill file should start with a `# Skill: Name` header
- Skills describe workflows or capabilities for agents

## Theme Conventions

- Themes are JSON files in `themes/`
- Theme files define color schemes and UI styles for pi

## Prompt Conventions

- Prompts are Markdown files in `prompts/`
- Supports `{{placeholder}}` syntax for parameterization
- Templates are loaded by pi for reuse across sessions

## Install

```bash
pi install git:https://github.com/santychuy/pi-setup
```

## Development Commands

- `bun run lint` — Run oxlint
- `bun run format` — Run oxfmt (write mode)
- `bun run check` — Lint + format check + TypeScript type check
- `bun run install:local <target-project>` — Copy Pi resources into another project's `.pi/`
- `bun run link:local <target-project>` — Symlink Pi resources into another project's `.pi/`

<!-- CODEGRAPH_START -->

## CodeGraph

This project has a CodeGraph MCP server (`codegraph_*` tools) configured. CodeGraph is a tree-sitter-parsed knowledge graph of every symbol, edge, and file. Reads are sub-millisecond and return structural information grep cannot.

### When to prefer codegraph over native search

Use codegraph for **structural** questions — what calls what, what would break, where is X defined, what is X's signature. Use native grep/read only for **literal text** queries (string contents, comments, log messages) or after you already have a specific file open.

| Question                                      | Tool                |
| --------------------------------------------- | ------------------- |
| "Where is X defined?" / "Find symbol named X" | `codegraph_search`  |
| "What calls function Y?"                      | `codegraph_callers` |
| "What does Y call?"                           | `codegraph_callees` |
| "What would break if I changed Z?"            | `codegraph_impact`  |
| "Show me Y's signature / source / docstring"  | `codegraph_node`    |
| "Give me focused context for a task/area"     | `codegraph_context` |
| "Survey an unfamiliar module/topic"           | `codegraph_explore` |
| "What files exist under path/"                | `codegraph_files`   |
| "Is the index healthy?"                       | `codegraph_status`  |

### Rules of thumb

- **Trust codegraph results.** They come from a full AST parse. Do NOT re-verify them with grep — that's slower, less accurate, and wastes context.
- **Don't grep first** when looking up a symbol by name. `codegraph_search` is faster and returns kind + location + signature in one call.
- **Don't chain `codegraph_search` + `codegraph_node`** when you just want context — `codegraph_context` is one call.
- **`codegraph_explore` is the heavy hitter** for unfamiliar areas — it returns full source from all relevant files in one call, but is token-heavy. If your harness supports parallel subagents (e.g., leaders tool), spawn one for explore-class questions to keep main session context clean.
- **Index lag**: the file watcher debounces ~500ms behind writes; don't re-query immediately after editing a file in the same turn.

### If `.codegraph/` doesn't exist

The MCP server returns "not initialized." Ask the user: _"I notice this project doesn't have CodeGraph initialized. Want me to run `codegraph init -i` to build the index?"_

<!-- CODEGRAPH_END -->
