import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

function jsonl(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

async function runMira(
  args: string[],
  projectRoot: string,
  dbPath: string,
  env: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("npm", ["run", "dev", "--", "--db", dbPath, "--project-root", projectRoot, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env, NO_COLOR: "1" }
  });
}

function parseLastJson<T>(stdout: string): T {
  const start = stdout.lastIndexOf("\n{");
  const arrayStart = stdout.lastIndexOf("\n[");
  return JSON.parse(stdout.slice(Math.max(start, arrayStart) + 1).trim()) as T;
}

describe("history CLI", () => {
  test("imports Codex and Claude history, writes a report, and lists audit runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-history-cli-"));
    const oldRoot = join(root, "..", "AnchorMem");
    const dbPath = join(root, ".mira", "mira.sqlite");
    const codexHome = await mkdtemp(join(tmpdir(), "mira-history-cli-codex-"));
    const claudeHome = await mkdtemp(join(tmpdir(), "mira-history-cli-claude-"));
    const reportPath = join(root, "reports", "history.json");
    await mkdir(join(root, ".git"));
    await mkdir(join(codexHome, "sessions", "2026", "07"), { recursive: true });
    await mkdir(join(claudeHome, "projects", "-current"), { recursive: true });
    await mkdir(join(claudeHome, "projects", "-current", "subagents"), { recursive: true });
    await writeFile(join(codexHome, "sessions", "2026", "07", "codex.jsonl"), jsonl([
      { type: "session_meta", payload: { id: "codex-old", cwd: oldRoot } },
      { type: "response_item", payload: { role: "user", content: "Codex history." } }
    ]));
    await writeFile(join(claudeHome, "projects", "-current", "claude.jsonl"), jsonl([
      { sessionId: "claude-current", cwd: root, role: "user", content: "Claude history." }
    ]));
    await writeFile(join(claudeHome, "projects", "-current", "subagents", "sub.jsonl"), jsonl([
      { sessionId: "subagent", cwd: root, role: "user", content: "Do not import." }
    ]));
    const env = { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome };

    const imported = parseLastJson<{
      status: string; counts: { imported: number; failed: number }; items: Array<{ sessionId?: string }>
    }>((await runMira([
      "history", "import", "--root-alias", oldRoot, "--report", reportPath
    ], root, dbPath, env)).stdout);
    const runs = parseLastJson<Array<{ status: string; importedCount: number }>>(
      (await runMira(["history", "runs"], root, dbPath, env)).stdout
    );

    expect(imported).toMatchObject({ status: "completed", counts: { imported: 2, failed: 0 } });
    expect(imported.items.map((item) => item.sessionId).sort()).toEqual(["claude-current", "codex-old"]);
    expect(JSON.parse(await readFile(reportPath, "utf8"))).toMatchObject({ counts: { imported: 2 } });
    expect(runs[0]).toMatchObject({ status: "completed", importedCount: 2 });
  });

  test("returns exit code 2 after a file failure and exposes the failure reason", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-history-cli-failure-"));
    const dbPath = join(root, ".mira", "mira.sqlite");
    const codexHome = await mkdtemp(join(tmpdir(), "mira-history-cli-bad-codex-"));
    const path = join(codexHome, "sessions", "bad.jsonl");
    await mkdir(join(root, ".git"));
    await mkdir(join(codexHome, "sessions"), { recursive: true });
    await writeFile(path, jsonl([
      { type: "session_meta", payload: { id: "bad", cwd: root } }
    ]) + "\n{bad json");
    const env = { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: join(root, "missing-claude") };

    await expect(runMira(["history", "import", "--agent", "codex"], root, dbPath, env))
      .rejects.toMatchObject({ code: 2, stdout: expect.stringContaining('"failed":1') });
    const failures = parseLastJson<Array<{ filePath: string; errorStage: string; errorReason: string }>>(
      (await runMira(["history", "failures"], root, dbPath, env)).stdout
    );

    expect(failures).toEqual([
      expect.objectContaining({ filePath: path, errorStage: "parse", errorReason: expect.stringContaining("line 2") })
    ]);
  });

  test("bounds history import with date, size, and limit CLI filters", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-history-cli-filter-"));
    const dbPath = join(root, ".mira", "mira.sqlite");
    const codexHome = await mkdtemp(join(tmpdir(), "mira-history-cli-filter-codex-"));
    await mkdir(join(root, ".git"));
    await mkdir(join(codexHome, "sessions"), { recursive: true });

    const small = join(codexHome, "sessions", "01-small.jsonl");
    const limited = join(codexHome, "sessions", "02-limited.jsonl");
    const before = join(codexHome, "sessions", "03-before.jsonl");
    const after = join(codexHome, "sessions", "04-after.jsonl");
    const large = join(codexHome, "sessions", "05-large.jsonl");
    await writeFile(small, jsonl([
      { type: "session_meta", payload: { id: "small", cwd: root } },
      { type: "response_item", payload: { role: "user", content: "Small July session." } }
    ]));
    await writeFile(limited, jsonl([
      { type: "session_meta", payload: { id: "limited", cwd: root } },
      { type: "response_item", payload: { role: "user", content: "Second July session." } }
    ]));
    await writeFile(before, jsonl([
      { type: "session_meta", payload: { id: "before", cwd: root } },
      { type: "response_item", payload: { role: "user", content: "June session." } }
    ]));
    await writeFile(after, jsonl([
      { type: "session_meta", payload: { id: "after", cwd: root } },
      { type: "response_item", payload: { role: "user", content: "August session." } }
    ]));
    await writeFile(large, jsonl([
      { type: "session_meta", payload: { id: "large", cwd: root } },
      { type: "response_item", payload: { role: "user", content: "x".repeat(4_000) } }
    ]));
    await utimes(small, new Date("2026-07-10T00:00:00.000Z"), new Date("2026-07-10T00:00:00.000Z"));
    await utimes(limited, new Date("2026-07-11T00:00:00.000Z"), new Date("2026-07-11T00:00:00.000Z"));
    await utimes(before, new Date("2026-06-30T00:00:00.000Z"), new Date("2026-06-30T00:00:00.000Z"));
    await utimes(after, new Date("2026-08-01T00:00:00.000Z"), new Date("2026-08-01T00:00:00.000Z"));
    await utimes(large, new Date("2026-07-12T00:00:00.000Z"), new Date("2026-07-12T00:00:00.000Z"));

    const result = parseLastJson<{
      dryRun: boolean;
      counts: { imported: number; skipped: number };
      summary: { matchedCount: number; skippedByDateCount: number; skippedBySizeCount: number; limitedCount: number };
    }>((await runMira([
      "history", "import", "--agent", "codex", "--dry-run",
      "--since", "2026-07-01", "--until", "2026-07-31", "--max-file-size", "0.001", "--limit", "1"
    ], root, dbPath, { CODEX_HOME: codexHome })).stdout);

    expect(result).toMatchObject({
      dryRun: true,
      counts: { imported: 1, skipped: 4 },
      summary: { matchedCount: 2, skippedByDateCount: 2, skippedBySizeCount: 1, limitedCount: 1 }
    });
    await expect(access(dbPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("does not create a database during a first-run dry-run", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-history-cli-dry-"));
    const dbPath = join(root, ".mira", "mira.sqlite");
    const codexHome = await mkdtemp(join(tmpdir(), "mira-history-cli-dry-codex-"));
    await mkdir(join(root, ".git"));
    await mkdir(join(codexHome, "sessions"), { recursive: true });
    await writeFile(join(codexHome, "sessions", "dry.jsonl"), jsonl([
      { type: "session_meta", payload: { id: "dry", cwd: root } },
      { type: "response_item", payload: { role: "user", content: "Preview." } }
    ]));

    const result = parseLastJson<{ dryRun: boolean; counts: { imported: number } }>(
      (await runMira(["history", "import", "--agent", "codex", "--dry-run"], root, dbPath, {
        CODEX_HOME: codexHome
      })).stdout
    );

    expect(result).toMatchObject({ dryRun: true, counts: { imported: 1 } });
    await expect(access(dbPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("does not migrate an existing legacy database during dry-run", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-history-cli-legacy-dry-"));
    const dbPath = join(root, ".mira", "mira.sqlite");
    const codexHome = await mkdtemp(join(tmpdir(), "mira-history-cli-empty-codex-"));
    await mkdir(join(root, ".git"));
    await mkdir(join(root, ".mira"));
    const legacy = new Database(dbPath);
    legacy.exec(`
      create table schema_version (version integer primary key, applied_at text not null);
      insert into schema_version values (5, '2026-07-20T00:00:00.000Z');
      create table projects (id text primary key, name text not null, root_path text not null unique, created_at text not null);
      insert into projects values ('project_legacy', 'Mira', '${root.replaceAll("'", "''")}', '2026-07-20T00:00:00.000Z');
    `);
    legacy.close();

    await runMira(["history", "import", "--agent", "codex", "--dry-run"], root, dbPath, {
      CODEX_HOME: codexHome
    });

    const unchanged = new Database(dbPath, { readonly: true });
    expect(unchanged.prepare("select max(version) from schema_version").pluck().get()).toBe(5);
    expect(unchanged.prepare(
      "select count(*) from sqlite_master where type = 'table' and name = 'history_import_runs'"
    ).pluck().get()).toBe(0);
    unchanged.close();
  });
});
