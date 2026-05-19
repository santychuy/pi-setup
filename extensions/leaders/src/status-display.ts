import type { LeaderParallelTaskStatus } from "./types.js";
import type { LeaderStatus } from "./tracker.js";

export type LeaderParallelRunStatus =
  | "completed"
  | "partial"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "budget_exceeded";

export type LeaderDisplayStatus = LeaderParallelTaskStatus | LeaderStatus;

export const PARALLEL_STATUS_ORDER: LeaderParallelTaskStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "budget_blocked",
  "budget_exceeded",
];

export const STATUS_META: Record<LeaderDisplayStatus, { icon: string; label: string }> = {
  spawning: { icon: "◌", label: "spawning" },
  running: { icon: "●", label: "running" },
  completed: { icon: "✓", label: "completed" },
  failed: { icon: "✗", label: "failed" },
  cancelled: { icon: "⊘", label: "cancelled" },
  timed_out: { icon: "⏱", label: "timed out" },
  budget_blocked: { icon: "◼", label: "budget blocked" },
  budget_exceeded: { icon: "$", label: "budget exceeded" },
};

export const RUN_STATUS_META: Record<LeaderParallelRunStatus, { icon: string; label: string }> = {
  completed: { icon: "✓", label: "completed" },
  partial: { icon: "~", label: "partial" },
  failed: { icon: "✗", label: "failed" },
  cancelled: { icon: "⊘", label: "cancelled" },
  timed_out: { icon: "⏱", label: "timed out" },
  budget_exceeded: { icon: "$", label: "budget exceeded" },
};

export const getStatusMeta = (status: string): { icon: string; label: string } =>
  STATUS_META[status as LeaderDisplayStatus] ?? { icon: "?", label: `unknown:${status}` };

export const getRunStatusMeta = (status: string): { icon: string; label: string } =>
  RUN_STATUS_META[status as LeaderParallelRunStatus] ?? { icon: "?", label: `unknown:${status}` };
