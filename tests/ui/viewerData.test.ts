import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { rebuildProjectBriefing } from "../../src/briefing/projectBriefingStore.js";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { createHistoryImportRun, finishHistoryImportRun } from "../../src/history/historyImportStore.js";
import { addMemory } from "../../src/memory/memoryStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { saveThread } from "../../src/threads/threadStore.js";
import {
  getViewerBriefing,
  getViewerContextBundle,
  getViewerOverview,
  getViewerThread,
  listViewerImportRuns,
  listViewerResearchCases,
  getViewerResearchCase,
  listViewerThreads
} from "../../src/ui/viewerData.js";
import { setWorkingMemory } from "../../src/workingMemory/workingMemoryStore.js";
import { submitResearchPacket } from "../../src/research/researchService.js";

let db: Database.Database | undefined;
afterEach(() => { db?.close(); db = undefined; });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "mira-viewer-data-"));
  await mkdir(join(root, ".git"));
  const dbPath = join(root, ".mira", "mira.sqlite");
  db = openDatabase(dbPath);
  migrate(db);
  const project = createProject(db, { name: "NamiWork", rootPath: root });
  saveThread(db, {
    id: "thread_codex_one",
    projectId: project.id,
    title: "Codex session one",
    source: "codex",
    rawFormat: "jsonl",
    rawText: `# Codex session one

User: Ship Mira Viewer.

Assistant: Added a local dashboard.`
  });
  addMemory(db, {
    projectId: project.id,
    threadId: "thread_codex_one",
    title: "Viewer is read-only",
    kind: "decision",
    content: "Mira Viewer v1 must not mutate project memory.",
    source: "test",
    confidence: 0.95,
    importance: 8
  });
  setWorkingMemory(db, {
    projectId: project.id,
    kind: "current_task",
    content: "Inspect project memory in a local viewer."
  });
  const run = createHistoryImportRun(db, {
    projectId: project.id,
    agents: ["codex"],
    rootAliases: [],
    options: { distill: false }
  });
  finishHistoryImportRun(db, run.id, {
    scanned: 4,
    imported: 1,
    updated: 0,
    unchanged: 0,
    skipped: 3,
    failed: 0
  });
  rebuildProjectBriefing(db, project.id);
  const research = submitResearchPacket(db, project.id, {
    case: { title: "Evidence review", question: "What changed?", asOfDate: "2026-09-01" },
    evidence: [{
      key: "E1", sourceType: "regulatory_filing",
      sourceUri: "https://example.test/filing", sourceTitle: "Filing", locator: "p. 1",
      excerpt: "Revenue increased.", accessedAt: "2026-09-01"
    }],
    claims: [{
      key: "C1", statement: "Revenue increased.", evidenceStatus: "supported", confidence: 0.8,
      thesisImpact: "watch", invalidationConditions: "A later filing reports a decline.",
      links: [{ evidenceKey: "E1", relation: "supports", rationale: "Direct observation." }]
    }]
  });
  return { root, dbPath, database: db, project, research };
}

describe("viewer data", () => {
  test("builds an overview snapshot for the bound project", async () => {
    const { root, dbPath, database, project } = await setup();

    const overview = await getViewerOverview({ db: database, project, projectRoot: root, dbPath });

    expect(overview.project).toMatchObject({ id: project.id, name: "NamiWork", rootPath: root });
    expect(overview.database).toMatchObject({ path: dbPath, exists: true });
    expect(overview.database.sizeBytes).toBeGreaterThan(0);
    expect(overview.counts).toEqual({
      threads: 1,
      memories: 1,
      memoryCandidates: 0,
      historyImportRuns: 1,
      workingMemory: 1,
      researchCases: 1
    });
    expect(overview.integrations).toMatchObject({
      codex: { installed: false },
      claudeCode: { installed: false }
    });
    expect(overview.latestImportRun).toMatchObject({ importedCount: 1, skippedCount: 3, failedCount: 0 });
    expect(overview.latestBriefing).toMatchObject({ version: 1, status: "complete" });
  });

  test("lists and reads project-scoped Research Cases", async () => {
    const { database, project, research } = await setup();

    expect(listViewerResearchCases(database, project.id)).toEqual([
      expect.objectContaining({ id: research.researchCase.id, status: "draft" })
    ]);
    expect(getViewerResearchCase(database, project.id, research.researchCase.id)).toMatchObject({
      researchCase: { title: "Evidence review" },
      claims: [expect.objectContaining({ statement: "Revenue increased." })]
    });
  });

  test("lists thread previews and returns full thread details", async () => {
    const { database, project } = await setup();

    const threads = listViewerThreads(database, project.id);
    const detail = getViewerThread(database, project.id, "thread_codex_one");

    expect(threads).toEqual([
      expect.objectContaining({
        id: "thread_codex_one",
        title: "Codex session one",
        source: "codex",
        rawFormat: "jsonl",
        preview: expect.stringContaining("Ship Mira Viewer")
      })
    ]);
    expect("rawText" in threads[0]).toBe(false);
    expect(detail).toMatchObject({ id: "thread_codex_one", rawText: expect.stringContaining("local dashboard") });
  });

  test("returns import runs, briefing, and context bundle text", async () => {
    const { database, project } = await setup();

    expect(listViewerImportRuns(database, project.id)).toEqual([
      expect.objectContaining({ importedCount: 1, skippedCount: 3, failedCount: 0 })
    ]);
    expect(getViewerBriefing(database, project.id)?.markdown).toContain("Inspect project memory");
    expect(getViewerContextBundle(database, project.id, { maxCharacters: 800 })).toContain("# Mira Context Bundle");
  });
});
