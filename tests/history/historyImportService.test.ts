import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { importProjectHistory } from "../../src/history/historyImportService.js";
import type { HistorySessionCandidate } from "../../src/history/historyTypes.js";
import { createProject } from "../../src/projects/projectStore.js";
import { listThreadsForProject } from "../../src/threads/threadStore.js";

let db: Database.Database | undefined;
afterEach(() => { db?.close(); db = undefined; });

function codexTranscript(sessionId: string, cwd: string, message: string): string {
  return [
    JSON.stringify({ type: "session_meta", payload: { id: sessionId, cwd } }),
    JSON.stringify({
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: message }] }
    })
  ].join("\n");
}

async function candidate(
  filePath: string,
  input: Partial<HistorySessionCandidate> & Pick<HistorySessionCandidate, "agent">
): Promise<HistorySessionCandidate> {
  return {
    filePath,
    size: 1,
    mtimeMs: 1,
    ...input
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "mira-history-service-"));
  db = openDatabase(":memory:");
  migrate(db);
  const project = createProject(db, { name: "Mira", rootPath: root });
  return { root, database: db, project };
}

describe("history import service", () => {
  test("classifies all outcomes and continues after one matched transcript fails", async () => {
    const { root, database, project } = await setup();
    const oldRoot = join(root, "..", "Mira-legacy");
    const good = join(root, "01-good.jsonl");
    const alias = join(root, "02-alias.jsonl");
    const malformed = join(root, "03-malformed.jsonl");
    const afterFailure = join(root, "04-after.jsonl");
    await writeFile(good, codexTranscript("good", root, "Good session."));
    await writeFile(alias, codexTranscript("alias", oldRoot, "Old path session."));
    await writeFile(malformed, codexTranscript("bad", root, "Before bad line.") + "\n{bad json");
    await writeFile(afterFailure, codexTranscript("after", root, "Continue after failure."));
    const candidates = [
      await candidate(good, { agent: "codex", sessionId: "good", cwd: root }),
      await candidate(alias, { agent: "codex", sessionId: "alias", cwd: oldRoot }),
      await candidate(join(root, "foreign.jsonl"), {
        agent: "codex", sessionId: "foreign", cwd: "/another/project"
      }),
      await candidate(join(root, "metadata.jsonl"), {
        agent: "claude-code", metadataError: "Claude session metadata is missing sessionId or cwd"
      }),
      await candidate(join(root, "scan-error.jsonl"), {
        agent: "codex", discoveryError: "file disappeared during metadata scan"
      }),
      await candidate(malformed, { agent: "codex", sessionId: "bad", cwd: root }),
      await candidate(afterFailure, { agent: "codex", sessionId: "after", cwd: root })
    ];

    const report = await importProjectHistory({
      db: database, project, projectRoot: root, agents: ["codex", "claude-code"],
      rootAliases: [oldRoot], distill: false, dryRun: false,
      scan: async () => candidates
    });

    expect(report.counts).toEqual({
      scanned: 7, imported: 3, updated: 0, unchanged: 0, skipped: 2, failed: 2
    });
    expect(report.status).toBe("completed_with_errors");
    expect(report.items.map((item) => item.filePath)).toEqual(
      [...candidates.map((item) => item.filePath)].sort()
    );
    expect(report.items.find((item) => item.filePath === malformed)).toMatchObject({
      outcome: "failed", errorStage: "parse", errorReason: expect.stringContaining("line 3")
    });
    expect(listThreadsForProject(database, project.id).map((thread) => thread.id)).toEqual([
      "thread_codex_good", "thread_codex_alias", "thread_codex_after"
    ]);
    expect(database.prepare("select count(*) from history_import_items").pluck().get()).toBe(7);
  });

  test("is idempotent, updates changed sessions, syncs cursor, and queues only changed content", async () => {
    const { root, database, project } = await setup();
    const path = join(root, "session.jsonl");
    await writeFile(path, codexTranscript("repeat", root, "Version one."));
    const scan = async () => [await candidate(path, {
      agent: "codex", sessionId: "repeat", cwd: root, size: 100, mtimeMs: 10
    })];
    const options = {
      db: database, project, projectRoot: root, agents: ["codex"] as const,
      rootAliases: [], distill: true, dryRun: false, scan
    };

    const first = await importProjectHistory(options);
    const second = await importProjectHistory(options);
    await writeFile(path, codexTranscript("repeat", root, "Version two."));
    const third = await importProjectHistory(options);

    expect(first.items[0]).toMatchObject({
      outcome: "imported", threadId: "thread_codex_repeat", distillStatus: "queued"
    });
    expect(second.items[0]).toMatchObject({ outcome: "unchanged", distillStatus: "not_applicable" });
    expect(third.items[0]).toMatchObject({ outcome: "updated", distillStatus: "queued" });
    expect(database.prepare("select count(*) from threads").pluck().get()).toBe(1);
    expect(database.prepare("select count(*) from integration_cursors").pluck().get()).toBe(1);
    expect(database.prepare("select count(*) from distill_jobs").pluck().get()).toBe(2);
  });

  test("dry-run parses and classifies without writing domain or audit rows", async () => {
    const { root, database, project } = await setup();
    const path = join(root, "dry.jsonl");
    await writeFile(path, codexTranscript("dry", root, "Preview only."));

    const report = await importProjectHistory({
      db: database, project, projectRoot: root, agents: ["codex"], rootAliases: [],
      distill: true, dryRun: true,
      scan: async () => [await candidate(path, { agent: "codex", sessionId: "dry", cwd: root })]
    });

    expect(report).toMatchObject({
      dryRun: true, runId: undefined, counts: { imported: 1, failed: 0 }
    });
    for (const table of ["threads", "integration_cursors", "distill_jobs", "history_import_runs", "history_import_items"]) {
      expect(database.prepare(`select count(*) from ${table}`).pluck().get()).toBe(0);
    }
  });

  test("applies capacity filters before reading matched transcripts and reports bounded import size", async () => {
    const { root, database, project } = await setup();
    const included = join(root, "01-included.jsonl");
    const limited = join(root, "02-limited.jsonl");
    const beforeSince = join(root, "03-before-since.jsonl");
    const afterUntil = join(root, "04-after-until.jsonl");
    const tooLarge = join(root, "05-too-large.jsonl");
    await writeFile(included, codexTranscript("included", root, "Small July session."));
    await writeFile(limited, codexTranscript("limited", root, "Second July session."));

    const july10 = Date.parse("2026-07-10T00:00:00.000Z");
    const july20 = Date.parse("2026-07-20T00:00:00.000Z");
    const june30 = Date.parse("2026-06-30T23:59:59.000Z");
    const aug01 = Date.parse("2026-08-01T00:00:00.000Z");
    const candidates = [
      await candidate(included, { agent: "codex", sessionId: "included", cwd: root, size: 1024, mtimeMs: july10 }),
      await candidate(limited, { agent: "codex", sessionId: "limited", cwd: root, size: 2048, mtimeMs: july20 }),
      await candidate(beforeSince, { agent: "codex", sessionId: "before", cwd: root, size: 512, mtimeMs: june30 }),
      await candidate(afterUntil, { agent: "codex", sessionId: "after", cwd: root, size: 512, mtimeMs: aug01 }),
      await candidate(tooLarge, {
        agent: "codex", sessionId: "large", cwd: root, size: 25 * 1024 * 1024, mtimeMs: july10
      })
    ];

    const report = await importProjectHistory({
      db: database, project, projectRoot: root, agents: ["codex"], rootAliases: [],
      distill: false, dryRun: false,
      filters: {
        sinceMs: Date.parse("2026-07-01T00:00:00.000Z"),
        untilExclusiveMs: Date.parse("2026-08-01T00:00:00.000Z"),
        maxFileSizeBytes: 20 * 1024 * 1024,
        limit: 1
      },
      scan: async () => candidates
    });

    expect(report.counts).toEqual({
      scanned: 5, imported: 1, updated: 0, unchanged: 0, skipped: 4, failed: 0
    });
    expect(report.summary).toMatchObject({
      matchedCount: 2,
      matchedBytes: 3072,
      matchedMegabytes: 0,
      skippedByDateCount: 2,
      skippedBySizeCount: 1,
      limitedCount: 1
    });
    expect(report.summary.largestCandidates[0]).toMatchObject({
      sessionId: "large",
      filePath: tooLarge,
      size: 25 * 1024 * 1024
    });
    expect(report.items.map((item) => item.errorStage)).toEqual([
      undefined, "filter", "filter", "filter", "filter"
    ]);
    expect(report.items.find((item) => item.filePath === tooLarge)).toMatchObject({
      outcome: "skipped",
      errorStage: "filter",
      errorReason: expect.stringContaining("--max-file-size")
    });
    expect(listThreadsForProject(database, project.id).map((thread) => thread.id)).toEqual([
      "thread_codex_included"
    ]);
  });

  test("marks a formal run failed when scanning cannot start", async () => {
    const { root, database, project } = await setup();

    await expect(importProjectHistory({
      db: database, project, projectRoot: root, agents: ["codex"], rootAliases: [],
      dryRun: false, distill: false, scan: async () => { throw new Error("history home unreadable"); }
    })).rejects.toThrow("history home unreadable");

    expect(database.prepare("select status, error from history_import_runs").get()).toEqual({
      status: "failed", error: "history home unreadable"
    });
  });
});
