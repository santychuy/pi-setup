<div align="left">
  <img src="https://raw.githubusercontent.com/santychuy/pi-setup/main/.github/assets/santychuyISO.png" alt="santychuyISO" width="120" style="vertical-align: middle; margin-bottom: 16px;" />
</div>

# pi-footer-mode

Zen/dev footer mode extension for Pi. Toggle between a clean "zen" footer and a "dev" footer showing git branch, working directory, model info, thinking level, and Codex usage.

## Install

### Global

```bash
pi install npm:pi-footer-mode
```

### Project-local

Writes to `.pi/settings.json` — portable across teams:

```bash
pi install -l npm:pi-footer-mode
```

## Features

- `/footer` command — switch between `zen` and `dev` modes
- `alt+f` shortcut to toggle
- Dev mode shows: git branch, cwd, model provider/id, thinking level, Codex 5-hour usage
- Stabilizes editor borders with theme-aware colors

## Links

- [Source](https://github.com/santychuy/pi-setup/tree/main/extensions/footer-mode)
- [Issues](https://github.com/santychuy/pi-setup/issues)
