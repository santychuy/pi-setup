/**
 * Leaders extension — session file resolution.
 *
 * Centralizes how leader session modes map to Pi session files so
 * foreground and async runs cannot drift in behavior.
 */

import { SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { LeaderSessionMode } from "./types.js";
import { makeSessionFile } from "./utils.js";

export const FORK_SESSION_ERROR =
  "Cannot fork: parent session has no persisted file or no entries. Use persistent or ephemeral mode instead.";

export interface LeaderSessionResolution {
  sessionFile?: string;
  cleanupSessionFile?: boolean;
  error?: string;
}

/**
 * Create a branched session file from the parent's current context.
 * Returns the branched session file path on success, or undefined on failure.
 */
export const createForkedSessionFile = (ctx: ExtensionContext): string | undefined => {
  const parentFile = ctx.sessionManager.getSessionFile();
  if (!parentFile) return undefined;

  const leafId = ctx.sessionManager.getLeafId();
  if (!leafId) return undefined;

  try {
    const parentSession = SessionManager.open(parentFile);
    return parentSession.createBranchedSession(leafId) ?? undefined;
  } catch {
    return undefined;
  }
};

/** Resolve the session file, if any, for a leader run mode. */
export const resolveLeaderSessionFile = (
  ctx: ExtensionContext,
  mode: LeaderSessionMode,
  options: { persistentPrefix?: string } = {},
): LeaderSessionResolution => {
  if (mode === "ephemeral") return {};

  if (mode === "persistent") {
    return { sessionFile: makeSessionFile(options.persistentPrefix) };
  }

  const sessionFile = createForkedSessionFile(ctx);
  if (!sessionFile) return { error: FORK_SESSION_ERROR };

  return { sessionFile, cleanupSessionFile: mode === "ephemeral-fork" };
};
