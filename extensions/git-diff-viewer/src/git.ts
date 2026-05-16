import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ChangedFile } from "./types.js";
import { stripGitQuotes } from "./path.js";

export function parseGitStatus(output: string): ChangedFile[] {
  const files = new Map<string, ChangedFile>();

  for (const line of output.split("\n")) {
    if (line.length < 4) continue;

    const index = line[0] ?? " ";
    const worktree = line[1] ?? " ";
    const raw = line.slice(3).trim();
    if (!raw) continue;

    const [oldRaw, newRaw] = raw.includes(" -> ") ? raw.split(" -> ") : [undefined, raw];
    const filePath = stripGitQuotes(newRaw ?? raw);
    const oldPath = oldRaw ? stripGitQuotes(oldRaw) : undefined;

    let status: ChangedFile["status"] = "modified";
    if (index === "?" && worktree === "?") status = "untracked";
    else if (index === "A" || worktree === "A") status = "added";
    else if (index === "D" || worktree === "D") status = "deleted";
    else if (index === "R" || worktree === "R") status = "renamed";

    files.set(filePath, { path: filePath, oldPath, status });
  }

  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function getChangedFiles(
  pi: ExtensionAPI,
  cwd: string,
  staged = false,
): Promise<ChangedFile[]> {
  const args = staged
    ? ["diff", "--name-status", "--cached"]
    : ["status", "--porcelain=v1", "--untracked-files=all"];
  const result = await pi.exec("git", args, { cwd, timeout: 5000 });
  if (result.code !== 0) return [];

  if (!staged) return parseGitStatus(result.stdout);

  return result.stdout
    .split("\n")
    .map((line): ChangedFile | undefined => {
      const [statusCode, ...parts] = line.trim().split(/\s+/);
      const filePath = parts.at(-1);
      if (!statusCode || !filePath) return undefined;
      return {
        path: stripGitQuotes(filePath),
        oldPath: parts.length > 1 ? stripGitQuotes(parts[0] ?? "") : undefined,
        status: statusCode.startsWith("A")
          ? "added"
          : statusCode.startsWith("D")
            ? "deleted"
            : statusCode.startsWith("R")
              ? "renamed"
              : "modified",
      };
    })
    .filter((file): file is ChangedFile => Boolean(file))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function readHeadFile(
  pi: ExtensionAPI,
  cwd: string,
  filePath: string,
): Promise<string | undefined> {
  const result = await pi.exec("git", ["show", `HEAD:${filePath}`], { cwd, timeout: 5000 });
  return result.code === 0 ? result.stdout : undefined;
}

export async function getUnifiedDiff(
  pi: ExtensionAPI,
  cwd: string,
  filePath?: string,
  staged = false,
): Promise<string> {
  const args = ["diff", "--no-ext-diff", "--", ...(filePath ? [filePath] : [])];
  if (staged) args.splice(1, 0, "--cached");
  const result = await pi.exec("git", args, { cwd, timeout: 10000 });
  return result.code === 0 ? result.stdout : result.stderr;
}
