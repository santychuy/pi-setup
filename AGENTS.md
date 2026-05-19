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

## Evidence-First Answering Policy

When you do not have high confidence, do not have exact facts, or the user asks for up-to-date/external information:

- **Do not guess.**
- **Use `web_search` by default** to find current, verifiable sources.
- If the user provides a direct URL, use **`fetch_content`** instead of broad search.
- Cite or mention source domains in your response summary.

### Uncertainty handling

If you cannot confirm exact information:

1. State clearly what is unknown.
2. Run web research (`web_search`) with 2–4 varied queries.
3. Return the best-supported findings and clearly note remaining uncertainty.

## Extension Conventions

- Each extension is a directory under `extensions/` with an `index.ts` entry point
- Extensions export a default function receiving `ExtensionAPI`
- Extensions use `@earendil-works/pi-coding-agent` for types (devDependency)
- Pi loads extensions via `jiti` — no build step needed, TypeScript works directly

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

## CodeGraph

This project has a CodeGraph MCP server configured.

If `.codegraph/` doesn't exist, ask the user: _"I notice this project doesn't have CodeGraph initialized. Want me to run `codegraph init -i` to build the index?"_
