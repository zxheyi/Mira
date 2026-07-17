import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { buildContextBundle } from "../../src/context/contextBundle.js";
import { listProjectBriefings } from "../../src/briefing/projectBriefingStore.js";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { addMemory } from "../../src/memory/memoryStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { setWorkingMemory } from "../../src/workingMemory/workingMemoryStore.js";

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function setupDb(): Database.Database {
  const database = openDatabase(":memory:");
  migrate(database);
  db = database;
  return database;
}

describe("context bundle", () => {
  test("prints working memory before durable memory", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    setWorkingMemory(database, {
      projectId: project.id,
      kind: "current_task",
      content: "Implement Working Memory and Context Bundle."
    });
    addMemory(database, {
      projectId: project.id,
      title: "Product name",
      kind: "decision",
      content: "The product is named Mira.",
      source: "manual",
      confidence: 1,
      importance: 10
    });

    const bundle = buildContextBundle(database, project.id, { query: "Mira" });

    expect(bundle).toContain("# Mira Context Bundle");
    expect(bundle.indexOf("## Working Memory")).toBeLessThan(bundle.indexOf("## Project Briefing"));
    expect(bundle.indexOf("## Project Briefing")).toBeLessThan(bundle.indexOf("## Long-Term Memory"));
    expect(bundle.indexOf("## Working Memory")).toBeLessThan(bundle.indexOf("## Long-Term Memory"));
    expect(bundle).toContain("### current_task");
    expect(bundle).toContain("Implement Working Memory and Context Bundle.");
    expect(bundle).toContain("Product name");
  });

  test("limits durable memories by memoryLimit and maxCharacters", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    setWorkingMemory(database, {
      projectId: project.id,
      kind: "next_step",
      content: "Start Phase 4 after this."
    });
    addMemory(database, {
      projectId: project.id,
      title: "Important memory",
      kind: "decision",
      content: "Mira should keep the bundle short.",
      source: "manual",
      confidence: 1,
      importance: 9
    });
    addMemory(database, {
      projectId: project.id,
      title: "Second memory",
      kind: "note",
      content: "Mira also has another long-term note.",
      source: "manual",
      confidence: 1,
      importance: 1
    });

    const bundle = buildContextBundle(database, project.id, {
      query: "Mira",
      memoryLimit: 1,
      maxCharacters: 220
    });

    expect(bundle.length).toBeLessThanOrEqual(220);
    expect(bundle).toContain("Start Phase 4 after this.");
    expect(bundle).toContain("Important memory");
    expect(bundle).not.toContain("Second memory");
  });

  test("budgets working memory entries and supports small maxCharacters consistently", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    setWorkingMemory(database, {
      projectId: project.id,
      kind: "current_task",
      content: "This working memory entry is intentionally too large for a tiny budget.".repeat(3)
    });

    const bundle = buildContextBundle(database, project.id, { maxCharacters: 50 });

    expect(bundle.length).toBeLessThanOrEqual(50);
    expect(bundle).not.toContain("intentionally too large");
  });

  test("prints empty state messages and supports tiny maxCharacters budgets", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });

    const fullBundle = buildContextBundle(database, project.id);
    expect(fullBundle).toContain("No working memory recorded.");
    expect(fullBundle).toContain("No matching long-term memory.");
    expect(buildContextBundle(database, project.id, { maxCharacters: 3 })).toBe("# M");
  });

  test("orders working memory by priority and includes updated timestamps", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    setWorkingMemory(database, { projectId: project.id, kind: "note", content: "Background note." });
    setWorkingMemory(database, { projectId: project.id, kind: "blocker", content: "Blocked on audit." });
    setWorkingMemory(database, { projectId: project.id, kind: "current_task", content: "Fix deep audit." });

    const bundle = buildContextBundle(database, project.id);

    expect(bundle.indexOf("### blocker")).toBeLessThan(bundle.indexOf("### current_task"));
    expect(bundle.indexOf("### current_task")).toBeLessThan(bundle.indexOf("### note"));
    expect(bundle).toMatch(/updatedAt: \d{4}-\d{2}-\d{2}T/);
  });

  test("groups warning memories before regular long-term memories", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    addMemory(database, {
      projectId: project.id,
      title: "Failed browser import",
      kind: "failed_attempt",
      content: "Reading browser auth files is unsafe.",
      source: "manual",
      confidence: 1,
      importance: 8
    });
    addMemory(database, {
      projectId: project.id,
      title: "Normal note",
      kind: "note",
      content: "Mira keeps local data.",
      source: "manual",
      confidence: 1,
      importance: 4
    });

    const bundle = buildContextBundle(database, project.id, { query: "Mira unsafe" });

    expect(bundle.indexOf("## Warnings")).toBeLessThan(bundle.indexOf("## Long-Term Memory"));
    expect(bundle.indexOf("## Project Briefing")).toBeLessThan(bundle.indexOf("## Warnings"));
    expect(bundle).toContain("Failed browser import");
    expect(bundle).toContain("Normal note");
  });

  test("applies maxCharacters budgets to warning memories", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    setWorkingMemory(database, { projectId: project.id, kind: "current_task", content: "Short task." });
    addMemory(database, {
      projectId: project.id,
      title: "Oversized warning",
      kind: "failed_attempt",
      content: "This warning is intentionally too long to fit inside the remaining budget.".repeat(4),
      source: "manual",
      confidence: 1,
      importance: 10
    });
    addMemory(database, {
      projectId: project.id,
      title: "Small regular",
      kind: "note",
      content: "Small regular memory.",
      source: "manual",
      confidence: 1,
      importance: 5
    });

    const bundle = buildContextBundle(database, project.id, { maxCharacters: 220 });

    expect(bundle.length).toBeLessThanOrEqual(220);
    expect(bundle).not.toContain("Oversized warning");
    expect(bundle).toContain("Some warning memories were omitted due to maxCharacters.");
  });

  test("stops adding budgeted memories after the first oversized entry", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    setWorkingMemory(database, { projectId: project.id, kind: "current_task", content: "Keep this working memory." });
    addMemory(database, {
      projectId: project.id,
      title: "Fits first",
      kind: "decision",
      content: "The first memory fits.",
      source: "manual",
      confidence: 1,
      importance: 10
    });
    addMemory(database, {
      projectId: project.id,
      title: "Too large second",
      kind: "architecture",
      content: "This second high-priority memory is too large to fit.".repeat(5),
      source: "manual",
      confidence: 1,
      importance: 9
    });
    addMemory(database, {
      projectId: project.id,
      title: "Would fit third",
      kind: "note",
      content: "This lower-priority memory would fit but should not leapfrog.",
      source: "manual",
      confidence: 1,
      importance: 1
    });

    const bundle = buildContextBundle(database, project.id, { maxCharacters: 260 });

    expect(bundle).toContain("The first memory fits.");
    expect(bundle).not.toContain("Too large second");
    expect(bundle).not.toContain("Would fit third");
  });

  test("keeps long-term memory entries whole when applying character budgets", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    setWorkingMemory(database, { projectId: project.id, kind: "current_task", content: "Keep this working memory." });
    addMemory(database, {
      projectId: project.id,
      title: "First memory",
      kind: "decision",
      content: "First memory should fit.",
      source: "manual",
      confidence: 1,
      importance: 9
    });
    addMemory(database, {
      projectId: project.id,
      title: "Second memory",
      kind: "note",
      content: "Second memory should be skipped instead of partially cut.",
      source: "manual",
      confidence: 1,
      importance: 8
    });

    const bundle = buildContextBundle(database, project.id, { maxCharacters: 285 });

    expect(bundle).toContain("Keep this working memory.");
    expect(bundle).toContain("First memory should fit.");
    expect(bundle).not.toContain("Second memory should be skipped");
    expect(bundle).toContain("Some long-term memories were omitted due to maxCharacters.");
  });

  test("rebuilds a stale Project Briefing while building the next context bundle", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    setWorkingMemory(database, { projectId: project.id, kind: "current_task", content: "Build Phase 4." });

    const first = buildContextBundle(database, project.id);
    expect(first).toContain("Build Phase 4.");
    expect(listProjectBriefings(database, project.id).map((item) => item.version)).toEqual([1]);

    setWorkingMemory(database, { projectId: project.id, kind: "next_step", content: "Verify token budgets." });
    const second = buildContextBundle(database, project.id);
    expect(second).toContain("Verify token budgets.");
    expect(listProjectBriefings(database, project.id).map((item) => item.version)).toEqual([2, 1]);
    expect(listProjectBriefings(database, project.id)[1]?.staleAt).toEqual(expect.any(String));
  });

  test("uses the stricter character estimate when maxTokens and maxCharacters are both set", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    setWorkingMemory(database, {
      projectId: project.id,
      kind: "current_task",
      content: "Keep token-budgeted context concise."
    });

    const bundle = buildContextBundle(database, project.id, { maxTokens: 50, maxCharacters: 500 });
    expect(bundle.length).toBeLessThanOrEqual(200);
    expect(bundle).toContain("Keep token-budgeted context concise.");
    expect(() => buildContextBundle(database, project.id, { maxTokens: 24 })).toThrow(/maxTokens/);
  });

  test("includes warning Memory independently of the search query", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    addMemory(database, {
      projectId: project.id, title: "Unsafe import", kind: "failed_attempt",
      content: "Browser credential import is unsafe.", source: "manual", confidence: 1, importance: 8
    });
    addMemory(database, {
      projectId: project.id, title: "SQLite note", kind: "note",
      content: "SQLite keeps project data local.", source: "manual", confidence: 1, importance: 5
    });

    const bundle = buildContextBundle(database, project.id, { query: "SQLite" });
    expect(bundle).toContain("Unsafe import");
    expect(bundle).toContain("SQLite note");
  });
});
