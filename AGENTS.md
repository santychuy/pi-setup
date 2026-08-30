# Pi Setup

This repository is the canonical, version-controlled source for the active personal Pi setup.
The live `~/.pi/agent` directory is a runtime location, not a source directory.

## Rules

- Use Bun and exact dependency versions.
- Keep `extensions/`, `skills/`, `themes/`, and `config/` aligned with the setup actually in use.
- Never commit authentication, OAuth data, sessions, messages, task history, caches, memory, trust records, installed package trees, or machine-generated state.
- Global skills remain owned by `~/.agents/skills`; do not vendor or mutate them here.
- Run `bun run check` before considering a change complete.
- Run `bun run setup --dry-run` before applying the setup.
- The legacy extension monorepo is preserved on `legacy/extensions-monorepo` and tag `legacy-v0.1.0`.

When modifying JavaScript or TypeScript, use modern JavaScript patterns and maintain strict TypeScript safety where the upstream integration permits it.
