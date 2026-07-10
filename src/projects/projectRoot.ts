import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function detectProjectRoot(startDir: string): Promise<string> {
  const initialDir = resolve(startDir);
  let currentDir = initialDir;

  while (true) {
    if (await pathExists(join(currentDir, ".git"))) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return initialDir;
    }

    currentDir = parentDir;
  }
}
