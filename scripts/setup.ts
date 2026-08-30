#!/usr/bin/env bun

import {
  chmodSync,
  copyFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

interface BackupEntry {
  path: string;
  existed: boolean;
}

interface BackupManifest {
  createdAt: string;
  agentDir: string;
  repository: string;
  entries: BackupEntry[];
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const defaultAgentDirectory = resolve(join(homedir(), ".pi", "agent"));
const agentDirectory = resolve(process.env.PI_CODING_AGENT_DIR ?? defaultAgentDirectory);
const backupRoot = join(agentDirectory, "backups");
const controlledPaths = [
  "settings.json",
  "keybindings.json",
  "extensions",
  "skills",
  "themes",
  "packages/caveman-pi",
  "custom-header",
] as const;
const deployedResourcePaths = [
  "extensions",
  "skills",
  "themes",
  "packages/caveman-pi",
  "custom-header",
] as const;

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function validateAgentDirectory(allowCustomAgentDirectory: boolean): void {
  const forbiddenDirectories = new Set([
    resolve(parse(agentDirectory).root),
    resolve(homedir()),
    repositoryRoot,
  ]);
  if (forbiddenDirectories.has(agentDirectory)) {
    throw new Error(`Refusing unsafe Pi runtime directory: ${agentDirectory}`);
  }
  if (agentDirectory !== defaultAgentDirectory && !allowCustomAgentDirectory) {
    throw new Error(
      `Custom PI_CODING_AGENT_DIR requires --allow-custom-agent-dir: ${agentDirectory}`,
    );
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function hardenBackupTree(path: string): void {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) return;
  chmodSync(path, metadata.isDirectory() ? 0o700 : 0o600);
  if (!metadata.isDirectory()) return;
  for (const entry of readdirSync(path)) hardenBackupTree(join(path, entry));
}

function validateBackupManifest(manifest: BackupManifest): void {
  if (typeof manifest.agentDir !== "string" || resolve(manifest.agentDir) !== agentDirectory) {
    throw new Error(`Backup belongs to a different Pi directory: ${String(manifest.agentDir)}`);
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length !== controlledPaths.length) {
    throw new Error("Backup manifest does not contain the complete controlled-path set");
  }

  const allowedPaths = new Set<string>(controlledPaths);
  const seenPaths = new Set<string>();
  for (const entry of manifest.entries) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.path !== "string" ||
      typeof entry.existed !== "boolean" ||
      !allowedPaths.has(entry.path) ||
      seenPaths.has(entry.path)
    ) {
      throw new Error("Backup manifest contains an invalid, duplicate, or unsafe path");
    }
    seenPaths.add(entry.path);
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

function copyPath(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  const metadata = lstatSync(source);
  if (metadata.isDirectory()) {
    cpSync(source, destination, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    });
    return;
  }
  copyFileSync(source, destination);
}

function createBackup(): string {
  const createdAt = new Date().toISOString();
  const timestamp = createdAt.replace(/[:.]/g, "-");
  const backupDirectory = join(backupRoot, `pi-setup-${timestamp}`);
  const entries: BackupEntry[] = controlledPaths.map((path) => ({
    path,
    existed: pathExists(join(agentDirectory, path)),
  }));

  if (pathExists(backupRoot) && lstatSync(backupRoot).isSymbolicLink()) {
    throw new Error(`Backup root must not be a symlink: ${backupRoot}`);
  }
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  if (!lstatSync(backupRoot).isDirectory()) {
    throw new Error(`Backup root is not a directory: ${backupRoot}`);
  }
  chmodSync(backupRoot, 0o700);
  mkdirSync(backupDirectory, { recursive: false, mode: 0o700 });
  for (const entry of entries) {
    if (!entry.existed) continue;
    const backupPath = join(backupDirectory, "files", entry.path);
    copyPath(join(agentDirectory, entry.path), backupPath);
    hardenBackupTree(backupPath);
  }

  const manifest: BackupManifest = {
    createdAt,
    agentDir: agentDirectory,
    repository: repositoryRoot,
    entries,
  };
  writeJsonAtomic(join(backupDirectory, "manifest.json"), manifest);
  hardenBackupTree(backupDirectory);
  return backupDirectory;
}

function restoreBackup(backupDirectory: string): void {
  if (!pathExists(backupRoot)) throw new Error(`Backup root does not exist: ${backupRoot}`);
  const backupRootMetadata = lstatSync(backupRoot);
  if (backupRootMetadata.isSymbolicLink() || !backupRootMetadata.isDirectory()) {
    throw new Error(`Backup root must be a real directory: ${backupRoot}`);
  }

  const resolvedBackup = resolve(backupDirectory);
  const backupMetadata = lstatSync(resolvedBackup);
  if (backupMetadata.isSymbolicLink() || !backupMetadata.isDirectory()) {
    throw new Error("Backup path must be a real directory, not a symlink");
  }

  const realBackupRoot = realpathSync(backupRoot);
  const realBackupDirectory = realpathSync(resolvedBackup);
  if (!realBackupDirectory.startsWith(`${realBackupRoot}${sep}`)) {
    throw new Error(`Backup must be inside ${realBackupRoot}`);
  }

  const manifestPath = join(realBackupDirectory, "manifest.json");
  const manifestMetadata = lstatSync(manifestPath);
  if (manifestMetadata.isSymbolicLink() || !manifestMetadata.isFile()) {
    throw new Error("Backup manifest must be a real file, not a symlink");
  }
  const manifest = readJson<BackupManifest>(manifestPath);
  validateBackupManifest(manifest);

  for (const entry of manifest.entries) {
    if (!entry.existed) continue;
    const source = join(realBackupDirectory, "files", entry.path);
    if (!pathExists(source)) throw new Error(`Backup is incomplete: ${entry.path}`);
  }

  for (const entry of manifest.entries) {
    const destination = join(agentDirectory, entry.path);
    rmSync(destination, { recursive: true, force: true });
    if (entry.existed) {
      copyPath(join(realBackupDirectory, "files", entry.path), destination);
    }
  }
  console.log(`Restored Pi portable files from ${realBackupDirectory}`);
}

function ensureRepositoryReady(): void {
  const requiredPaths = [
    "package.json",
    "config/settings.json",
    "config/keybindings.json",
    "extensions/codex-limit.ts",
    "extensions/caveman/index.js",
    "skills/caveman/SKILL.md",
    "themes/santychuy-dark.json",
    "node_modules/@earendil-works/pi-coding-agent/package.json",
    "node_modules/typebox/package.json",
  ];
  const missing = requiredPaths.filter((path) => !pathExists(join(repositoryRoot, path)));
  if (missing.length > 0) {
    throw new Error(
      `Repository is not ready. Missing: ${missing.join(", ")}. Run bun install first.`,
    );
  }
}

function deploy(): string {
  ensureRepositoryReady();
  mkdirSync(agentDirectory, { recursive: true });

  const canonicalSettings = readJson<Record<string, unknown>>(
    join(repositoryRoot, "config", "settings.json"),
  );
  const existingSettingsPath = join(agentDirectory, "settings.json");
  const existingSettings = pathExists(existingSettingsPath)
    ? readJson<Record<string, unknown>>(existingSettingsPath)
    : {};
  const packages = canonicalSettings.packages;
  if (!Array.isArray(packages) || !packages.every((item) => typeof item === "string")) {
    throw new Error("config/settings.json must contain a string-only packages array");
  }

  const nextSettings = {
    ...existingSettings,
    ...canonicalSettings,
    packages: [...packages, repositoryRoot],
  };

  const backupDirectory = createBackup();
  try {
    writeJsonAtomic(existingSettingsPath, nextSettings);
    copyFileSync(
      join(repositoryRoot, "config", "keybindings.json"),
      join(agentDirectory, "keybindings.json"),
    );
    for (const path of deployedResourcePaths) {
      rmSync(join(agentDirectory, path), { recursive: true, force: true });
    }
    const packagesDirectory = join(agentDirectory, "packages");
    if (pathExists(packagesDirectory) && readdirSync(packagesDirectory).length === 0) {
      rmSync(packagesDirectory, { recursive: true, force: true });
    }
  } catch (error) {
    restoreBackup(backupDirectory);
    throw error;
  }

  return backupDirectory;
}

function printDryRun(): void {
  console.log(`Repository: ${repositoryRoot}`);
  console.log(`Pi runtime: ${agentDirectory}`);
  console.log("Would create a local backup and then:");
  console.log("- merge canonical settings and add this repository as a local Pi package");
  console.log("- deploy canonical keybindings");
  console.log(
    "- remove the complete live extensions, Pi-local skills, and themes directories, plus caveman-pi and custom-header artifacts",
  );
  console.log(
    "- leave auth, OAuth, sessions, caches, history, memory, installed packages, and ~/.agents untouched",
  );
}

const arguments_ = process.argv.slice(2);
const allowCustomAgentDirectory = arguments_.includes("--allow-custom-agent-dir");
validateAgentDirectory(allowCustomAgentDirectory);

const restoreIndex = arguments_.indexOf("--restore");
if (restoreIndex >= 0) {
  const backupDirectory = arguments_[restoreIndex + 1];
  if (!backupDirectory) throw new Error("Usage: bun run setup --restore <backup-directory>");
  restoreBackup(backupDirectory);
} else if (arguments_.includes("--dry-run")) {
  ensureRepositoryReady();
  printDryRun();
} else if (arguments_.includes("--yes")) {
  const backupDirectory = deploy();
  console.log("Canonical Pi setup deployed.");
  console.log(`Backup: ${backupDirectory}`);
  console.log("Next: bun run doctor");
} else {
  console.error(
    "Usage: bun run setup --dry-run | --yes | --restore <backup-directory> [--allow-custom-agent-dir]",
  );
  process.exitCode = 2;
}
