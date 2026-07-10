import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { buildContextBundle } from "../../src/context/contextBundle.js";
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
});
