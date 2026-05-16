import path from "node:path";

export function toAbsolute(cwd: string, filePath: string): string {
  return path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(cwd, filePath);
}

export function toRelative(cwd: string, filePath: string): string {
  const relative = path.relative(cwd, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : filePath;
}

export function stripGitQuotes(value: string): string {
  return value.replace(/^"|"$/g, "");
}
