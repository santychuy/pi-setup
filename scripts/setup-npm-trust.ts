#!/usr/bin/env bun

import { spawnSync } from "node:child_process";

const REPOSITORY = "santychuy/pi-setup";
const WORKFLOW_FILE = "release.yml";

function usage(exitCode = 1): never {
  console.error(`Usage: bun run npm:trust <package-name> [--otp <code>] [--dry-run]

Examples:
  bun run npm:trust pi-chime
  bun run npm:trust pi-chime --otp 123456
  bun run npm:trust pi-chime --dry-run`);
  process.exit(exitCode);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) usage(0);

const packageName = args.find((arg) => !arg.startsWith("-"));
const otpIndex = args.findIndex((arg) => arg === "--otp");
const otp = otpIndex >= 0 ? args[otpIndex + 1] : undefined;
const dryRun = args.includes("--dry-run");

if (!packageName || (otpIndex >= 0 && !otp)) usage();

function run(command: string, commandArgs: string[], options: { allowFailure?: boolean } = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: false,
  });

  if (!options.allowFailure && result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result.status ?? 1;
}

console.log(`Checking npm package: ${packageName}`);
run("npm", ["view", packageName, "version"]);

console.log(`\nExisting trusted publisher config, if any:`);
run("npm", ["trust", "list", packageName], { allowFailure: true });

const trustArgs = [
  "trust",
  "github",
  packageName,
  "--repo",
  REPOSITORY,
  "--file",
  WORKFLOW_FILE,
  "--yes",
];

if (otp) trustArgs.push("--otp", otp);
if (dryRun) trustArgs.push("--dry-run");

console.log(`\nConfiguring GitHub trusted publisher:`);
console.log(`  package: ${packageName}`);
console.log(`  repo:    ${REPOSITORY}`);
console.log(`  file:    ${WORKFLOW_FILE}`);

run("npm", trustArgs);

console.log(`\nDone.`);
console.log(`Review: https://www.npmjs.com/package/${encodeURIComponent(packageName)}/access`);
