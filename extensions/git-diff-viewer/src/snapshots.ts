import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readHeadFile } from "./git.js";
import { toAbsolute } from "./path.js";
import type { ChangedFile, FileSnapshot } from "./types.js";

const tempFiles = new Set<string>();

async function readText(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

export async function createToolSnapshot(
  cwd: string,
  filePath: string,
): Promise<() => Promise<FileSnapshot>> {
  const absolute = toAbsolute(cwd, filePath);
  const oldContent = await readText(absolute);
  return async (): Promise<FileSnapshot> => {
    const newContent = await readText(absolute);
    return {
      path: filePath,
      oldContent: oldContent ?? "",
      newContent: newContent ?? "",
      existedBefore: oldContent !== undefined,
      existedAfter: newContent !== undefined,
    };
  };
}

export async function createGitSnapshot(
  pi: ExtensionAPI,
  cwd: string,
  file: ChangedFile,
): Promise<FileSnapshot> {
  const absolute = toAbsolute(cwd, file.path);
  const current = await readText(absolute);
  const headPath = file.oldPath ?? file.path;
  const fromHead =
    file.status === "untracked" || file.status === "added"
      ? undefined
      : await readHeadFile(pi, cwd, headPath);

  return {
    path: file.path,
    oldContent: fromHead ?? "",
    newContent: current ?? "",
    existedBefore: fromHead !== undefined,
    existedAfter: current !== undefined,
  };
}

export async function writeTempSnapshot(label: string, content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-git-diff-viewer-"));
  const safeLabel = label.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(dir, safeLabel || "snapshot.txt");
  await fs.writeFile(filePath, content, "utf8");
  tempFiles.add(filePath);
  return filePath;
}

export async function cleanupTempSnapshots(): Promise<void> {
  const dirs = new Set([...tempFiles].map((file) => path.dirname(file)));
  tempFiles.clear();
  await Promise.all(
    [...dirs].map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
}
