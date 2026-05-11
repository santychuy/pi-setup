import type { ToastOptions, ToastVariant, ToastColorRole } from "./types.js";

export const DEFAULT_TOAST_OPTIONS: Omit<ToastOptions, "message"> = {
  variant: "info",
  durationMs: 2500,
  position: "top-right",
  width: 26,
};

export const VARIANT_ICON: Record<ToastVariant, string> = {
  info: "ℹ",
  success: "✓",
  warning: "⚠",
  error: "✕",
};

export const VARIANT_COLOR: Record<ToastVariant, ToastColorRole> = {
  info: "accent",
  success: "success",
  warning: "warning",
  error: "error",
};

export const ANIMATION = {
  maxFrame: 8,
  frameMs: 22,
} as const;

export const WIDTH = {
  min: 20,
  max: 80,
} as const;
