import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { detectProjectRoot, detectProjectRootWithFallback } from "../../src/projects/projectRoot.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mira-project-root-"));
}

describe("detectProjectRoot", () => {
  test("finds the nearest parent directory containing .git", async () => {
    const root = await makeTempDir();
    const appRoot = join(root, "packages", "app");
    const nested = join(appRoot, "src");
    await mkdir(join(root, ".git"));
    await mkdir(join(appRoot, ".git"), { recursive: true });
    await mkdir(nested, { recursive: true });

    expect(await detectProjectRoot(nested)).toBe(appRoot);
  });

  test("falls back to the start directory when no .git parent exists", async () => {
    const root = await makeTempDir();
    const nested = join(root, "notes", "drafts");
    await mkdir(nested, { recursive: true });

    expect(await detectProjectRoot(nested)).toBe(nested);
  });

  test("reports whether project root detection fell back to the start directory", async () => {
    const root = await makeTempDir();
    const nested = join(root, "notes", "drafts");
    await mkdir(nested, { recursive: true });

    expect(await detectProjectRootWithFallback(nested)).toEqual({
      rootPath: nested,
      fellBack: true
    });
  });
});
