// ─── Public Types ───────────────────────────────────────────────────────────

export type ToastVariant = "info" | "success" | "warning" | "error";
export type ToastPosition = "top-right" | "bottom-right";

export interface ToastOptions {
  message: string;
  variant: ToastVariant;
  durationMs: number;
  position: ToastPosition;
  width: number;
}

/** Convenience input type with sensible defaults (all fields except `message` optional). */
export interface ToastInput {
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
  position?: ToastPosition;
  width?: number;
}

/** Payload for the `toast:show` event bus event. */
export interface ToastShowEvent {
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
  position?: ToastPosition;
  width?: number;
}

// ─── Internal Types ─────────────────────────────────────────────────────────

export type AnimationPhase = "in" | "hold" | "out";

export type ToastColorRole = "accent" | "success" | "warning" | "error";
