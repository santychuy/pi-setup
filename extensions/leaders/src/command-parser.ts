import type { LeaderSessionMode } from "./types.js";

const SESSION_FLAGS = ["--ephemeral", "--persistent", "--fork", "--ephemeral-fork"] as const;

export interface LeaderCommandInput {
  task: string;
  mode: LeaderSessionMode;
  agent?: string;
}

export const parseLeaderCommand = (args: string | undefined): LeaderCommandInput | string => {
  const tokens = args?.trim().split(/\s+/).filter(Boolean) ?? [];

  const flags = tokens.filter((t) => t.startsWith("--"));
  const nonFlags = tokens.filter((t) => !t.startsWith("--") && !t.startsWith("@"));
  const agentMentions = tokens.filter((t) => t.startsWith("@"));
  const agentName = agentMentions.length > 0 ? agentMentions[0].slice(1) : undefined;

  const modes = flags.filter((f) => SESSION_FLAGS.includes(f as (typeof SESSION_FLAGS)[number]));
  if (modes.length > 1) {
    return "Use only one mode flag: --ephemeral, --persistent, --fork, or --ephemeral-fork";
  }

  let mode: LeaderSessionMode = "ephemeral";
  if (modes.length === 1) {
    if (modes[0] === "--persistent") mode = "persistent";
    else if (modes[0] === "--fork") mode = "fork";
    else if (modes[0] === "--ephemeral-fork") mode = "ephemeral-fork";
  }

  const task = nonFlags.join(" ").trim();
  if (!task) {
    return "Usage: /leader [--ephemeral|--persistent|--fork|--ephemeral-fork] [@agent] <task>";
  }

  return { task, mode, agent: agentName };
};
