<div align="left">
  <img src="https://raw.githubusercontent.com/santychuy/pi-setup/main/.github/assets/santychuyISO.png" alt="santychuyISO" width="120" style="vertical-align: middle; margin-bottom: 16px;" />
</div>

# pi-chime

Terminal bell notification for Pi — chimes when the agent finishes responding. Detects your terminal emulator and uses the best available notification protocol.

## Install

### Global

```bash
pi install npm:pi-chime
```

### Project-local

Writes to `.pi/settings.json` — portable across teams:

```bash
pi install -l npm:pi-chime
```

## How It Works

Pi-chime hooks into `agent_end` and sends a terminal notification when the agent loop finishes. It automatically detects which terminal you're running and picks the richest protocol that terminal supports, always ending with a BEL (`\x07`) character as a universal fallback.

## Terminal Support

| Terminal           | Protocol  | Fallback |
| ------------------ | --------- | -------- |
| Kitty              | OSC 99    | BEL      |
| WezTerm            | OSC 777   | BEL      |
| Ghostty            | OSC 777   | BEL      |
| Warp               | OSC 777   | BEL      |
| macOS Terminal.app | osascript | BEL      |
| Unknown            | OSC 777   | BEL      |

## Commands

- `/chime` — send a test notification and show which terminal was detected

## Behind the Scenes

See [docs/protocols.md](./docs/protocols.md) for a quick reference on the OSC escape sequences and protocols used behind the scenes.

## Links

- [Source](https://github.com/santychuy/pi-setup/tree/main/extensions/chime)
- [Issues](https://github.com/santychuy/pi-setup/issues)
