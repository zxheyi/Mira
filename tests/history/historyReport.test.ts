import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { writeHistoryImportReport } from "../../src/history/historyReport.js";
import type { HistoryImportReport } from "../../src/history/historyTypes.js";

function report(): HistoryImportReport {
  return {
    runId: "history_run_1",
    dryRun: false,
    projectRoot: "/workspace/Mira",
    agents: ["codex"],
    rootAliases: ["/workspace/AnchorMem"],
    status: "completed",
    startedAt: "2026-07-20T00:00:00.000Z",
    finishedAt: "2026-07-20T00:00:01.000Z",
    counts: { scanned: 1, imported: 1, updated: 0, unchanged: 0, skipped: 0, failed: 0 },
    items: [{
      id: "history_item_1",
      runId: "history_run_1",
      agent: "codex",
      sessionId: "session-1",
      filePath: "/history/session.jsonl",
      cwd: "/workspace/Mira",
      fingerprint: "abc",
      outcome: "imported",
      threadId: "thread_codex_session_1",
      distillStatus: "not_requested",
      createdAt: "2026-07-20T00:00:00.500Z"
    }]
  };
}

describe("history import report", () => {
  test("atomically writes complete JSON and leaves no temporary file", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-history-report-"));
    const path = join(root, "nested", "report.json");

    await writeHistoryImportReport(report(), path);
    await writeHistoryImportReport({ ...report(), status: "completed_with_errors" }, path);

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      ...report(), status: "completed_with_errors"
    });
    expect(await readdir(join(root, "nested"))).toEqual(["report.json"]);
  });
});
