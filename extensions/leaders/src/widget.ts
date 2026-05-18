/**
 * Leaders extension — TUI widget renderer.
 *
 * Renders a compact status bar above the editor showing active
 * and recently-completed leader subagents (both foreground and async).
 *
 * Uses the Pi theme system for consistent styling.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { LeaderEntry, LeaderStatus } from "./tracker.js";

// ── Status Icons ─────────────────────────────────────────────────────────────

const FOREGROUND_STATUS_ICONS: Record<LeaderStatus, string> = {
  spawning: "◌",
  running: "●",
  completed: "✓",
  failed: "✗",
  cancelled: "⊘",
};

const ASYNC_STATUS_ICONS: Record<LeaderStatus, string> = {
  spawning: "◌",
  running: "⏳",
  completed: "✓",
  failed: "✗",
  cancelled: "⊘",
};

// ── Theme Color Mapping ──────────────────────────────────────────────────────

const STATUS_COLORS: Record<LeaderStatus, (text: string, theme: Theme) => string> = {
  spawning: (text, theme) => theme.fg("dim", text),
  running: (text, theme) => theme.fg("accent", text),
  completed: (text, theme) => theme.fg("success", text),
  failed: (text, theme) => theme.fg("error", text),
  cancelled: (text, theme) => theme.fg("warning", text),
};

// ── Renderer ─────────────────────────────────────────────────────────────────

/**
 * Render the leaders tracker entries into styled string lines.
 * Returns `undefined` when there are no entries to display.
 */
export const renderLeadersWidget = (
  entries: readonly LeaderEntry[],
  theme: Theme,
): string[] | undefined => {
  if (entries.length === 0) return undefined;

  return entries.map((entry) => {
    const icons = entry.source === "async" ? ASYNC_STATUS_ICONS : FOREGROUND_STATUS_ICONS;
    const icon = STATUS_COLORS[entry.status](icons[entry.status], theme);
    const agentName = theme.fg("muted", entry.agent);
    const task = entry.task;
    const modeTag = theme.fg("dim", entry.mode);

    const badge = entry.source === "async" ? theme.fg("dim", "bg") : "";

    // Format: icon [bg] agent task mode  or  icon agent task mode
    const parts = [icon];
    if (badge) parts.push(badge);
    parts.push(agentName, task, modeTag);

    return parts.join(" ");
  });
};
