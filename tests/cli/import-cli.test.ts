import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

type CliResult = {
  stdout: string;
  stderr: string;
};

async function runMira(args: string[], projectRoot: string, dbPath: string): Promise<CliResult> {
  return execFileAsync("npm", ["run", "dev", "--", "--db", dbPath, "--project-root", projectRoot, ...args], {
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: "1" }
  });
}

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? "");
}

describe("import CLI", () => {
  test("imports a Codex Markdown session as a thread", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mira-codex-import-"));
    await mkdir(join(tempRoot, ".git"));
    const dbPath = join(tempRoot, ".mira", "mira.sqlite");
    const sessionPath = join(tempRoot, "codex-session.md");
    await writeFile(sessionPath, "# Codex Session\n\n## Key Decisions\n- Import Markdown sessions first.", "utf8");

    const imported = parseJson<{ id: string; source: string; rawFormat: string; title: string; rawText: string }>(
      (await runMira(["import", "--source", "codex", "--path", sessionPath], tempRoot, dbPath)).stdout
    );

    expect(imported).toMatchObject({
      source: "codex",
      rawFormat: "markdown",
      title: "Codex Session",
      rawText: "# Codex Session\n\n## Key Decisions\n- Import Markdown sessions first."
    });
    expect(imported.id).toMatch(/^codex_/);
  });

  test("imports a Claude Code Markdown session and keeps it usable for distill and search", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mira-claude-import-"));
    await mkdir(join(tempRoot, ".git"));
    const dbPath = join(tempRoot, ".mira", "mira.sqlite");
    const sessionPath = join(tempRoot, "claude-session.md");
    await writeFile(
      sessionPath,
      "# Claude Code Session\n\n## Key Decisions\n- Claude Code sessions use the shared importer.",
      "utf8"
    );

    const imported = parseJson<{ id: string; source: string }>(
      (
        await runMira(
          ["import", "--source", "claude-code", "--path", sessionPath, "--id", "claude_import_1"],
          tempRoot,
          dbPath
        )
      ).stdout
    );
    expect(imported).toMatchObject({ id: "claude_import_1", source: "claude-code" });

    const distilled = parseJson<Array<{ kind: string; content: string }>>(
      (await runMira(["memory", "distill", "--thread", "claude_import_1"], tempRoot, dbPath)).stdout
    );
    expect(distilled).toEqual([
      expect.objectContaining({ kind: "decision", content: "Claude Code sessions use the shared importer." })
    ]);

    const search = parseJson<Array<{ memory: { content: string }; score: number }>>(
      (await runMira(["memory", "search", "--query", "shared importer"], tempRoot, dbPath)).stdout
    );
    expect(search[0]).toMatchObject({
      memory: { content: "Claude Code sessions use the shared importer." },
      score: expect.any(Number)
    });
  });
});
