/**
 * Leaders extension — in-memory subagent state tracker.
 *
 * Tracks the lifecycle of foreground leader runs so that the TUI
 * widget can display real-time status above the editor.
 *
 * States: spawning → running → completed | failed | cancelled
 */

import type { LeaderSessionMode } from "./types.js";

// ── Leader Entry ────────────────────────────────────────────────────────────

export type LeaderStatus = "spawning" | "running" | "completed" | "failed" | "cancelled";

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
}

// ── Tracker ──────────────────────────────────────────────────────────────────

const MAX_TASK_DISPLAY_LENGTH = 60;

let nextId = 1;

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

  /** Add a new entry in "spawning" status. Returns the entry id. */
  add(agent: string, task: string, mode: LeaderSessionMode): number {
    const entry: LeaderEntry = {
      id: nextId++,
      agent,
      task:
        task.length > MAX_TASK_DISPLAY_LENGTH
          ? `${task.slice(0, MAX_TASK_DISPLAY_LENGTH - 3)}...`
          : task,
      mode,
      status: "spawning",
      startedAt: new Date().toISOString(),
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
    const before = this.entries.length;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (terminalStatuses.includes(this.entries[i].status)) {
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
}
