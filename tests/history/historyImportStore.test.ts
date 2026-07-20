import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import {
  createHistoryImportRun,
  finishHistoryImportRun,
  listHistoryImportFailures,
  listHistoryImportRuns,
  recordHistoryImportItem
} from "../../src/history/historyImportStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { saveThread } from "../../src/threads/threadStore.js";

let db: Database.Database | undefined;
afterEach(() => { db?.close(); db = undefined; });

function setup() {
  db = openDatabase(":memory:");
  migrate(db);
  const project = createProject(db, { name: "Mira", rootPath: "/workspace/Mira" });
  return { database: db, project };
}

describe("history import audit store", () => {
  test("interrupts stale runs and completes a new run with counters", () => {
    const { database, project } = setup();
    const stale = createHistoryImportRun(database, {
      projectId: project.id, agents: ["codex"], rootAliases: [], options: { distill: false }
    });
    const active = createHistoryImportRun(database, {
      projectId: project.id, agents: ["codex", "claude-code"],
      rootAliases: ["/workspace/AnchorMem"], options: { distill: true }
    });

    finishHistoryImportRun(database, active.id, {
      scanned: 2, imported: 1, updated: 0, unchanged: 0, skipped: 0, failed: 1
    });

    const runs = listHistoryImportRuns(database, project.id, 20);
    expect(runs.find((run) => run.id === stale.id)?.status).toBe("interrupted");
    expect(runs.find((run) => run.id === active.id)).toMatchObject({
      status: "completed_with_errors", scannedCount: 2, importedCount: 1, failedCount: 1
    });
  });

  test("lists import and distill failures with sanitized bounded reasons", () => {
    const { database, project } = setup();
    const run = createHistoryImportRun(database, {
      projectId: project.id, agents: ["codex"], rootAliases: [], options: { distill: true }
    });
    saveThread(database, {
      id: "thread_codex_distill_session", projectId: project.id, title: "Distill",
      source: "codex", rawFormat: "jsonl", rawText: "Queue this transcript."
    });
    recordHistoryImportItem(database, {
      runId: run.id, agent: "codex", sessionId: "failed-session", filePath: "/history/failed.jsonl",
      cwd: "/workspace/Mira", outcome: "failed", distillStatus: "not_requested",
      errorStage: "parse",
      errorReason: "Bearer secret-token-value sk-proj-12345678901234567890 " + "x".repeat(2_000)
    });
    recordHistoryImportItem(database, {
      runId: run.id, agent: "codex", sessionId: "distill-session", filePath: "/history/distill.jsonl",
      cwd: "/workspace/Mira", fingerprint: "abc", outcome: "imported",
      threadId: "thread_codex_distill_session", distillStatus: "failed",
      errorStage: "distill", errorReason: "queue unavailable"
    });

    const failures = listHistoryImportFailures(database, project.id, { runId: run.id, limit: 100 });
    expect(failures).toHaveLength(2);
    expect(failures[0]?.errorReason).not.toContain("secret-token");
    expect(failures[0]?.errorReason).not.toContain("sk-proj-");
    expect(failures[0]?.errorReason?.length).toBeLessThanOrEqual(1_000);
    expect(failures.map((item) => item.filePath)).toEqual([
      "/history/failed.jsonl", "/history/distill.jsonl"
    ]);
  });
});
