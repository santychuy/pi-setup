# Terminal Notification Protocols

A quick reference on the escape sequences and mechanisms pi-chime uses under the hood.

## BEL — The Universal Bell

```
\x07  (0x07, also \a)
```

The oldest terminal notification mechanism. Every terminal emulator supports it. Depending on configuration, it either produces an audible beep, a visual flash, or bounces the dock icon (macOS). It carries no message text — just an attention signal. pi-chime always sends BEL last regardless of which richer protocol ran before it.

## OSC 9 — iTerm2 / Ghostty / WezTerm Notification

```
\x1b]9;<message>\x07
```

Originated by iTerm2. A single-field notification with both title and body combined. Now also supported natively by **Ghostty** and **WezTerm**. On supported terminals, this produces a native OS-level notification banner.

**Format breakdown:**

- `\x1b]9` — OSC command identifier 9
- `;<message>` — the notification text (title + body combined)
- `\x07` — BEL character terminates the sequence

## OSC 777 — rxvt-unicode Notify

```
\x1b]777;notify;<title>;<body>\x07
```

Originated by rxvt-unicode. Structured with separate title and body fields. Supported by Warp, Kitty, and many VTE-based terminals. On terminals that support it, this produces a native OS-level notification banner with both a title and body.

**Format breakdown:**

- `\x1b]777` — OSC command identifier 777
- `;notify;` — the notify subtype
- `<title>` — notification title
- `<body>` — notification body text
- `\x07` — BEL character terminates the sequence (can also use `\x1b\\` as ST)

## OSC 99 — Kitty Notification Protocol

```
\x1b]99;i=1:d=0;<title>\x1b\\
\x1b]99;i=1:p=body;<body>\x1b\\
```

Kitty's native notification protocol. Richer than OSC 777 — supports notification IDs (for updating/closing), key-value metadata, urgency levels, and chunked payloads for long text.

**Format breakdown:**

- `\x1b]99` — OSC command identifier 99
- `i=1` — notification ID (used to update or close later)
- `d=0` — done flag (0 = more data coming, 1 = complete)
- `p=body` — payload type key
- `\x1b\\` — ST (String Terminator) ends the sequence

The ID allows sending the title first (`d=0`) and body second, letting Kitty group them into a single notification. pi-chime sends both in quick succession.

## macOS osascript — Notification Center Banner

```bash
osascript -e 'display notification "body" with title "Title"'
```

Not an escape sequence — a macOS command-line tool that triggers a native Notification Center banner. pi-chime **always** sends this on macOS, regardless of terminal type, to ensure a visible push-style notification. Silently fails if the calling terminal app hasn't been granted notification permissions in System Settings.

**Note:** The `osascript` notification inherits the sandbox of the parent terminal process. If the terminal app lacks notification permissions, macOS silently drops the banner with no error.

## Terminal Detection

pi-chime detects the terminal using environment variables set by each emulator. It checks unique env vars first, then falls back to `TERM_PROGRAM` (which survives through `sudo`, `tmux`, and `ssh` in many cases):

| Priority | Env Variable                                    | Terminal           |
| -------- | ----------------------------------------------- | ------------------ |
| 1        | `KITTY_WINDOW_ID`                               | Kitty              |
| 1        | `WEZTERM_PANE`                                  | WezTerm            |
| 1        | `GHOSTTY_RESOURCES_DIR`                         | Ghostty            |
| 1        | `ITERM_SESSION_ID`                              | iTerm2             |
| 2        | `TERM_PROGRAM=WarpTerminal` or `WARP_HONOR_PS1` | Warp               |
| 2        | `TERM_PROGRAM=Apple_Terminal`                   | macOS Terminal.app |
| 2        | `TERM_PROGRAM=WezTerm`                          | WezTerm            |
| 2        | `TERM_PROGRAM=ghostty`                          | Ghostty            |
| 2        | `TERM_PROGRAM=iTerm.app`                        | iTerm2             |

When none match, it falls back to OSC 777 (widest support among modern terminals) + BEL.

## macOS Notification Troubleshooting

If you aren't seeing Notification Center banners:

1. **Check terminal permissions:** System Settings → Notifications → [Your Terminal] → Allow Notifications
2. **Try `/chime`:** Run the `/chime` command in Pi. It reports the detected terminal.
3. **Test manually:** Run `osascript -e 'display notification "test" with title "test"'` in your terminal. If nothing appears, the terminal app lacks notification permission.

## Why BEL Always Fires Last

Regardless of which protocol is used, BEL is sent as the final character. This ensures that even if a terminal ignores or doesn't surface the OSC notification, the user still gets an attention signal. It's the one thing every terminal understands.

## Further Reading

- [Kitty notification protocol](https://sw.kovidgoyal.net/kitty/protocol-extensions.html#id3)
- [WezTerm notification handling](https://wezfurlong.org/wezterm/config/notification-handling.html)
- [Ghostty OSC support](https://ghostty.org/docs/support/osc)
- [iTerm2 proprietary escape codes](https://iterm2.com/documentation-escape codes.html)
