<div align="left">
  <img src=".github/assets/santychuyISO.png" alt="Santychuy logo" width="80" />
</div>

# Pi Setup

Personal setup for [Pi](https://github.com/badlogic/pi-mono): extensions, local skills, theme, and portable settings.

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

### Local resources

- Skills: `caveman`, `mermaid-diagrams`, `subagent-authoring`
- Theme: `santychuy-dark`
- Pinned external Pi packages: [`config/settings.json`](config/settings.json)

Global skills remain owned by `~/.agents/skills` and are documented in [`config/external-resources.json`](config/external-resources.json).

## Install

Requires Pi `0.84.4`, Bun, and a local clone of this repository.

```bash
git clone https://github.com/santychuy/pi-setup.git
cd pi-setup
bun install --frozen-lockfile
bun run check
bun run setup --dry-run
bun run setup --yes
```

`setup` backs up portable Pi files before deployment, then deploys this repository's settings, extensions, skills, themes, and keybindings. It never changes authentication, OAuth data, sessions, caches, memory, or history.

## Roll back

Use backup path printed by `setup`:

```bash
bun run setup --restore ~/.pi/agent/backups/pi-setup-<timestamp>
```

## Maintain

Edit this repository, then run:

```bash
bun run check
bun run doctor
```

Legacy extension monorepo: branch `legacy/extensions-monorepo`, tag `legacy-v0.1.0`.
