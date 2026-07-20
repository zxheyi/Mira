import { createReadStream } from "node:fs";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { isAbsolute, relative, resolve } from "node:path";

export function isPathWithin(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export async function existingRealPath(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function collectJsonlFiles(
  root: string,
  boundaryRoot: string,
  recursive: boolean
): Promise<string[]> {
  const rootReal = await existingRealPath(root);
  if (!rootReal || !isPathWithin(boundaryRoot, rootReal)) return [];

  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (recursive) files.push(...await collectJsonlFiles(path, boundaryRoot, true));
      continue;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!entry.name.toLowerCase().endsWith(".jsonl")) continue;

    const resolved = await existingRealPath(path);
    if (!resolved || !isPathWithin(boundaryRoot, resolved)) continue;
    const info = await lstat(path);
    if (info.isDirectory()) continue;
    files.push(path);
  }
  return files;
}

export async function readJsonlMetadata(
  filePath: string,
  inspect: (record: Record<string, unknown>) => { sessionId?: string; cwd?: string } | undefined
): Promise<{ sessionId?: string; cwd?: string; invalidJson: boolean }> {
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let invalidJson = false;
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of lines) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      invalidJson = true;
      continue;
    }
    if (typeof record !== "object" || record === null || Array.isArray(record)) continue;
    const metadata = inspect(record as Record<string, unknown>);
    if (!metadata) continue;
    sessionId ??= metadata.sessionId;
    cwd ??= metadata.cwd;
    if (sessionId && cwd) break;
  }

  return { sessionId, cwd, invalidJson };
}

export async function fileMetadata(filePath: string): Promise<{ size: number; mtimeMs: number }> {
  const info = await stat(filePath);
  return { size: info.size, mtimeMs: info.mtimeMs };
}
