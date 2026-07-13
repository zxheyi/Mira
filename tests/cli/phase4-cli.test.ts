import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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

describe("Phase 4 CLI commands", () => {
  test("runs the local memory loop and exports project data", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mira-cli-project-"));
    await mkdir(join(tempRoot, ".git"));
    const dbPath = join(tempRoot, ".mira", "mira.sqlite");
    const exportRoot = await mkdtemp(join(tmpdir(), "mira-cli-export-"));

    const init = parseJson<{ ok: boolean; project: { name: string; rootPath: string } }>(
      (await runMira(["init"], tempRoot, dbPath)).stdout
    );
    expect(init).toMatchObject({ ok: true, project: { rootPath: tempRoot } });

    const projectList = parseJson<Array<{ name: string; rootPath: string }>>(
      (await runMira(["project", "list"], tempRoot, dbPath)).stdout
    );
    expect(projectList).toEqual([expect.objectContaining({ rootPath: tempRoot })]);

    const thread = parseJson<{ id: string; rawFormat: string }>(
      (
        await runMira(
          [
            "thread",
            "save",
            "--id",
            "thread_cli",
            "--title",
            "CLI Session",
            "--source",
            "codex",
            "--format",
            "markdown",
            "--text",
            "## Key Decisions\n- CLI should provide JSON output."
          ],
          tempRoot,
          dbPath
        )
      ).stdout
    );
    expect(thread).toMatchObject({ id: "thread_cli", rawFormat: "markdown" });

    const distilled = parseJson<Array<{ kind: string; content: string }>>(
      (await runMira(["memory", "distill", "--thread", "thread_cli"], tempRoot, dbPath)).stdout
    );
    expect(distilled).toEqual([expect.objectContaining({ kind: "decision", content: "CLI should provide JSON output." })]);

    const manualMemory = parseJson<{ title: string; kind: string }>(
      (
        await runMira(
          [
            "memory",
            "add",
            "--title",
            "Manual preference",
            "--kind",
            "preference",
            "--content",
            "Keep command output script-friendly.",
            "--source",
            "manual",
            "--confidence",
            "1",
            "--importance",
            "7"
          ],
          tempRoot,
          dbPath
        )
      ).stdout
    );
    expect(manualMemory).toMatchObject({ title: "Manual preference", kind: "preference" });

    const search = parseJson<Array<{ memory: { title: string }; score: number }>>(
      (await runMira(["memory", "search", "--query", "script-friendly"], tempRoot, dbPath)).stdout
    );
    expect(search[0]).toMatchObject({ memory: { title: "Manual preference" } });
    expect(search[0]?.score).toEqual(expect.any(Number));

    const working = parseJson<{ kind: string; content: string }>(
      (
        await runMira(
          ["working", "set", "--kind", "current_task", "--content", "Finish Phase 4 CLI."],
          tempRoot,
          dbPath
        )
      ).stdout
    );
    expect(working).toMatchObject({ kind: "current_task", content: "Finish Phase 4 CLI." });

    const workingList = parseJson<Array<{ kind: string }>>(
      (await runMira(["working", "list"], tempRoot, dbPath)).stdout
    );
    expect(workingList).toEqual([expect.objectContaining({ kind: "current_task" })]);

    const bundle = (await runMira(["context", "bundle", "--query", "CLI"], tempRoot, dbPath)).stdout;
    expect(bundle.indexOf("## Working Memory")).toBeLessThan(bundle.indexOf("## Long-Term Memory"));
    expect(bundle).toContain("Finish Phase 4 CLI.");
    expect(bundle).toContain("CLI should provide JSON output.");

    const jsonExport = parseJson<{ files: string[] }>(
      (await runMira(["export", "--format", "json", "--out", exportRoot], tempRoot, dbPath)).stdout
    );
    expect(jsonExport.files.some((file) => file.endsWith("mira-export.json"))).toBe(true);
    const exportedJson = JSON.parse(await readFile(join(exportRoot, "mira-export.json"), "utf8")) as {
      memories: Array<{ title: string }>;
      workingMemory: Array<{ kind: string }>;
    };
    expect(exportedJson.memories).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Manual preference" })]));
    expect(exportedJson.workingMemory).toEqual([expect.objectContaining({ kind: "current_task" })]);

    const markdownExport = parseJson<{ files: string[] }>(
      (await runMira(["export", "--format", "markdown", "--out", exportRoot], tempRoot, dbPath)).stdout
    );
    expect(markdownExport.files.some((file) => file.endsWith("mira-export.md"))).toBe(true);
    expect(await readFile(join(exportRoot, "mira-export.md"), "utf8")).toContain("# Mira Export");
  });

  test("clears working memory through the CLI", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mira-cli-clear-"));
    const dbPath = join(tempRoot, ".mira", "mira.sqlite");
    await runMira(["init"], tempRoot, dbPath);
    await runMira(["working", "set", "--kind", "blocker", "--content", "Temporary blocker"], tempRoot, dbPath);

    const cleared = parseJson<{ ok: boolean }>(
      (await runMira(["working", "clear", "--kind", "blocker"], tempRoot, dbPath)).stdout
    );
    const afterClear = parseJson<unknown[]>((await runMira(["working", "list"], tempRoot, dbPath)).stdout);

    expect(cleared).toEqual({ ok: true });
    expect(afterClear).toEqual([]);
  });

  test("supports wm as an alias for working memory commands", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mira-cli-wm-"));
    const dbPath = join(tempRoot, ".mira", "mira.sqlite");
    await runMira(["init"], tempRoot, dbPath);

    const working = parseJson<{ kind: string; content: string }>(
      (await runMira(["wm", "set", "--kind", "current_task", "--content", "Use the wm alias."], tempRoot, dbPath))
        .stdout
    );

    expect(working).toMatchObject({ kind: "current_task", content: "Use the wm alias." });
  });

  test("prints a project root fallback warning when no git root is detected", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mira-cli-no-git-"));
    const dbPath = join(tempRoot, ".mira", "mira.sqlite");

    const result = await execFileAsync(
      join(repoRoot, "node_modules", ".bin", "tsx"),
      [join(repoRoot, "src", "index.ts"), "--db", dbPath, "init"],
      {
      cwd: tempRoot,
      env: { ...process.env, NO_COLOR: "1" }
      }
    );

    expect(result.stderr).toContain("No .git root found");
  });

  test("prints usage hints for custom CLI errors", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mira-cli-error-"));
    const dbPath = join(tempRoot, ".mira", "mira.sqlite");

    await expect(runMira(["thread", "save", "--id", "bad", "--title", "Bad", "--source", "codex"], tempRoot, dbPath))
      .rejects.toMatchObject({
        stderr: expect.stringContaining("Run 'mira thread save --help' for usage.")
      });
  });

  test("validates manual memory and thread inputs", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mira-cli-validation-"));
    const dbPath = join(tempRoot, ".mira", "mira.sqlite");

    await expect(
      runMira(
        ["memory", "add", "--title", "Bad", "--kind", "note", "--content", "", "--source", "manual"],
        tempRoot,
        dbPath
      )
    ).rejects.toMatchObject({ stderr: expect.stringContaining("Memory content is required") });

    await expect(
      runMira(
        [
          "memory",
          "add",
          "--title",
          "Bad",
          "--kind",
          "note",
          "--content",
          "Bad confidence",
          "--source",
          "manual",
          "--confidence",
          "999"
        ],
        tempRoot,
        dbPath
      )
    ).rejects.toMatchObject({ stderr: expect.stringContaining("confidence must be a number from 0 to 1") });

    await expect(
      runMira(
        [
          "thread",
          "save",
          "--id",
          "blank_thread",
          "--title",
          "Blank",
          "--source",
          "codex",
          "--format",
          "markdown",
          "--text",
          "   "
        ],
        tempRoot,
        dbPath
      )
    ).rejects.toMatchObject({ stderr: expect.stringContaining("Thread raw text is required") });


    await expect(
      runMira(
        ["memory", "add", "--title", "Bad", "--kind", "surprise", "--content", "Invalid kind", "--source", "manual"],
        tempRoot,
        dbPath
      )
    ).rejects.toMatchObject({ stderr: expect.stringContaining("Memory kind is unsupported") });

    await expect(
      runMira(["working", "set", "--kind", "surprise", "--content", "Invalid kind"], tempRoot, dbPath)
    ).rejects.toMatchObject({ stderr: expect.stringContaining("Working memory kind is unsupported") });


    await expect(
      runMira(
        ["thread", "save", "--id", "bad_format", "--title", "Bad", "--source", "codex", "--format", "plain", "--text", "summary"],
        tempRoot,
        dbPath
      )
    ).rejects.toMatchObject({ stderr: expect.stringContaining("Thread raw format must be markdown or jsonl") });

    await expect(
      runMira(["context", "bundle", "--memory-limit", "0"], tempRoot, dbPath)
    ).rejects.toMatchObject({ stderr: expect.stringContaining("memoryLimit must be a number from 1 to 50") });

    await expect(
      runMira(["context", "bundle", "--max-characters", "0"], tempRoot, dbPath)
    ).rejects.toMatchObject({ stderr: expect.stringContaining("maxCharacters must be a number from 1 to 1000000") });
  });


  test("supports compatible thread save and memory search arguments", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mira-cli-compat-"));
    const dbPath = join(tempRoot, ".mira", "mira.sqlite");
    const sessionPath = join(tempRoot, "session.md");
    await writeFile(sessionPath, "## Facts\n- CLI compatibility should be preserved.", "utf8");

    const thread = parseJson<{ id: string; rawFormat: string; rawText: string }>(
      (
        await runMira(
          [
            "thread",
            "save",
            "--id",
            "compat_thread",
            "--title",
            "Compat Thread",
            "--source",
            "codex",
            "--raw-format",
            "markdown",
            "--file",
            sessionPath
          ],
          tempRoot,
          dbPath
        )
      ).stdout
    );
    expect(thread).toMatchObject({
      id: "compat_thread",
      rawFormat: "markdown",
      rawText: "## Facts\n- CLI compatibility should be preserved."
    });

    await runMira(["memory", "distill", "--thread", "compat_thread"], tempRoot, dbPath);
    const search = parseJson<Array<{ memory: { kind: string; content: string } }>>(
      (await runMira(["memory", "search", "compatibility"], tempRoot, dbPath)).stdout
    );

    expect(search[0]).toMatchObject({
      memory: { kind: "fact", content: "CLI compatibility should be preserved." }
    });
  });
});
