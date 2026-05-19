import type { LeaderUsageStats } from "./types.js";

export const zeroUsage = (): LeaderUsageStats => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  contextTokens: 0,
  turns: 0,
});

export const addUsage = (base: LeaderUsageStats, extra: LeaderUsageStats): LeaderUsageStats => ({
  input: base.input + extra.input,
  output: base.output + extra.output,
  cacheRead: base.cacheRead + extra.cacheRead,
  cacheWrite: base.cacheWrite + extra.cacheWrite,
  cost: base.cost + extra.cost,
  contextTokens: base.contextTokens + extra.contextTokens,
  turns: base.turns + extra.turns,
});
