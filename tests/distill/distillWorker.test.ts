import { afterEach, describe, expect, test, vi } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { claimNextDistillJob, enqueueDistillJob, listDistillJobs } from "../../src/distill/distillJobStore.js";
import { drainDistillJobs, runNextDistillJob } from "../../src/distill/distillWorker.js";
import { RetryableProviderError } from "../../src/distill/openAiCompatibleProvider.js";
import { listMemoriesForProject } from "../../src/memory/memoryStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { saveThread } from "../../src/threads/threadStore.js";

let db: Database.Database | undefined;
afterEach(() => { db?.close(); db = undefined; vi.useRealTimers(); });

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
  test("drain waits for a scheduled retry and exits when work completes", async () => {
    vi.useFakeTimers();
    const {database, project} = setup();
    enqueueDistillJob(database, project.id, "thread_worker", "cli");
    let requests = 0;
    const draining = drainDistillJobs(database, project.id, {distill: async () => {
      if (++requests === 1) throw new RetryableProviderError("Transient failure");
      return [];
    }}, "model");
    await vi.runAllTimersAsync();
    expect(await draining).toEqual({processed:2});
    expect(listDistillJobs(database, project.id)[0]).toMatchObject({status:"completed",attempts:2});
  });
  test("late provider output cannot write candidates after another attempt acquires the lease", async () => {
    vi.useFakeTimers();
    const {database, project} = setup();
    enqueueDistillJob(database, project.id, "thread_worker", "cli");
    const result = await runNextDistillJob(database, project.id, {distill: async () => {
      vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
      claimNextDistillJob(database, project.id);
      return [{title: "Late", kind: "fact", content: "Use a one-shot worker for trusted distillation.", evidence: "Use a one-shot worker for trusted distillation.", confidence: 1, importance: 0.5}];
    }}, "model");
    expect(result.status).toBe("lease_lost");
    expect(listMemoriesForProject(database, project.id)).toEqual([]);
    expect(listDistillJobs(database, project.id)[0]).toMatchObject({status: "running", attempts: 2});
  });

  test("provider failures back off and stop after three attempts", async () => {
    vi.useFakeTimers();
    const {database, project} = setup();
    enqueueDistillJob(database, project.id, "thread_worker", "cli");
    const provider = {distill: async () => { throw new RetryableProviderError("provider unavailable"); }};
    await runNextDistillJob(database, project.id, provider, "model");
    expect(listDistillJobs(database, project.id)[0]).toMatchObject({status: "pending", attempts: 1});
    expect((await runNextDistillJob(database, project.id, provider, "model")).status).toBe("idle");
    vi.setSystemTime(Date.now() + 1001);
    await runNextDistillJob(database, project.id, provider, "model");
    vi.setSystemTime(Date.now() + 2001);
    await runNextDistillJob(database, project.id, provider, "model");
    expect(listDistillJobs(database, project.id)[0]).toMatchObject({status: "failed", attempts: 3});
  });
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

  test("sends sanitized transcript text to the Provider", async () => {
    const { database, project } = setup();
    saveThread(database, {
      id: "thread_worker", projectId: project.id, title: "Worker", source: "codex",
      rawFormat: "markdown",
      rawText: `# codex session

## developer
Time: 2026-08-03T03:41:29.550Z
- Platform instruction should stay local.

## user
Time: 2026-08-03T03:41:29.552Z
Mira should keep project memory local.

## tool
{"cmd":"cat CLAUDE.md"}`
    });
    enqueueDistillJob(database, project.id, "thread_worker", "cli");
    let sent = "";
    const provider = { distill: vi.fn(async (input: { threadId: string; rawText: string }) => {
      sent = input.rawText;
      return [];
    }) };

    const result = await runNextDistillJob(database, project.id, provider, "model");

    expect(result.status).toBe("completed");
    expect(sent).toContain("Mira should keep project memory local.");
    expect(sent).not.toContain("Platform instruction should stay local.");
    expect(sent).not.toContain("cat CLAUDE.md");
    expect(sent).not.toContain("Time: 2026-08-03");
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
