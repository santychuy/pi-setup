import type { LeaderDelegationContract } from "./types.js";

export interface ContractValidationResult {
  ok: boolean;
  parsed?: Record<string, unknown>;
  error?: string;
}

const parseJsonObjectFromText = (text: string): Record<string, unknown> | undefined => {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

export const validateContractResult = (
  contract: LeaderDelegationContract,
  output: string,
): ContractValidationResult => {
  const parsed = parseJsonObjectFromText(output);
  if (!parsed) {
    return { ok: false, error: "Missing JSON object result" };
  }

  const hasTaskId = parsed.taskId === contract.taskId;
  const hasStatus = typeof parsed.status === "string";
  const hasSummary = typeof parsed.summary === "string";

  if (!hasTaskId || !hasStatus || !hasSummary) {
    return {
      ok: false,
      error: "Invalid contract result schema: required { taskId, status, summary }",
    };
  }

  return { ok: true, parsed };
};
