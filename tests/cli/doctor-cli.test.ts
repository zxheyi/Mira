import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { addMemory } from "../../src/memory/memoryStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { saveThread } from "../../src/threads/threadStore.js";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

async function runMira(args: string[], projectRoot: string, dbPath: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("npm", ["run", "dev", "--", "--db", dbPath, "--project-root", projectRoot, ...args], {
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: "1" }
  });
}

function parseLastJson<T>(stdout: string): T {
  const start = stdout.lastIndexOf("\n{");
  return JSON.parse(stdout.slice(start + 1).trim()) as T;
}

describe("doctor CLI", () => {
  test("reports a missing database without creating first-run files", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-doctor-missing-"));
    const dbPath = join(root, ".mira", "mira.sqlite");
    await mkdir(join(root, ".git"));

    const report = parseLastJson<{
      database: { exists: boolean; schemaVersion?: number };
      warnings: string[];
    }>((await runMira(["doctor"], root, dbPath)).stdout);

    expect(report.database.exists).toBe(false);
    expect(report.database.schemaVersion).toBeUndefined();
    expect(report.warnings).toEqual(expect.arrayContaining([
      "Mira database does not exist yet",
      "Codex integration is not installed",
      "Claude Code integration is not installed"
    ]));
    await expect(access(join(root, ".mira"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("reports database counts, integration status, and latest integration log timestamp", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-doctor-db-"));
    const dbPath = join(root, ".mira", "mira.sqlite");
    await mkdir(join(root, ".git"));
    await mkdir(join(root, ".mira"));
    await writeFile(
      join(root, ".mira", "integrations.log"),
      `${JSON.stringify({ timestamp: "2026-07-21T08:00:00.000Z", agent: "codex" })}\n`
    );

    const db = openDatabase(dbPath);
    migrate(db);
    const project = createProject(db, { name: "Mira", rootPath: root });
    saveThread(db, {
      id: "thread_codex_one",
      projectId: project.id,
      title: "Codex session one",
      source: "codex",
      rawFormat: "jsonl",
      rawText: "{}"
    });
    addMemory(db, {
      projectId: project.id,
      threadId: "thread_codex_one",
      title: "Use capacity filters",
      kind: "decision",
      content: "History import should be bounded before real usage.",
      source: "test",
      confidence: 0.9,
      importance: 8
    });
    db.close();

    const report = parseLastJson<{
      projectRoot: string;
      dbPath: string;
      database: {
        exists: boolean;
        schemaVersion: number;
        project?: { id: string; rootPath: string };
        counts: { projects: number; threads: number; memories: number; memoryCandidates: number; historyImportRuns: number };
      };
      integrations: { codex: { installed: boolean }; claudeCode: { installed: boolean } };
      integrationLog: { exists: boolean; latestTimestamp?: string };
      warnings: string[];
    }>((await runMira(["doctor"], root, dbPath)).stdout);

    expect(report).toMatchObject({
      projectRoot: root,
      dbPath,
      database: {
        exists: true,
        schemaVersion: 11,
        project: { id: project.id, rootPath: root },
        counts: { projects: 1, threads: 1, memories: 1, memoryCandidates: 0, historyImportRuns: 0 }
      },
      integrations: { codex: { installed: false }, claudeCode: { installed: false } },
      integrationLog: { exists: true, latestTimestamp: "2026-07-21T08:00:00.000Z" }
    });
    expect(report.warnings).toEqual(expect.arrayContaining([
      "Codex integration is not installed",
      "Claude Code integration is not installed"
    ]));
  });
});
