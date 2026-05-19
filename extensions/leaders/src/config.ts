import * as fs from "node:fs";
import * as path from "node:path";

import {
  DEFAULT_BUDGET_POLICY,
  MAX_AGENTS_PER_RUN_CAP,
  MAX_PARALLEL_CAP,
  type LeaderBudgetPolicy,
} from "./types.js";

type BudgetConfigFile = {
  budget?: Partial<LeaderBudgetPolicy["limits"]>;
};

let cachedCwd: string | null = null;
let cachedBudget: LeaderBudgetPolicy | null = null;

const toFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export function loadBudgetConfig(cwd: string): LeaderBudgetPolicy {
  if (cachedBudget && cachedCwd === cwd) {
    return cachedBudget;
  }

  const configPath = path.join(cwd, ".pi", "leaders.json");
  const fallback = {
    ...DEFAULT_BUDGET_POLICY,
    limits: { ...DEFAULT_BUDGET_POLICY.limits },
  } satisfies LeaderBudgetPolicy;

  if (!fs.existsSync(configPath)) {
    cachedCwd = cwd;
    cachedBudget = fallback;
    return cachedBudget;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as BudgetConfigFile;
    const budget = parsed?.budget;

    const merged: LeaderBudgetPolicy = {
      ...DEFAULT_BUDGET_POLICY,
      limits: {
        ...DEFAULT_BUDGET_POLICY.limits,
        ...(toFiniteNumber(budget?.maxDurationMs) !== undefined
          ? { maxDurationMs: toFiniteNumber(budget?.maxDurationMs) as number }
          : {}),
        ...(toFiniteNumber(budget?.maxTokensTotal) !== undefined
          ? { maxTokensTotal: toFiniteNumber(budget?.maxTokensTotal) }
          : {}),
        ...(toFiniteNumber(budget?.maxCostUsdTotal) !== undefined
          ? { maxCostUsdTotal: toFiniteNumber(budget?.maxCostUsdTotal) }
          : {}),
        ...(toFiniteNumber(budget?.maxDelegationDepth) !== undefined
          ? { maxDelegationDepth: toFiniteNumber(budget?.maxDelegationDepth) as number }
          : {}),
        ...(toFiniteNumber(budget?.maxAgentsPerRun) !== undefined
          ? {
              maxAgentsPerRun: Math.min(
                toFiniteNumber(budget?.maxAgentsPerRun) as number,
                MAX_AGENTS_PER_RUN_CAP,
              ),
            }
          : {}),
        ...(toFiniteNumber(budget?.maxParallel) !== undefined
          ? {
              maxParallel: Math.min(
                toFiniteNumber(budget?.maxParallel) as number,
                MAX_PARALLEL_CAP,
              ),
            }
          : {}),
      },
    };

    cachedCwd = cwd;
    cachedBudget = merged;
    return cachedBudget;
  } catch (error) {
    console.warn(
      `[leaders] Failed to parse ${configPath}. Falling back to default budget policy.`,
      error,
    );
    cachedCwd = cwd;
    cachedBudget = fallback;
    return cachedBudget;
  }
}

export function invalidateBudgetCache(): void {
  cachedCwd = null;
  cachedBudget = null;
}
