/**
 * Leaders extension — shared utilities.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ── Paths ───────────────────────────────────────────────────────────────────

export const SESSION_DIR: string = path.join(os.homedir(), ".pi", "agent", "sessions", "leaders");
export const ASYNC_DIR: string = path.join(SESSION_DIR, "async");

export const makeSessionFile = (prefix = "leader"): string => {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  return path.join(SESSION_DIR, `${prefix}-${Date.now()}-${process.pid}-${randomUUID()}.jsonl`);
};

// ── Temp Files ───────────────────────────────────────────────────────────────

/**
 * Write a system prompt to a temp file and return the path.
 * Callers should clean up the file and directory when done.
 */
export const writePromptToTempFile = async (
  agentName: string,
  prompt: string,
): Promise<{ dir: string; filePath: string }> => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-leader-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  return { dir: tmpDir, filePath };
};

/**
 * Best-effort cleanup of temp prompt files.
 */
export const cleanupTempFile = (dir: string | null, filePath: string | null): void => {
  if (filePath) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  }
  if (dir) {
    try {
      fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
};

// ── Model Resolution ─────────────────────────────────────────────────────────

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const modelArg = ({ model }: ExtensionContext): string | undefined =>
  model?.provider && model.id ? `${model.provider}/${model.id}` : undefined;

// ── Constants ────────────────────────────────────────────────────────────────

export const CHILD_ENV = "PI_LEADERS_CHILD";
