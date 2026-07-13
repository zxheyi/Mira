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

export type ProjectRootDetection = {
  rootPath: string;
  fellBack: boolean;
};

export async function detectProjectRootWithFallback(startDir: string): Promise<ProjectRootDetection> {
  const initialDir = resolve(startDir);
  let currentDir = initialDir;

  while (true) {
    if (await pathExists(join(currentDir, ".git"))) {
      return { rootPath: currentDir, fellBack: false };
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return { rootPath: initialDir, fellBack: true };
    }

    currentDir = parentDir;
  }
}

export async function detectProjectRoot(startDir: string): Promise<string> {
  return (await detectProjectRootWithFallback(startDir)).rootPath;
}
