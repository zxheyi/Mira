import { execFile } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { submitMemoryCandidates } from "../../src/distill/candidateService.js";
import { claimNextDistillJob, failDistillJob } from "../../src/distill/distillJobStore.js";
import { ensureProjectForRoot } from "../../src/projects/projectStore.js";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

async function runMira(args: string[], projectRoot: string, dbPath: string) {
  return execFileAsync("npm", ["run", "dev", "--", "--db", dbPath, "--project-root", projectRoot, ...args], {
    cwd: repoRoot,
    env: { ...process.env, NO_COLOR: "1" }
  });
}

function json<T>(stdout: string): T {
  return JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? "");
}

describe("trusted distill CLI", () => {
  test("enqueues and lists jobs, then lists and reviews candidates", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-trusted-distill-"));
    await mkdir(join(root, ".git"));
    const dbPath = join(root, ".mira", "mira.sqlite");
    await runMira([
      "thread", "save", "--id", "thread_cli_candidate", "--title", "Candidate CLI",
      "--source", "codex", "--format", "markdown",
      "--text", "Architecture changes require explicit review."
    ], root, dbPath);

    const enqueued = json<{ status: string }>((await runMira([
      "distill", "jobs", "enqueue", "--thread", "thread_cli_candidate"
    ], root, dbPath)).stdout);
    expect(enqueued.status).toBe("pending");
    const jobs = json<Array<{ id: string }>>((await runMira([
      "distill", "jobs", "list", "--status", "pending"
    ], root, dbPath)).stdout);
    expect(jobs).toHaveLength(1);

    const db = openDatabase(dbPath);
    migrate(db);
    const project = ensureProjectForRoot(db, root);
    const claimed = claimNextDistillJob(db, project.id);
    if (!claimed) throw new Error("Expected queued job");
    failDistillJob(db, claimed.id, "retry from CLI");
    db.close();
    const retried = json<{ status: string }>((await runMira([
      "distill", "jobs", "retry", "--id", claimed.id
    ], root, dbPath)).stdout);
    expect(retried.status).toBe("pending");

    const candidateDb = openDatabase(dbPath);
    migrate(candidateDb);
    const candidateProject = ensureProjectForRoot(candidateDb, root);
    submitMemoryCandidates(candidateDb, {
      projectId: candidateProject.id,
      threadId: "thread_cli_candidate",
      sourceAgent: "codex",
      extractionMethod: "agent",
      candidates: [{
        title: "Architecture review", kind: "architecture",
        content: "Architecture changes require explicit review.",
        evidence: "Architecture changes require explicit review.",
        confidence: 0.99, importance: 0.9
      }]
    });
    candidateDb.close();

    const candidates = json<Array<{ id: string; status: string }>>((await runMira([
      "memory", "candidate", "list", "--status", "pending_review"
    ], root, dbPath)).stdout);
    expect(candidates).toHaveLength(1);
    const reviewed = json<{ outcome: string; memory: { title: string } }>((await runMira([
      "memory", "candidate", "review", "--id", candidates[0]!.id,
      "--decision", "accept", "--reason", "Confirmed"
    ], root, dbPath)).stdout);
    expect(reviewed).toMatchObject({ outcome: "accepted", memory: { title: "Architecture review" } });
  }, 30_000);

  test("rejects invalid job and candidate enum options", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-trusted-distill-invalid-"));
    await mkdir(join(root, ".git"));
    const dbPath = join(root, ".mira", "mira.sqlite");
    await expect(runMira(["distill", "jobs", "list", "--status", "unknown"], root, dbPath))
      .rejects.toMatchObject({ stderr: expect.stringContaining("status") });
    await expect(runMira([
      "memory", "candidate", "review", "--id", "candidate_1", "--decision", "delete"
    ], root, dbPath)).rejects.toMatchObject({ stderr: expect.stringContaining("decision") });
  }, 30_000);
});
