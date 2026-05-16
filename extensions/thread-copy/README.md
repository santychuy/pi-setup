# pi-thread-copy

Private Pi extension that copies the current active session thread to the system clipboard.

## Usage

Run this command in Pi:

```txt
/copy-thread
```

The extension formats the active branch as Markdown with `## User` and `## Assistant` sections, then copies it to the clipboard.

## Clipboard support

The extension tries the native clipboard tools for each platform:

- macOS: `pbcopy`
- Windows: `clip`
- Linux: `wl-copy`, then `xclip`, then `xsel`

If Linux clipboard support fails, install one of:

```bash
# Wayland
wl-clipboard

# X11
xclip
# or
xsel
```

## Image handling

Images are not copied as binary data in v1. They are represented as placeholders like:

```txt
[image omitted: #1, image/png, 42KB]
```

This keeps the copied transcript readable and avoids huge base64 payloads in the clipboard.

## Scope

- Copies only the current active branch/thread.
- Includes user and assistant messages.
- Omits tool result messages.
- Marks assistant thinking/tool calls with placeholders when present.

## Privacy

This command copies the full visible user/assistant conversation text from the active branch to your OS clipboard. Clipboard contents may be visible to other local apps depending on your operating system and clipboard manager.
