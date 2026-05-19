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
import { getStatusMeta } from "./status-display.js";

// ── Status Icons ─────────────────────────────────────────────────────────────

// ── Theme Color Mapping ──────────────────────────────────────────────────────

const STATUS_COLORS: Record<LeaderStatus, (text: string, theme: Theme) => string> = {
  spawning: (text, theme) => theme.fg("dim", text),
  running: (text, theme) => theme.fg("accent", text),
  completed: (text, theme) => theme.fg("success", text),
  failed: (text, theme) => theme.fg("error", text),
  cancelled: (text, theme) => theme.fg("warning", text),
  timed_out: (text, theme) => theme.fg("warning", text),
  budget_blocked: (text, theme) => theme.fg("warning", text),
  budget_exceeded: (text, theme) => theme.fg("error", text),
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
    const baseIcon = getStatusMeta(entry.status).icon;
    const iconGlyph = entry.source === "async" && entry.status === "running" ? "⏳" : baseIcon;
    const colorize =
      STATUS_COLORS[entry.status] ?? ((text: string, t: Theme) => t.fg("warning", text));
    const icon = colorize(iconGlyph, theme);
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
