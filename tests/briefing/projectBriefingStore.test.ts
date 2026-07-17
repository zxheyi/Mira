import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import {
  ensureFreshProjectBriefing,
  getLatestCompleteProjectBriefing,
  listProjectBriefings,
  rebuildProjectBriefing
} from "../../src/briefing/projectBriefingStore.js";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { addMemory } from "../../src/memory/memoryStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { saveThread } from "../../src/threads/threadStore.js";
import { setWorkingMemory } from "../../src/workingMemory/workingMemoryStore.js";

let db: Database.Database | undefined;
afterEach(() => { db?.close(); db = undefined; });

function setup() {
  db = openDatabase(":memory:");
  migrate(db);
  const project = createProject(db, { name: "Mira", rootPath: "/workspace/mira-briefing" });
  const thread = saveThread(db, {
    id: "thread_briefing", projectId: project.id, title: "Briefing session", source: "codex",
    rawFormat: "markdown", rawText: "## Decisions\nUse deterministic briefings."
  });
  const currentTask = setWorkingMemory(db, {
    projectId: project.id, kind: "current_task", content: "Ship proactive Project Briefing."
  });
  const blocker = setWorkingMemory(db, {
    projectId: project.id, kind: "blocker", content: "Waiting for final review."
  });
  const decision = addMemory(db, {
    projectId: project.id, threadId: thread.id, title: "Briefing strategy", kind: "decision",
    content: "Project Briefing is generated deterministically.", source: "manual", confidence: 1, importance: 9
  });
  const constraint = addMemory(db, {
    projectId: project.id, title: "Fact source", kind: "constraint",
    content: "SQLite remains the only fact source.", source: "manual", confidence: 1, importance: 8
  });
  const failedAttempt = addMemory(db, {
    projectId: project.id, title: "Avoid hidden summaries", kind: "failed_attempt",
    content: "Do not create an untraceable summary cache.", source: "manual", confidence: 1, importance: 7
  });
  return { database: db, project, thread, currentTask, blocker, decision, constraint, failedAttempt };
}

describe("project briefing store", () => {
  test("builds a deterministic complete snapshot with exact provenance and estimates", () => {
    const { database, project, thread, currentTask, blocker, decision, constraint, failedAttempt } = setup();

    const briefing = rebuildProjectBriefing(database, project.id);

    expect(briefing).toMatchObject({
      projectId: project.id,
      version: 1,
      generationMethod: "deterministic",
      status: "complete",
      sourceWorkingMemoryIds: [currentTask.id, blocker.id],
      sourceMemoryIds: [decision.id, constraint.id, failedAttempt.id],
      sourceThreadIds: [thread.id]
    });
    expect(briefing.staleAt).toBeUndefined();
    expect(briefing.markdown).toContain("# Mira Project Briefing");
    expect(briefing.markdown).toContain("## Current Goal");
    expect(briefing.markdown).toContain(`Ship proactive Project Briefing. [working:${currentTask.id}]`);
    expect(briefing.markdown).toContain("## Recent Decisions");
    expect(briefing.markdown).toContain(`[memory:${decision.id}] [thread:${thread.id}]`);
    expect(briefing.markdown).toContain("## Known Constraints");
    expect(briefing.markdown).toContain("## Blockers");
    expect(briefing.markdown).toContain("## Lessons and Failed Attempts");
    expect(briefing.characterCount).toBe(briefing.markdown.length);
    expect(briefing.estimatedTokens).toBe(Math.ceil(briefing.markdown.length / 4));
  });

  test("creates monotonically versioned snapshots with identical text for identical state", () => {
    const { database, project } = setup();
    const first = rebuildProjectBriefing(database, project.id);
    const second = rebuildProjectBriefing(database, project.id);

    expect(second.version).toBe(2);
    expect(second.id).not.toBe(first.id);
    expect(second.markdown).toBe(first.markdown);
    expect(second.sourceMemoryIds).toEqual(first.sourceMemoryIds);
    expect(listProjectBriefings(database, project.id).map((item) => item.version)).toEqual([2, 1]);
  });

  test("rebuilds a stale snapshot once and returns the fresh version", () => {
    const { database, project } = setup();
    const first = rebuildProjectBriefing(database, project.id);
    setWorkingMemory(database, {
      projectId: project.id, kind: "next_step", content: "Run the complete regression suite."
    });

    expect(getLatestCompleteProjectBriefing(database, project.id)).toMatchObject({
      id: first.id, staleAt: expect.any(String)
    });
    const fresh = ensureFreshProjectBriefing(database, project.id);
    expect(fresh).toMatchObject({ version: 2 });
    expect(fresh?.staleAt).toBeUndefined();
    expect(fresh?.markdown).toContain("Run the complete regression suite.");
    expect(ensureFreshProjectBriefing(database, project.id)?.id).toBe(fresh?.id);
  });

  test("records a failed version and falls back to the last complete snapshot", () => {
    const { database, project } = setup();
    const first = rebuildProjectBriefing(database, project.id);
    setWorkingMemory(database, { projectId: project.id, kind: "note", content: "Trigger stale state." });

    const fallback = ensureFreshProjectBriefing(database, project.id, {
      renderer: () => { throw new Error("renderer unavailable"); }
    });

    expect(fallback?.id).toBe(first.id);
    expect(listProjectBriefings(database, project.id)).toEqual([
      expect.objectContaining({ version: 2, status: "failed", error: "renderer unavailable" }),
      expect.objectContaining({ version: 1, status: "complete", staleAt: expect.any(String) })
    ]);
  });

  test("validates briefing history limits", () => {
    const { database, project } = setup();
    expect(() => listProjectBriefings(database, project.id, 0)).toThrow(/between 1 and 100/);
    expect(() => listProjectBriefings(database, project.id, 101)).toThrow(/between 1 and 100/);
  });
});
