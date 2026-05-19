import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

import { DEFAULT_AGENT } from "./types.js";
import type { LeaderAgentConfig, LeaderAgentDiscoveryResult, LeaderSessionMode } from "./types.js";

const USER_AGENTS_DIR = () => path.join(getAgentDir(), "leaders");

const loadAgentsFromDir = (
  dir: string,
  source: LeaderAgentConfig["source"],
): { agents: LeaderAgentConfig[]; errors: Array<{ path: string; error: string }> } => {
  const agents: LeaderAgentConfig[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  if (!fs.existsSync(dir)) return { agents, errors };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { agents, errors };
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      errors.push({ path: filePath, error: String(err) });
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
    if (!frontmatter.name || !frontmatter.description) continue;

    const tools = frontmatter.tools
      ?.split(",")
      .map((t: string) => t.trim())
      .filter(Boolean);

    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: tools && tools.length > 0 ? tools : undefined,
      model: frontmatter.model,
      systemPrompt: body,
      systemPromptMode: (frontmatter.systemPromptMode as "replace" | "append") ?? "replace",
      inheritProjectContext: frontmatter.inheritProjectContext === "true",
      inheritSkills: frontmatter.inheritSkills === "true",
      sessionMode: (frontmatter.sessionMode as LeaderSessionMode) ?? "ephemeral",
      source,
      filePath,
    });
  }

  return { agents, errors };
};

export const discoverLeaderAgents = (): LeaderAgentDiscoveryResult => {
  const builtinDir = path.join(__dirname, "..", "agents");
  const builtinResult = loadAgentsFromDir(builtinDir, "builtin");
  const userResult = loadAgentsFromDir(USER_AGENTS_DIR(), "user");

  const agentMap = new Map<string, LeaderAgentConfig>();
  agentMap.set(DEFAULT_AGENT.name, DEFAULT_AGENT);
  for (const agent of builtinResult.agents) agentMap.set(agent.name, agent);
  for (const agent of userResult.agents) agentMap.set(agent.name, agent);

  return {
    agents: Array.from(agentMap.values()),
    errors: [...builtinResult.errors, ...userResult.errors],
  };
};

export const resolveAgent = (
  agentName: string | undefined,
  discovery: LeaderAgentDiscoveryResult,
): LeaderAgentConfig | string => {
  if (!agentName) return DEFAULT_AGENT;

  const found = discovery.agents.find((a) => a.name === agentName);
  if (!found) {
    const available = discovery.agents.map((a) => a.name).join(", ");
    return `Unknown agent "${agentName}". Available: ${available}`;
  }

  return found;
};
