/**
 * Leaders extension — in-memory subagent state tracker.
 *
 * Tracks the lifecycle of foreground and async leader runs so that the TUI
 * widget can display real-time status above the editor.
 *
 * States: spawning → running → completed | failed | cancelled
 */

import type { LeaderAsyncRun } from "./async.js";
import type { LeaderSessionMode } from "./types.js";

// ── Leader Entry ────────────────────────────────────────────────────────────

export type LeaderStatus =
  | "spawning"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "budget_blocked"
  | "budget_exceeded";

export type LeaderSource = "foreground" | "async";

export interface LeaderEntry {
  /** Unique ID for this tracker entry. */
  readonly id: number;
  /** Agent profile name. */
  readonly agent: string;
  /** Original task text (may be truncated for display). */
  readonly task: string;
  /** Session mode. */
  readonly mode: LeaderSessionMode;
  /** Current lifecycle state. */
  status: LeaderStatus;
  /** ISO timestamp when the entry was created. */
  readonly startedAt: string;
  /** ISO timestamp when the entry reached a terminal state. */
  completedAt?: string;
  /** Exit code (available once completed/failed). */
  exitCode?: number;
  /** Whether this is a foreground or async (background) run. */
  readonly source: LeaderSource;
  /** For async runs, the filesystem run ID for correlation with status.json. */
  readonly asyncRunId?: string;
}

// ── Tracker ──────────────────────────────────────────────────────────────────

const MAX_TASK_DISPLAY_LENGTH = 60;
const ASYNC_TERMINAL_PRUNE_MS = 10_000;

let nextId = 1;

const truncateTask = (task: string): string =>
  task.length > MAX_TASK_DISPLAY_LENGTH ? `${task.slice(0, MAX_TASK_DISPLAY_LENGTH - 3)}...` : task;

export class LeaderTracker {
  private readonly entries: LeaderEntry[] = [];
  private onChange?: () => void;

  /** Register a callback invoked whenever entries change. */
  onUpdate(callback: () => void): void {
    this.onChange = callback;
  }

  private notify(): void {
    this.onChange?.();
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  /** Add a new foreground entry in "spawning" status. Returns the entry id. */
  add(agent: string, task: string, mode: LeaderSessionMode): number {
    const entry: LeaderEntry = {
      id: nextId++,
      agent,
      task: truncateTask(task),
      mode,
      status: "spawning",
      startedAt: new Date().toISOString(),
      source: "foreground",
    };
    this.entries.push(entry);
    this.notify();
    return entry.id;
  }

  /** Add an async run entry. Returns the entry id. */
  addAsync(run: LeaderAsyncRun): number {
    const existing = this.entries.find((e) => e.source === "async" && e.asyncRunId === run.id);
    if (existing) return existing.id;

    const entry: LeaderEntry = {
      id: nextId++,
      agent: run.agent,
      task: truncateTask(run.task),
      mode: run.mode,
      status: run.status === "running" ? "running" : (run.status as LeaderStatus),
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      exitCode: run.exitCode,
      source: "async",
      asyncRunId: run.id,
    };
    this.entries.push(entry);
    this.notify();
    return entry.id;
  }

  /** Transition an entry to "running". */
  markRunning(id: number): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry && entry.status === "spawning") {
      entry.status = "running";
      this.notify();
    }
  }

  /** Transition an entry to "completed". */
  markCompleted(id: number, exitCode: number): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry && (entry.status === "running" || entry.status === "spawning")) {
      entry.status = exitCode === 0 ? "completed" : "failed";
      entry.exitCode = exitCode;
      entry.completedAt = new Date().toISOString();
      this.notify();
    }
  }

  /** Transition an entry to "failed" (non-zero exit or unexpected error). */
  markFailed(id: number, exitCode?: number): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry && (entry.status === "running" || entry.status === "spawning")) {
      entry.status = "failed";
      entry.exitCode = exitCode;
      entry.completedAt = new Date().toISOString();
      this.notify();
    }
  }

  /** Transition an entry to "cancelled" (aborted by parent). */
  markCancelled(id: number): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry && (entry.status === "running" || entry.status === "spawning")) {
      entry.status = "cancelled";
      entry.completedAt = new Date().toISOString();
      this.notify();
    }
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  /** Get a snapshot of all current entries. */
  getAll(): readonly LeaderEntry[] {
    return this.entries;
  }

  /** Get an entry by id. */
  get(id: number): LeaderEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /** Whether any entry is still in a non-terminal state. */
  get hasActive(): boolean {
    return this.entries.some((e) => e.status === "spawning" || e.status === "running");
  }

  /** Remove all entries that have reached a terminal state. */
  pruneCompleted(): void {
    const terminalStatuses: LeaderStatus[] = ["completed", "failed", "cancelled"];
    const now = Date.now();
    const before = this.entries.length;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (terminalStatuses.includes(entry.status)) {
        // For async entries, only prune if they've been terminal for a while
        // so the user can see them complete even when no foreground work is happening.
        if (entry.source === "async" && entry.completedAt) {
          const terminalMs = now - new Date(entry.completedAt).getTime();
          if (terminalMs < ASYNC_TERMINAL_PRUNE_MS) continue;
        }
        this.entries.splice(i, 1);
      }
    }
    if (this.entries.length !== before) {
      this.notify();
    }
  }

  /** Remove all entries. */
  clear(): void {
    this.entries.length = 0;
    this.notify();
  }

  // ── Async Sync ────────────────────────────────────────────────────────────

  /**
   * Reconcile tracker entries with current async runs from disk.
   * Updates statuses for existing async entries and adds new ones.
   * Removes async entries for runs that no longer exist on disk.
   */
  syncAsyncRuns(runs: LeaderAsyncRun[]): void {
    const diskRunIds = new Set(runs.map((r) => r.id));

    let changed = false;

    // Remove tracker entries whose disk run no longer exists
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry.source === "async" && entry.asyncRunId && !diskRunIds.has(entry.asyncRunId)) {
        this.entries.splice(i, 1);
        changed = true;
      }
    }

    // Update existing entries and add new ones
    for (const run of runs) {
      const existing = this.entries.find((e) => e.source === "async" && e.asyncRunId === run.id);

      if (existing) {
        const newStatus = run.status === "running" ? "running" : (run.status as LeaderStatus);
        if (existing.status !== newStatus) {
          existing.status = newStatus;
          changed = true;
        }
        if (run.exitCode !== undefined && existing.exitCode !== run.exitCode) {
          existing.exitCode = run.exitCode;
          changed = true;
        }
        if (run.completedAt && !existing.completedAt) {
          existing.completedAt = run.completedAt;
          changed = true;
        }
      } else {
        // New async run not yet in tracker — add it
        this.entries.push({
          id: nextId++,
          agent: run.agent,
          task: truncateTask(run.task),
          mode: run.mode,
          status: run.status === "running" ? "running" : (run.status as LeaderStatus),
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          exitCode: run.exitCode,
          source: "async",
          asyncRunId: run.id,
        });
        changed = true;
      }
    }

    if (changed) {
      this.notify();
    }
  }
}
