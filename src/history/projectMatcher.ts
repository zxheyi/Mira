import { resolve } from "node:path";

export function normalizeProjectPath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function createProjectMatcher(projectRoot: string, rootAliases: string[] = []): (cwd?: string) => boolean {
  const accepted = new Set([projectRoot, ...rootAliases].map(normalizeProjectPath));
  return (cwd?: string) => cwd !== undefined && accepted.has(normalizeProjectPath(cwd));
}
