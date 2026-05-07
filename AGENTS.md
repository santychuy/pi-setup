# Pi Setup

This is a personal Pi coding agent setup repository. It is structured as an installable pi-package for portability across machines and sharing with others.

Use bun as package manager, instead of npm.
Every new package to install should be using the `-E` flag for installing the exact version.

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
