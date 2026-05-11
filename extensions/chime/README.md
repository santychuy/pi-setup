<div align="left">
  <img src="https://raw.githubusercontent.com/santychuy/pi-setup/main/.github/assets/santychuyISO.png" alt="santychuyISO" width="120" style="vertical-align: middle; margin-bottom: 16px;" />
</div>

# pi-chime

Terminal bell notification for Pi — chimes when the agent finishes responding. Detects your terminal emulator and uses the best available notification protocol, **and** sends a native macOS Notification Center banner when running on macOS.

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

Pi-chime hooks into `agent_end` and sends a notification when the agent loop finishes. It automatically detects which terminal you're running and picks the richest protocol that terminal supports. On macOS, it **also** triggers a Notification Center banner via `osascript` so you get a push-style alert even if the terminal's own OSC notification is subtle or suppressed.

Every chime ends with a BEL (`\x07`) character as a universal fallback.

## Terminal Support

| Terminal           | Native Protocol | macOS Banner | Fallback |
| ------------------ | --------------- | ------------ | -------- |
| Kitty              | OSC 99          | Yes          | BEL      |
| Ghostty            | OSC 9           | Yes          | BEL      |
| WezTerm            | OSC 9           | Yes          | BEL      |
| iTerm2             | OSC 9           | Yes          | BEL      |
| Warp               | OSC 777         | Yes          | BEL      |
| macOS Terminal.app | —               | Yes          | BEL      |
| Unknown            | OSC 777         | Yes (macOS)  | BEL      |

## macOS Notification Permissions

If you don't see macOS Notification Center banners, your terminal app may not have permission to send notifications:

1. Open **System Settings → Notifications**
2. Find your terminal app (e.g., Ghostty, WezTerm, iTerm2, Warp, Terminal)
3. Ensure **Allow Notifications** is turned on
4. Set **Alert style** to **Banners** or **Alerts**

> The banner is sent via `osascript`, which inherits the notification sandbox of the calling terminal process. If the terminal lacks permission, macOS silently drops the notification.

## Commands

- `/chime` — open the chime settings menu where you can:
  - **Test notification** — trigger a notification with your current sound
  - **Change sound** — cycle through available notification sounds and preview them
  - **Exit** — close the menu

## Sound Customization (macOS)

When running on macOS, you can customize the notification sound played by the `osascript` Notification Center banner. Use `/chime` → **Change sound** to select from the available options:

| Sound   | Description       |
| ------- | ----------------- |
| `Purr`  | Soft and pleasant |
| `Glass` | Clear timer-like  |
| `Hero`  | Triumphant        |

Your selection is saved to `~/.config/pi-chime/config.json` and persists across sessions. The default sound is `Purr`.

You can also use any sound name from `/System/Library/Sounds/` by editing the config file directly.

## Behind the Scenes

See [docs/protocols.md](./docs/protocols.md) for a quick reference on the OSC escape sequences and protocols used behind the scenes.

## Links

- [Source](https://github.com/santychuy/pi-setup/tree/main/extensions/chime)
- [Issues](https://github.com/santychuy/pi-setup/issues)
