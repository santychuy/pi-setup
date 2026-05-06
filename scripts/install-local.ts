#!/usr/bin/env bun

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const resources = ["extensions", "skills", "prompts", "themes"] as const;

function usage(): never {
  console.error("Usage: bun run install:local <target-project> [--force]");
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

  cpSync(source, destination, {
    recursive: true,
    force: true,
    dereference: true,
    filter: (sourcePath) => !sourcePath.endsWith(".DS_Store"),
  });

  console.log(`Copied ${resource} -> ${destination}`);
}

console.log(`\nPi setup copied into ${targetPiDir}`);
console.log("Run `pi` from the target project and Pi will auto-discover these resources.");
