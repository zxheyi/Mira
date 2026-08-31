import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function repositoryLocation(rootPath: string): {
  rootPath: string; primaryRoot: string; repositoryKey?: string; workspaceTaskId?: string;
} {
  const root = resolve(rootPath);
  const marker = join(root, ".git");
  if (!existsSync(marker)) return { rootPath: root, primaryRoot: root };
  const linked = statSync(marker).isFile();
  const pointer = linked ? readFileSync(marker, "utf8").trim().match(/^gitdir:\s*(.+)$/)?.[1] : undefined;
  if (linked && !pointer) throw new Error(`Invalid Git worktree pointer: ${marker}`);
  const gitDir = realpathSync(linked ? resolve(root, pointer!) : marker);
  const commonFile = join(gitDir, "commondir");
  const common = existsSync(commonFile)
    ? realpathSync(resolve(gitDir, readFileSync(commonFile, "utf8").trim())) : gitDir;
  const identity = statSync(common, { bigint: true });
  const workspace = statSync(gitDir, { bigint: true });
  return {
    rootPath: root,
    primaryRoot: linked && common !== gitDir ? dirname(common) : root,
    repositoryKey: `git:${identity.dev}:${identity.ino}`,
    workspaceTaskId: linked && common !== gitDir ? `workspace:${workspace.dev}:${workspace.ino}` : undefined
  };
}

export function defaultProjectDatabase(rootPath: string): string {
  return join(repositoryLocation(rootPath).primaryRoot, ".mira", "mira.sqlite");
}
