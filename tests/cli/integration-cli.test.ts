import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { ensureProjectForRoot } from "../../src/projects/projectStore.js";
import { listThreadsForProject } from "../../src/threads/threadStore.js";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

async function runMira(
  args: string[],
  projectRoot: string,
  dbPath: string,
  extraEnv: NodeJS.ProcessEnv = {}
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("npm", ["run", "dev", "--", "--db", dbPath, "--project-root", projectRoot, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv, NO_COLOR: "1" }
  });
}

async function runMiraHook(
  agent: "codex" | "claude-code",
  input: Record<string, unknown>,
  projectRoot: string,
  dbPath: string,
  extraEnv: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [
        join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"),
        join(repoRoot, "src", "index.ts"),
        "--db",
        dbPath,
        "--project-root",
        projectRoot,
        "integration",
        "hook",
        "--agent",
        agent,
        "--managed-by",
        "mira"
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, ...extraEnv, NO_COLOR: "1" },
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ stdout, stderr, code }));
    child.stdin.end(JSON.stringify(input));
  });
}

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? "");
}

describe("integration CLI", () => {
  test("installs, runs and uninstalls automatic Codex and Claude Code integration", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "mira-cli-integration-"));
    await mkdir(join(projectRoot, ".git"));
    const dbPath = join(projectRoot, ".mira", "mira.sqlite");
    const codexHome = await mkdtemp(join(tmpdir(), "mira-cli-codex-home-"));
    const claudeHome = await mkdtemp(join(tmpdir(), "mira-cli-claude-home-"));
    const codexSessions = join(codexHome, "sessions", "2026", "07", "17");
    const claudeProjects = join(claudeHome, "projects", "-tmp-project");
    await mkdir(codexSessions, { recursive: true });
    await mkdir(claudeProjects, { recursive: true });
    const env = { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome };

    const installed = parseJson<{ changes: Array<{ action: string }> }>(
      (await runMira(["integration", "install", "--agent", "all"], projectRoot, dbPath, env)).stdout
    );
    expect(installed.changes).toHaveLength(5);
    expect(installed.changes.every((change) => change.action === "created")).toBe(true);
    expect(await readFile(join(projectRoot, ".git", "info", "exclude"), "utf8")).toContain(
      ".claude/settings.local.json"
    );
    expect(await readFile(join(projectRoot, ".codex", "hooks.json"), "utf8")).toContain(
      "integration hook --agent codex"
    );
    expect(await readFile(join(projectRoot, ".claude", "settings.local.json"), "utf8")).toContain(
      "integration hook --agent claude-code"
    );

    const status = parseJson<{ codex: { installed: boolean }; claudeCode: { installed: boolean } }>(
      (await runMira(["integration", "status"], projectRoot, dbPath, env)).stdout
    );
    expect(status).toMatchObject({
      codex: { installed: true },
      claudeCode: { installed: true }
    });

    await runMira(
      ["working", "set", "--kind", "current_task", "--content", "Verify automatic integration."],
      projectRoot,
      dbPath,
      env
    );
    const start = await runMiraHook(
      "codex",
      {
        session_id: "cli-codex",
        transcript_path: null,
        cwd: projectRoot,
        hook_event_name: "SessionStart",
        source: "startup"
      },
      projectRoot,
      dbPath,
      env
    );
    expect(start.code).toBe(0);
    expect(start.stdout).toContain("Verify automatic integration.");

    const codexTranscript = join(codexSessions, "rollout-cli-codex.jsonl");
    await writeFile(codexTranscript, JSON.stringify({ role: "user", content: "Codex CLI auto capture." }), "utf8");
    const codexStop = await runMiraHook(
      "codex",
      {
        session_id: "cli-codex",
        transcript_path: codexTranscript,
        cwd: projectRoot,
        hook_event_name: "Stop"
      },
      projectRoot,
      dbPath,
      env
    );
    expect(codexStop).toMatchObject({ code: 0, stdout: "" });

    const claudeTranscript = join(claudeProjects, "cli-claude.jsonl");
    await writeFile(
      claudeTranscript,
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: "Claude CLI auto capture." }
      }),
      "utf8"
    );
    const claudeEnd = await runMiraHook(
      "claude-code",
      {
        session_id: "cli-claude",
        transcript_path: claudeTranscript,
        cwd: projectRoot,
        hook_event_name: "SessionEnd",
        reason: "other"
      },
      projectRoot,
      dbPath,
      env
    );
    expect(claudeEnd).toMatchObject({ code: 0, stdout: "" });

    const db = openDatabase(dbPath);
    migrate(db);
    const project = ensureProjectForRoot(db, projectRoot);
    expect(listThreadsForProject(db, project.id).map((thread) => thread.id)).toEqual([
      "thread_codex_cli_codex",
      "thread_claude_code_cli_claude"
    ]);
    db.close();

    const uninstalled = parseJson<{ changes: Array<{ action: string }> }>(
      (await runMira(["integration", "uninstall", "--agent", "all"], projectRoot, dbPath, env)).stdout
    );
    expect(uninstalled.changes.every((change) => change.action === "updated")).toBe(true);
    const finalStatus = parseJson<{ codex: { installed: boolean }; claudeCode: { installed: boolean } }>(
      (await runMira(["integration", "status"], projectRoot, dbPath, env)).stdout
    );
    expect(finalStatus).toMatchObject({
      codex: { installed: false },
      claudeCode: { installed: false }
    });
  }, 30_000);

  test("supports dry-run without creating integration files", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "mira-cli-integration-dry-"));
    await mkdir(join(projectRoot, ".git"));
    const dbPath = join(projectRoot, ".mira", "mira.sqlite");

    const result = parseJson<{ dryRun: boolean; changes: Array<{ action: string }> }>(
      (
        await runMira(
          ["integration", "install", "--agent", "all", "--dry-run"],
          projectRoot,
          dbPath
        )
      ).stdout
    );

    expect(result.dryRun).toBe(true);
    expect(result.changes.every((change) => change.action === "created")).toBe(true);
    await expect(readFile(join(projectRoot, ".codex", "hooks.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
