# Pi Setup

Canonical source for the Pi coding-agent setup I actively use.

This repository is intentionally small. It tracks maintained extensions, locally-owned skills, one theme, and portable settings. Authentication, sessions, caches, memory, installed packages, and other runtime state stay under `~/.pi/agent` and are never committed.

## Architecture

```text
pi-setup/              canonical resources and portable configuration
    │
    └── local Pi package referenced by ~/.pi/agent/settings.json

~/.pi/agent/           runtime settings, credentials, sessions, caches, package installs
~/.agents/skills/      separately managed global skills, auto-discovered by Pi
```

## Included

### Extensions

- `auto-session-name`
- `caveman`
- `chill`
- `codex-limit`
- `custom-footer`
- `custom-header`
- `herdr-agent-state`
- `herdr-context-sidebar`
- `herdr-pi-sidebar-metadata`
- `lm-studio`
- `managed-tasks`
- `modes`

### Local skills

- `caveman`
- `mermaid-diagrams`
- `subagent-authoring`

### Theme

- `santychuy-dark`

External npm and Git Pi packages are pinned in [`config/settings.json`](config/settings.json). Global skills remain in `~/.agents/skills` and are documented in [`config/external-resources.json`](config/external-resources.json).

## Install

Requirements:

- Pi `0.84.3`
- Bun
- A local clone of this repository

```bash
bun install --frozen-lockfile
bun run check
bun run setup --dry-run
bun run setup --yes
bun run doctor
```

`setup` creates a private local backup (`0700` directories and `0600` files) before it changes portable live files. It never accesses `auth.json`, OAuth data, sessions, cache, memory, messages, or history.

The switch intentionally replaces the complete live `extensions/`, `skills/`, and `themes/` directories after backing them up. Add maintained resources to this repository before deployment; do not keep separate active copies in those live directories.

To roll back, use the backup path printed by `setup`:

```bash
bun run setup --restore ~/.pi/agent/backups/pi-setup-<timestamp>
```

## Maintenance

1. Edit resources in this repository, not under `~/.pi/agent`.
2. Run `bun run check`.
3. Run `bun run doctor` to detect live drift.
4. Update package pins deliberately in `config/settings.json`.

The previous extension-development monorepo is preserved on branch `legacy/extensions-monorepo` and tag `legacy-v0.1.0`.
