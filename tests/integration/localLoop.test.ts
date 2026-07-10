import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const sessionPath = join(repoRoot, "docs", "sessions", "019f45f0-40bf-7261-8685-d5e0a6a8bf13.md");

async function runMira(args: string[], projectRoot: string, dbPath: string) {
  return execFileAsync("npm", ["run", "dev", "--", "--db", dbPath, "--project-root", projectRoot, ...args], {
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 1024 * 1024 * 5
  });
}

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? "");
}

describe("local Mira loop", () => {
  test("imports the first real session and runs save-distill-search-working-bundle-export", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "mira-loop-project-"));
    await mkdir(join(projectRoot, ".git"));
    const dbPath = join(projectRoot, ".mira", "mira.sqlite");
    const outDir = await mkdtemp(join(tmpdir(), "mira-loop-export-"));
    const rawText = await readFile(sessionPath, "utf8");

    await runMira(["init"], projectRoot, dbPath);
    const saved = parseJson<{ id: string; rawFormat: string }>(
      (
        await runMira(
          [
            "thread",
            "save",
            "--id",
            "019f45f0-40bf-7261-8685-d5e0a6a8bf13",
            "--title",
            "分析 Rowboat 仿 Mem 可行性",
            "--source",
            "codex",
            "--format",
            "markdown",
            "--text",
            rawText
          ],
          projectRoot,
          dbPath
        )
      ).stdout
    );
    expect(saved).toMatchObject({ id: "019f45f0-40bf-7261-8685-d5e0a6a8bf13", rawFormat: "markdown" });

    const distilled = parseJson<Array<{ title: string; content: string }>>(
      (
        await runMira(
          ["memory", "distill", "--thread", "019f45f0-40bf-7261-8685-d5e0a6a8bf13"],
          projectRoot,
          dbPath
        )
      ).stdout
    );
    expect(distilled.length).toBeGreaterThan(3);
    expect(distilled.map((memory) => memory.content)).toEqual(
      expect.arrayContaining(["Product name: Mira.", "Core positioning: personal agent memory infrastructure for developer workflows."])
    );

    const search = parseJson<Array<{ memory: { content: string } }>>(
      (await runMira(["memory", "search", "--query", "SQLite"], projectRoot, dbPath)).stdout
    );
    expect(search.some((result) => result.memory.content.includes("SQLite"))).toBe(true);

    await runMira(
      ["working", "set", "--kind", "current_task", "--content", "Finish all MVP phases."],
      projectRoot,
      dbPath
    );
    const bundle = (await runMira(["context", "bundle", "--query", "Mira"], projectRoot, dbPath)).stdout;
    expect(bundle.indexOf("## Working Memory")).toBeLessThan(bundle.indexOf("## Long-Term Memory"));
    expect(bundle).toContain("Finish all MVP phases.");
    expect(bundle).toContain("Product name: Mira.");

    await runMira(["export", "--format", "json", "--out", outDir], projectRoot, dbPath);
    await runMira(["export", "--format", "markdown", "--out", outDir], projectRoot, dbPath);
    expect(await readFile(join(outDir, "mira-export.json"), "utf8")).toContain("Product name: Mira.");
    expect(await readFile(join(outDir, "mira-export.md"), "utf8")).toContain("# Mira Export");
  });
});
