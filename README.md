# santychuy/pi-setup

My personal Pi coding agent setup — extensions, skills, themes, and prompts. Fully shareable and installable via `pi install`.

## How Pi Discovers This Repo

This repo supports **two** discovery paths:

1. **Project-local**: When working in this repo, Pi auto-detects everything via the `.pi/` directory (which symlinks to `extensions/`, `skills/`, `themes/`, `prompts/`).

2. **As an installed package**: Run `pi install` and Pi reads the `pi` key in `package.json` to discover all content. Works from any directory.

## Install

### Global Pi install

Install once and use this setup from any directory:

```bash
pi install git:https://github.com/santychuy/pi-setup
```

Or install locally after cloning:

```bash
git clone https://github.com/santychuy/pi-setup.git
pi install ./pi-setup
```

### Copy into a project

Vendor the Pi resources into a specific project under `target-project/.pi/`:

```bash
git clone https://github.com/santychuy/pi-setup.git
cd pi-setup
bun install
bun run install:local ../target-project
```

This copies:

```txt
extensions -> ../target-project/.pi/extensions
skills     -> ../target-project/.pi/skills
prompts    -> ../target-project/.pi/prompts
themes     -> ../target-project/.pi/themes
```

Use `--force` to replace existing target resources:

```bash
bun run install:local ../target-project --force
```

### Link into a project

For personal development, link the resources instead of copying them:

```bash
bun run link:local ../target-project
```

This creates symlinks from `target-project/.pi/*` back to this repo. Edits here are reflected immediately in the target project. Use `--force` to replace existing target resources.

Copy mode is better for sharing or vendoring. Link mode is better for your own machines while actively developing this setup.

## Development

```bash
bun run lint          # Lint with oxlint
bun run format        # Format with oxfmt
bun run check         # Lint + format check + type check
bun run install:local ../target-project  # Copy resources into another project
bun run link:local ../target-project     # Symlink resources into another project
```

> Note: `pi install git:...` uses Pi's package installer, which may run npm internally for
> installed git packages. This repo uses Bun for local development.

## Adding a New Extension

1. Create a directory under `extensions/`:

```
extensions/my-extension/
  index.ts
  package.json
```

2. In `index.ts`, export a default function that receives `ExtensionAPI`:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerTool({ ... });
  pi.registerCommand("my-command", { ... });
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("My extension loaded!", "info");
  });
}
```

## License

MIT
