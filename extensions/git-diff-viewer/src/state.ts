import type { ChangedFile, FileSnapshot } from "./types.js";

export type DiffViewerState = {
  baseline: Set<string>;
  lastRun: Map<string, ChangedFile>;
  snapshots: Map<string, FileSnapshot>;
};

export function createState(): DiffViewerState {
  return { baseline: new Set(), lastRun: new Map(), snapshots: new Map() };
}

export function setBaseline(state: DiffViewerState, files: ChangedFile[]): void {
  state.baseline = new Set(files.map((file) => file.path));
  state.lastRun.clear();
  state.snapshots.clear();
}

export function recordSnapshot(state: DiffViewerState, snapshot: FileSnapshot): void {
  state.snapshots.set(snapshot.path, snapshot);
  state.lastRun.set(snapshot.path, {
    path: snapshot.path,
    status: !snapshot.existedBefore ? "added" : !snapshot.existedAfter ? "deleted" : "modified",
  });
}

export function updateLastRunFromGit(state: DiffViewerState, files: ChangedFile[]): void {
  for (const file of files) {
    if (!state.baseline.has(file.path)) state.lastRun.set(file.path, file);
  }
}
