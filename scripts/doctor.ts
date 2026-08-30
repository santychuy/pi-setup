#!/usr/bin/env bun

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

interface CheckResult {
  level: "ok" | "warn" | "fail";
  message: string;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const agentDirectory = resolve(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"));
const repositoryOnly = process.argv.includes("--repo-only");
const results: CheckResult[] = [];

function add(level: CheckResult["level"], message: string): void {
  results.push({ level, message });
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasEntries(path: string): boolean {
  return existsSync(path) && lstatSync(path).isDirectory() && readdirSync(path).length > 0;
}

const requiredRepositoryPaths = [
  "package.json",
  "config/settings.json",
  "config/keybindings.json",
  "config/external-resources.json",
  "extensions/auto-session-name.ts",
  "extensions/caveman/index.js",
  "extensions/chill.ts",
  "extensions/codex-limit.ts",
  "extensions/custom-footer/index.ts",
  "extensions/custom-header.ts",
  "extensions/herdr-agent-state.ts",
  "extensions/herdr-context-sidebar.ts",
  "extensions/herdr-pi-sidebar-metadata.ts",
  "extensions/lm-studio.ts",
  "extensions/managed-tasks.ts",
  "extensions/modes.ts",
  "skills/caveman/SKILL.md",
  "skills/mermaid-diagrams/SKILL.md",
  "skills/subagent-authoring/SKILL.md",
  "themes/santychuy-dark.json",
];
const missingRepositoryPaths = requiredRepositoryPaths.filter(
  (path) => !existsSync(join(repositoryRoot, path)),
);
if (missingRepositoryPaths.length === 0) {
  add("ok", "canonical repository resources are present");
} else {
  add("fail", `missing repository resources: ${missingRepositoryPaths.join(", ")}`);
}

const retiredRepositoryPaths = [
  "extensions/guardrails.json",
  "themes/ghostty-sync-8d8d258c.json",
  "prompts",
  ".pi",
  ".codegraph",
  ".mcp.json",
  "opencode.jsonc",
  ".releaserc.json",
  "tsdown.config.ts",
];
const retainedRetiredPaths = retiredRepositoryPaths.filter((path) =>
  existsSync(join(repositoryRoot, path)),
);
if (retainedRetiredPaths.length === 0) {
  add("ok", "retired resources and monorepo machinery are absent");
} else {
  add("fail", `retired repository paths remain: ${retainedRetiredPaths.join(", ")}`);
}

const canonicalSettings = readJson<Record<string, unknown>>(
  join(repositoryRoot, "config", "settings.json"),
);
const canonicalPackages = canonicalSettings.packages;
if (
  !Array.isArray(canonicalPackages) ||
  !canonicalPackages.every((item) => typeof item === "string")
) {
  add("fail", "canonical packages must be a string-only array");
} else {
  const unpinned = canonicalPackages.filter((source) => {
    if (source.startsWith("npm:")) {
      const packagePart = source.slice(4);
      const versionSeparator = packagePart.lastIndexOf("@");
      return versionSeparator <= 0;
    }
    if (source.startsWith("git:")) return !/@[0-9a-f]{40}$/.test(source);
    return true;
  });
  if (unpinned.length === 0) add("ok", "external Pi packages are pinned");
  else add("fail", `unpinned package sources: ${unpinned.join(", ")}`);
}

if (!repositoryOnly) {
  const piVersion = spawnSync("pi", ["--version"], { encoding: "utf8" });
  if (piVersion.status === 0 && piVersion.stdout.trim() === "0.84.3") {
    add("ok", "Pi version is 0.84.3");
  } else {
    add("fail", `expected Pi 0.84.3, found ${piVersion.stdout.trim() || "unavailable"}`);
  }

  const liveSettingsPath = join(agentDirectory, "settings.json");
  if (!existsSync(liveSettingsPath)) {
    add("fail", `live settings are missing: ${liveSettingsPath}`);
  } else {
    const liveSettings = readJson<Record<string, unknown>>(liveSettingsPath);
    const managedKeys = Object.keys(canonicalSettings).filter((key) => key !== "packages");
    const driftedKeys = managedKeys.filter(
      (key) => !equal(liveSettings[key], canonicalSettings[key]),
    );
    if (driftedKeys.length === 0) add("ok", "managed live settings match the repository");
    else add("fail", `managed settings drift: ${driftedKeys.join(", ")}`);

    const expectedPackages = [
      ...(Array.isArray(canonicalPackages) ? canonicalPackages : []),
      repositoryRoot,
    ];
    if (equal(liveSettings.packages, expectedPackages)) {
      add("ok", "live Pi settings point to this repository and pinned packages");
    } else {
      add("fail", "live Pi package list does not match canonical settings");
    }
  }

  const duplicatePaths = ["extensions", "skills", "themes", "packages/caveman-pi", "custom-header"];
  const activeDuplicates = duplicatePaths.filter((path) => {
    const fullPath = join(agentDirectory, path);
    if (!existsSync(fullPath)) return false;
    return lstatSync(fullPath).isDirectory() ? hasEntries(fullPath) : true;
  });
  if (activeDuplicates.length === 0) {
    add("ok", "no live resource copies override the canonical package");
  } else {
    add("fail", `live resource copies can override the repository: ${activeDuplicates.join(", ")}`);
  }

  const globalSkills = join(homedir(), ".agents", "skills");
  if (hasEntries(globalSkills)) add("ok", "global ~/.agents/skills remains available");
  else add("warn", "global ~/.agents/skills is missing or empty");

  const forbiddenLiveFiles = [
    join(agentDirectory, "extensions", "guardrails.json"),
    join(agentDirectory, "themes", "ghostty-sync-8d8d258c.json"),
  ];
  if (forbiddenLiveFiles.every((path) => !existsSync(path))) {
    add("ok", "guardrails and ghostty-sync theme are not active");
  } else {
    add("fail", "guardrails or ghostty-sync theme remains active");
  }
}

for (const result of results) {
  const marker = result.level === "ok" ? "✓" : result.level === "warn" ? "!" : "✗";
  console.log(`${marker} ${result.message}`);
}

if (results.some((result) => result.level === "fail")) process.exitCode = 1;
