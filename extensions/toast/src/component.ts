import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ToastOptions, AnimationPhase } from "./types.js";
import { VARIANT_ICON, VARIANT_COLOR } from "./constants.js";

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a stateless-to-the-caller `Component` for rendering a toast overlay.
 *
 * The animation state (phase + frame) lives in the closure; call
 * `setAnimation(phase, frame)` on the returned object to drive transitions.
 */
export const createToastComponent = (
  options: ToastOptions,
  theme: Theme,
): Component & { setAnimation: (phase: AnimationPhase, frame: number) => void } => {
  // ── Closure state ────────────────────────────────────────────────────────
  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;
  let phase: AnimationPhase = "in";
  let frame = 0;

  // ── Helpers ──────────────────────────────────────────────────────────────

  const color = (text: string): string => theme.fg(VARIANT_COLOR[options.variant], text);

  const getFrameProgress = (): number => {
    const max = 8;
    return Math.max(0, Math.min(max, frame)) / max;
  };

  const applyHorizontalSlide = (lines: string[], width: number): string[] => {
    if (phase === "hold") return lines.map((line) => truncateToWidth(line, width));

    const progress = getFrameProgress();
    const visibleCols =
      phase === "in"
        ? Math.max(1, Math.ceil(width * progress))
        : Math.max(0, width - Math.ceil(width * progress));
    const leftPad = Math.max(0, width - visibleCols);

    return lines.map((line) =>
      truncateToWidth(" ".repeat(leftPad) + truncateToWidth(line, visibleCols, ""), width),
    );
  };

  const applyVerticalSlide = (lines: string[], width: number): string[] => {
    if (phase === "hold") return lines.map((line) => truncateToWidth(line, width));

    const visibleCount =
      phase === "in"
        ? Math.max(1, Math.ceil(lines.length * getFrameProgress()))
        : Math.max(0, lines.length - Math.ceil(lines.length * getFrameProgress()));

    return lines.slice(lines.length - visibleCount).map((line) => truncateToWidth(line, width));
  };

  const applyAnimation = (lines: string[], width: number): string[] => {
    return options.position === "bottom-right"
      ? applyVerticalSlide(lines, width)
      : applyHorizontalSlide(lines, width);
  };

  // ── Component lifecycle ──────────────────────────────────────────────────

  const invalidate = (): void => {
    cachedWidth = undefined;
    cachedLines = undefined;
  };

  const render = (width: number): string[] => {
    if (cachedWidth === width && cachedLines) return cachedLines;

    const inner = Math.max(1, width - 2);
    const border = color("─".repeat(inner));
    const icon = color(VARIANT_ICON[options.variant]);
    const prefix = `${icon} `;
    const msgWidth = Math.max(1, inner - visibleWidth(prefix) - 2);
    const message = theme.fg("text", truncateToWidth(options.message, msgWidth));
    const content = `${prefix}${message}`;
    const pad = Math.max(0, inner - visibleWidth(content));

    cachedWidth = width;
    cachedLines = applyAnimation(
      [
        color("╭") + border + color("╮"),
        color("│") + content + " ".repeat(pad) + color("│"),
        color("╰") + border + color("╯"),
      ],
      width,
    );

    return cachedLines;
  };

  const setAnimation = (nextPhase: AnimationPhase, nextFrame: number): void => {
    phase = nextPhase;
    frame = nextFrame;
    invalidate();
  };

  return { render, invalidate, setAnimation };
};
