import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

async function runMira(args: string[], projectRoot: string, dbPath: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("npm", ["run", "dev", "--", "--db", dbPath, "--project-root", projectRoot, ...args], {
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: "1" }
  });
}

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? "");
}

describe("LLM distill CLI", () => {
  test("prints a prompt for a saved thread", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mira-llm-prompt-"));
    await mkdir(join(tempRoot, ".git"));
    const dbPath = join(tempRoot, ".mira", "mira.sqlite");

    await runMira(
      [
        "thread",
        "save",
        "--id",
        "thread_llm",
        "--title",
        "LLM Session",
        "--source",
        "codex",
        "--format",
        "markdown",
        "--text",
        "## Summary\nMira should use reviewed LLM candidates."
      ],
      tempRoot,
      dbPath
    );

    const prompt = (await runMira(["memory", "llm-prompt", "--thread", "thread_llm"], tempRoot, dbPath)).stdout;

    expect(prompt).toContain("thread_llm");
    expect(prompt).toContain('"memories"');
    expect(prompt).toContain("Mira should use reviewed LLM candidates.");
  });

  test("applies candidate memories from a JSON file", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mira-llm-apply-"));
    await mkdir(join(tempRoot, ".git"));
    const dbPath = join(tempRoot, ".mira", "mira.sqlite");
    const candidatesPath = join(tempRoot, "candidates.json");

    await runMira(
      [
        "thread",
        "save",
        "--id",
        "thread_llm",
        "--title",
        "LLM Session",
        "--source",
        "claude-code",
        "--format",
        "markdown",
        "--text",
        "# LLM Session"
      ],
      tempRoot,
      dbPath
    );
    await writeFile(
      candidatesPath,
      JSON.stringify({
        memories: [
          {
            title: "Reviewed candidate flow",
            kind: "decision",
            content: "Mira applies reviewed LLM candidates from JSON.",
            confidence: 0.9,
            importance: 8
          }
        ]
      }),
      "utf8"
    );

    const applied = parseJson<Array<{ title: string; source: string }>>(
      (await runMira(["memory", "apply-candidates", "--thread", "thread_llm", "--path", candidatesPath], tempRoot, dbPath))
        .stdout
    );

    expect(applied).toEqual([
      expect.objectContaining({
        title: "Reviewed candidate flow",
        source: "llm-distill:thread_llm"
      })
    ]);
  });
});
