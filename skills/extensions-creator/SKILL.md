---
name: extensions-creator
description: Guide creation, scaffolding, validation, and npm publishing preparation for Pi coding-agent extensions in this pi-setup monorepo. Use this whenever the user wants to create a new extension, package an extension, make an extension publishable, add extension files under extensions/, check npm availability for a pi-* package, or prepare an extension for release, even if they only describe the extension idea casually.
---

# Skill: Extensions Creator

Use this skill to create Pi extensions in this monorepo. The goal is to help the agent move from an extension idea to a maintainable implementation that can be loaded locally and, when requested, published as an npm Pi package.

This skill is scoped to this repository's monorepo workflow only. Do not use it to design a standalone external package unless the user explicitly asks to change the scope.

## Core principles

- Work inside `extensions/<extension-name>/`.
- Use Bun for package management. When adding packages, use exact versions with `bun add -E` or `bun add -d -E`.
- Adapt to the conversation. Extract known requirements first, then ask only important missing questions.
- Prefer the smallest maintainable scaffold that fits the request.
- Use the existing extension packages as the local source of style and publishing conventions.
- Treat npm publishing as a release workflow, not just a code task: package metadata, README, build output, local loading, and release gates all matter.

## Required discovery before implementation

Before scaffolding or editing extension files, inspect the relevant docs and local examples.

### Pi docs

Read the current Pi docs from the installed package source as needed:

- Always read extension basics:
  - `/Users/santychuy/Library/Application Support/fnm/node-versions/v24.15.0/installation/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- For install/publish/package behavior, read:
  - `/Users/santychuy/Library/Application Support/fnm/node-versions/v24.15.0/installation/lib/node_modules/@earendil-works/pi-coding-agent/docs/packages.md`
- For custom TUI/components/rendering, also read:
  - `docs/tui.md`
- For shortcuts/keybindings, also read:
  - `docs/keybindings.md`
- For providers/models, also read:
  - `docs/custom-provider.md`
  - `docs/models.md`

Also inspect relevant examples under:

`/Users/santychuy/Library/Application Support/fnm/node-versions/v24.15.0/installation/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/`

Pick examples based on the extension type: commands, tools, UI, providers, resources, state, or events.

### Local repo examples

Always inspect the local package pattern before creating a publishable extension:

- `extensions/codex-limit/package.json`
- `extensions/codex-limit/README.md`
- `extensions/codex-limit/index.ts`

Use other local extensions as references when relevant:

- `extensions/toast/` for structured/multi-file extension organization.
- `extensions/web-access/` for multi-file extensions using external APIs/config.
- `extensions/footer-mode/` for footer/UI behavior.
- `extensions/mermaid/`, `extensions/chime/` for simpler extension packages.

## Adaptive intake

Do not run a rigid questionnaire if the conversation already contains enough context. Infer what you can, then ask focused questions only for missing decisions that affect implementation.

Important decisions to resolve:

1. Extension name and one-line purpose.
2. Whether it is publishable or local/private.
3. Whether the scope is simple or complex.
4. Pi APIs likely needed:
   - lifecycle/events
   - commands
   - custom tools
   - UI/TUI/rendering
   - providers/models
   - dynamic resources
   - session state
5. Runtime dependencies and whether they are needed at install time.
6. Config files, environment variables, credentials, or external APIs.
7. Security/privacy implications.
8. Expected demo, test, or manual validation flow.

Ask one question at a time when the answer is not obvious.

## Simple vs complex path

Choose the path based on the request, not a hard checklist.

### Simple extension

Use the simple path when the extension has a small, single-purpose behavior, one obvious integration point, little or no state, and no significant security/privacy concerns.

For simple extensions:

- Clarify only the missing essentials.
- Scaffold directly after discovery.
- Keep the implementation in `index.ts` unless a helper module clearly improves readability.
- Still create `package.json` and `README.md`.

### Complex extension

Use the complex path when the request has multiple features, multiple Pi integration points, custom UI, external services, state, credentials, security/privacy impact, or unclear architecture.

For complex extensions:

- Discuss strategy and architecture before writing files.
- Present a short design with:
  - goal and non-goals
  - extension boundaries
  - Pi APIs used
  - file/module layout
  - data/config flow
  - error handling
  - test and validation plan
  - publishing impact
- Wait for user approval before implementation.
- Add `docs/development.md` when it will help future maintenance.

If unsure whether scope is simple or complex, default to a lightweight design discussion before writing code.

## Naming and directories

Extension directory:

`extensions/<extension-name>/`

Use kebab-case for `<extension-name>`.

Publishable npm package name:

`pi-<extension-name>`

Example:

- directory: `extensions/codex-limit`
- package: `pi-codex-limit`

For publishable extensions, check npm name availability before creating or finalizing package metadata. Use a command such as:

```bash
npm view pi-<extension-name> version
```

Interpretation:

- If the package exists, stop and ask the user for a new name.
- If npm returns a 404/not found, continue.

Skip npm availability checks for local/private extensions.

## Scaffold selection

Use an adaptive scaffold.

### Minimal scaffold

Use for simple extensions:

```text
extensions/<name>/
├── index.ts
├── package.json
└── README.md
```

### Structured scaffold

Use for extensions with enough moving parts to need boundaries:

```text
extensions/<name>/
├── index.ts
├── package.json
├── README.md
├── src/
│   ├── ...focused modules...
└── docs/
    └── development.md   # for complex extensions only, when useful
```

Keep `index.ts` as the Pi extension entry point. For structured extensions, let `index.ts` wire the extension and delegate implementation to focused modules under `src/`.

Avoid adding structure just to look professional. Add files when they reduce coupling, clarify ownership, or make testing/maintenance easier.

## Package metadata

Every extension in this monorepo gets a `package.json`, including local/private extensions.

### Publishable extension package pattern

For publishable extensions, follow the `extensions/codex-limit/package.json` pattern unless there is a strong reason not to.

Required shape:

```json
{
  "name": "pi-<extension-name>",
  "version": "0.0.1",
  "description": "<one-line description>",
  "keywords": ["pi-coding-agent", "pi-extension", "pi-package"],
  "homepage": "https://github.com/santychuy/pi-setup/tree/main/extensions/<extension-name>",
  "bugs": {
    "url": "https://github.com/santychuy/pi-setup/issues"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/santychuy/pi-setup.git",
    "directory": "extensions/<extension-name>"
  },
  "files": ["index.ts", "dist", "README.md"],
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.cts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    },
    "./package.json": "./package.json"
  },
  "publishConfig": {
    "access": "public",
    "provenance": true
  },
  "scripts": {
    "prepublishOnly": "tsdown --no-config --format esm --format cjs --dts --exports --clean --sourcemap --shims index.ts"
  },
  "devDependencies": {
    "typescript": "5.8.3"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "peerDependenciesMeta": {
    "@earendil-works/pi-coding-agent": {
      "optional": true
    }
  },
  "tsdown": {
    "entry": ["index.ts"]
  },
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```

Adjust peer dependencies based on imports:

- Add `@earendil-works/pi-tui` when importing TUI components/helpers.
- Add `@earendil-works/pi-ai` when importing AI helpers such as `StringEnum`.
- Add `typebox` when importing schemas from `typebox`.

Pi core packages should be peer dependencies with `"*"`, not bundled. Third-party runtime packages must go in `dependencies`, because Pi package installation runs production installs and dev dependencies are not available at runtime.

If adding files required at runtime, include them in `files`.

### Local/private package pattern

For local/private extensions, still create `package.json`, but omit publish-only fields when they do not apply. Keep:

- `name`
- `version`
- `description`
- `type`
- relevant dependencies/peerDependencies
- `pi.extensions`

If the local/private extension still builds through the repo, include `tsdown.entry` consistently.

## Extension implementation rules

Follow the Pi extension API from the docs.

Basic entry point:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // register events, commands, tools, UI hooks, etc.
}
```

Important implementation guidance:

- Use `ctx.hasUI` before relying on interactive UI in non-interactive modes.
- Use `ctx.signal` for abortable async work during agent turns.
- Throw from tool `execute()` to report tool errors; do not return fake error flags.
- If registering tools with string enums, prefer `StringEnum` from `@earendil-works/pi-ai` for provider compatibility.
- If a custom tool mutates files, use `withFileMutationQueue()` around the full read/modify/write window.
- Truncate large custom tool outputs using Pi truncation utilities; do not flood context.
- Store branch-sensitive tool state in tool result `details` and reconstruct from the active branch when needed.
- Clean up resources in `session_shutdown`.
- Treat extensions as trusted code with full system access. Avoid surprising network calls, filesystem writes, or credential access.

## README requirements

Publishable extension READMEs should follow the `codex-limit` style.

Required sections:

1. Logo/header using the repo asset when appropriate:
   - `https://raw.githubusercontent.com/santychuy/pi-setup/main/.github/assets/santychuyISO.png`
2. Package name and one-line purpose.
3. Install:
   - Global: `pi install npm:<package-name>`
   - Project-local: `pi install -l npm:<package-name>`
4. Features.
5. Usage:
   - commands
   - tools
   - UI behavior
   - config or env vars
6. Security/privacy notes when relevant.
7. Links:
   - Source
   - Issues

For local/private extensions, include enough README information for future maintainers to load, configure, and test the extension, but do not advertise npm install commands unless it will be published.

## Quality gates

Before declaring the extension ready, run and report these gates. They are mandatory before publishing.

1. If dependencies changed:

```bash
bun install
```

2. Type/lint/format check:

```bash
bun run check
```

3. Build:

```bash
bun run build
```

4. Inspect generated build output:

```bash
find extensions/<name>/dist -maxdepth 2 -type f | sort
```

Confirm expected `.cjs`, `.mjs`, declaration files, and maps exist for publishable extensions.

5. Test local loading/install.

Prefer the most direct local validation for the extension:

```bash
pi -e ./extensions/<name>/index.ts
```

or, when validating package installation behavior:

```bash
pi install -l ./extensions/<name>
```

6. Verify README commands match the package name and intended publishability.

7. Verify package metadata:

```bash
bun pm pack --dry-run ./extensions/<name>
```

If that command is unavailable or unsuitable, use the closest npm/bun dry-run pack command and inspect the tarball contents.

8. For publishable extensions, confirm npm name availability was checked before release preparation.

Do not hand-wave failed gates. Fix the issue or clearly report the blocker.

## Publishing workflow

### Primary path: semantic-release monorepo

This repo publishes through GitHub Actions on pushes to `main` using semantic-release and the workspace release setup.

Use conventional commits so semantic-release can determine package versions and release notes.

Typical flow:

1. Finish implementation and quality gates.
2. Ensure `package.json` metadata is correct.
3. Commit with a conventional commit, usually:
   - `feat(<extension-name>): add <short purpose>` for a new extension
   - `fix(<extension-name>): ...` for fixes
4. Push/merge to `main`.
5. Let `.github/workflows/release.yml` run the release.
6. Verify npm package and GitHub release output.

### Manual fallback

Manual publish is only a fallback for emergencies or when the user explicitly asks.

Before manual publish:

- Ensure all mandatory quality gates pass.
- Confirm npm login/auth and package ownership.
- Confirm package name availability.
- Confirm provenance support if using provenance.

Manual fallback command from the extension directory:

```bash
cd extensions/<name>
npm publish --provenance --access public
```

Prefer the semantic-release workflow when possible to keep versions, release notes, and repository state consistent.

## Final response format

When finishing an extension creation task, summarize concisely:

- extension path
- publishable or local/private
- key files created/changed
- Pi APIs used
- validation commands run and status
- publishing next step, if publishable

Example:

```text
Created `extensions/foo-bar` as a publishable Pi extension.

Changed:
- `extensions/foo-bar/index.ts`
- `extensions/foo-bar/package.json`
- `extensions/foo-bar/README.md`

Validation:
- `bun run check` ✅
- `bun run build` ✅
- local load test ✅

Next: commit with `feat(foo-bar): add ...` and push to `main` for semantic-release.
```
