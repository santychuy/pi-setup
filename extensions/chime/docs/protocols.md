# Terminal Notification Protocols

A quick reference on the escape sequences and mechanisms pi-chime uses under the hood.

## BEL — The Universal Bell

```
\x07  (0x07, also \a)
```

The oldest terminal notification mechanism. Every terminal emulator supports it. Depending on configuration, it either produces an audible beep, a visual flash, or bounces the dock icon (macOS). It carries no message text — just an attention signal. pi-chime always sends BEL last regardless of which richer protocol ran before it.

## OSC 777 — Notify

```
\x1b]777;notify;<title>;<body>\x07
```

Originated by rxvt-unicode. Structured with separate title and body fields. Now supported by WezTerm, Ghostty, Kitty, and Warp as a desktop notification trigger. On terminals that support it, this produces a native OS-level notification banner with both a title and body.

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

## OSC 9 — Simple Notification

```
\x1b]9;<body>\x07
```

Originated by iTerm2. Body text only, no title field. pi-chime doesn't use this protocol (OSC 777 is a strict superset with wider support), but it's worth knowing about since some terminals only support OSC 9 and not OSC 777.

## macOS osascript — Desktop Notification

```bash
osascript -e 'display notification "body" with title "Title"'
```

Not an escape sequence — a macOS command-line tool that triggers a native Notification Center banner. Used exclusively for Terminal.app, which doesn't support any OSC notification protocol. Silently fails if the user hasn't granted notification permissions.

## Terminal Detection

pi-chime detects the terminal using environment variables set by each emulator:

| Env Variable                                    | Terminal           |
| ----------------------------------------------- | ------------------ |
| `KITTY_WINDOW_ID`                               | Kitty              |
| `WEZTERM_PANE_ID`                               | WezTerm            |
| `GHOSTTY_WINDOWS_DIR`                           | Ghostty            |
| `TERM_PROGRAM=Apple_Terminal`                   | macOS Terminal.app |
| `TERM_PROGRAM=WarpTerminal` or `WARP_HONOR_PS1` | Warp               |

When none match, it falls back to OSC 777 (widest support among modern terminals) + BEL.

## Why BEL Always Fires Last

Regardless of which protocol is used, BEL is sent as the final character. This ensures that even if a terminal ignores or doesn't surface the OSC notification, the user still gets an attention signal. It's the one thing every terminal understands.

## Further Reading

- [Kitty notification protocol](https://sw.kovidgoyal.net/kitty/protocol-extensions.html#id3)
- [WezTerm notification handling](https://wezfurlong.org/wezterm/config/notification-handling.html)
- [Ghostty OSC support](https://ghostty.org/docs/support/osc)
