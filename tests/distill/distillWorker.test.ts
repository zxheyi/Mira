import { afterEach, describe, expect, test, vi } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { enqueueDistillJob, listDistillJobs } from "../../src/distill/distillJobStore.js";
import { runNextDistillJob } from "../../src/distill/distillWorker.js";
import { listMemoriesForProject } from "../../src/memory/memoryStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { saveThread } from "../../src/threads/threadStore.js";

let db: Database.Database | undefined;
afterEach(() => { db?.close(); db = undefined; });

function setup() {
  db = openDatabase(":memory:");
  migrate(db);
  const project = createProject(db, { name: "Mira", rootPath: "/workspace/mira-worker" });
  saveThread(db, {
    id: "thread_worker", projectId: project.id, title: "Worker", source: "codex",
    rawFormat: "markdown", rawText: "Use a one-shot worker for trusted distillation."
  });
  return { database: db, project };
}

describe("one-shot distill worker", () => {
  test("submits provider candidates through the trusted service and completes", async () => {
    const { database, project } = setup();
    enqueueDistillJob(database, project.id, "thread_worker", "cli");
    const provider = { distill: vi.fn(async () => [{
      title: "One-shot worker", kind: "fact" as const,
      content: "Use a one-shot worker for trusted distillation.",
      evidence: "Use a one-shot worker for trusted distillation.",
      confidence: 0.98, importance: 0.8
    }]) };

    const result = await runNextDistillJob(database, project.id, provider, "test-model");

    expect(result.status).toBe("completed");
    expect(listDistillJobs(database, project.id, "completed")).toHaveLength(1);
    expect(listMemoriesForProject(database, project.id)[0]).toMatchObject({ title: "One-shot worker" });
  });

  test("marks provider failures and returns idle when the queue is empty", async () => {
    const { database, project } = setup();
    expect((await runNextDistillJob(database, project.id, { distill: vi.fn() }, "model")).status).toBe("idle");
    enqueueDistillJob(database, project.id, "thread_worker", "cli");

    const result = await runNextDistillJob(database, project.id, {
      distill: vi.fn(async () => { throw new Error("provider unavailable"); })
    }, "model");

    expect(result.status).toBe("failed");
    expect(listDistillJobs(database, project.id, "failed")[0]?.lastError).toContain("provider unavailable");
  });

  test("does not send a Thread containing a detected secret to the Provider", async () => {
    const { database, project } = setup();
    saveThread(database, {
      id: "thread_worker", projectId: project.id, title: "Worker", source: "codex",
      rawFormat: "markdown", rawText: "Use key sk-proj-123456789012345678901234567890 for testing."
    });
    enqueueDistillJob(database, project.id, "thread_worker", "cli");
    const provider = { distill: vi.fn() };

    const result = await runNextDistillJob(database, project.id, provider, "model");

    expect(result.status).toBe("failed");
    expect(provider.distill).not.toHaveBeenCalled();
  });

  test("skips Provider output when the Thread changes during the request", async () => {
    const { database, project } = setup();
    enqueueDistillJob(database, project.id, "thread_worker", "cli");
    const provider = { distill: vi.fn(async () => {
      saveThread(database, {
        id: "thread_worker", projectId: project.id, title: "Worker", source: "codex",
        rawFormat: "markdown", rawText: "The Thread changed while the Provider was running."
      });
      return [{
        title: "Old result", kind: "fact" as const,
        content: "Use a one-shot worker for trusted distillation.",
        evidence: "Use a one-shot worker for trusted distillation.",
        confidence: 0.99, importance: 0.8
      }];
    }) };

    const result = await runNextDistillJob(database, project.id, provider, "model");

    expect(result.status).toBe("skipped_stale");
    expect(listMemoriesForProject(database, project.id)).toEqual([]);
  });
});
