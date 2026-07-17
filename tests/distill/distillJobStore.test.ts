import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import {
  claimNextDistillJob,
  completeDistillJob,
  enqueueDistillJob,
  failDistillJob,
  listDistillJobs,
  retryDistillJob
} from "../../src/distill/distillJobStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { saveThread } from "../../src/threads/threadStore.js";

let db: Database.Database | undefined;
afterEach(() => { db?.close(); db = undefined; });

function setup() {
  db = openDatabase(":memory:");
  migrate(db);
  const project = createProject(db, { name: "Mira", rootPath: "/workspace/mira-jobs" });
  saveThread(db, {
    id: "thread_jobs", projectId: project.id, title: "Jobs", source: "codex",
    rawFormat: "markdown", rawText: "Use a durable queue."
  });
  return { database: db, project };
}

describe("distill job store", () => {
  test("enqueues one job per thread content version", () => {
    const { database, project } = setup();
    const first = enqueueDistillJob(database, project.id, "thread_jobs", "hook");
    const duplicate = enqueueDistillJob(database, project.id, "thread_jobs", "hook");
    expect(duplicate).toEqual(first);

    saveThread(database, {
      id: "thread_jobs", projectId: project.id, title: "Jobs", source: "codex",
      rawFormat: "markdown", rawText: "Use a durable queue. Add retries."
    });
    const changed = enqueueDistillJob(database, project.id, "thread_jobs", "hook");
    expect(changed.id).not.toBe(first.id);
    expect(listDistillJobs(database, project.id)).toHaveLength(2);
  });

  test("claims, completes, fails, and retries jobs", () => {
    const { database, project } = setup();
    const queued = enqueueDistillJob(database, project.id, "thread_jobs", "cli");
    const claimed = claimNextDistillJob(database, project.id);
    expect(claimed).toMatchObject({ id: queued.id, status: "running", attempts: 1 });
    expect(claimNextDistillJob(database, project.id)).toBeUndefined();

    failDistillJob(
      database,
      queued.id,
      "Bearer secret-token-that-must-not-survive sk-proj-123456789012345678901234567890 " + "x".repeat(2_000)
    );
    const failed = listDistillJobs(database, project.id, "failed")[0];
    expect(failed?.lastError).not.toContain("secret-token");
    expect(failed?.lastError).not.toContain("sk-proj-");
    expect(failed?.lastError?.length).toBeLessThanOrEqual(500);

    retryDistillJob(database, project.id, queued.id);
    expect(claimNextDistillJob(database, project.id)?.attempts).toBe(2);
    completeDistillJob(database, queued.id);
    expect(listDistillJobs(database, project.id, "completed")[0]?.id).toBe(queued.id);
  });

  test("does not retry an active running job until its lease is stale", () => {
    const { database, project } = setup();
    const queued = enqueueDistillJob(database, project.id, "thread_jobs", "cli");
    claimNextDistillJob(database, project.id);

    expect(() => retryDistillJob(database, project.id, queued.id)).toThrow(/still running/);
    database.prepare("update distill_jobs set updated_at = ? where id = ?")
      .run("2026-07-17T00:00:00.000Z", queued.id);
    expect(retryDistillJob(database, project.id, queued.id).status).toBe("pending");
  });
});
