#!/usr/bin/env bun

import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { relative, resolve } from "node:path";

const resources = ["extensions", "skills", "prompts", "themes"] as const;

function usage(): never {
  console.error("Usage: bun run link:local <target-project> [--force]");
  process.exit(1);
}

const args = process.argv.slice(2);
const targetArg = args.find((arg) => !arg.startsWith("-"));
const force = args.includes("--force") || args.includes("-f");

if (!targetArg || args.includes("--help") || args.includes("-h")) usage();

const repoRoot = resolve(__dirname, "..");
const targetRoot = resolve(process.cwd(), targetArg);
const targetPiDir = resolve(targetRoot, ".pi");

if (!existsSync(targetRoot)) {
  console.error(`Target project does not exist: ${targetRoot}`);
  process.exit(1);
}

mkdirSync(targetPiDir, { recursive: true });

for (const resource of resources) {
  const source = resolve(repoRoot, resource);
  const destination = resolve(targetPiDir, resource);

  if (existsSync(destination)) {
    if (!force) {
      console.error(`Refusing to overwrite existing ${destination}. Re-run with --force.`);
      process.exit(1);
    }
    rmSync(destination, { recursive: true, force: true });
  }

  const relativeSource = relative(targetPiDir, source);
  symlinkSync(relativeSource, destination, "dir");
  console.log(`Linked ${resource} -> ${relativeSource}`);
}

console.log(`\nPi setup linked into ${targetPiDir}`);
console.log("Edits in this setup repo will be reflected in the target project immediately.");
