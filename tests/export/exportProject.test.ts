import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { exportProject } from "../../src/export/exportProject.js";
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

describe("exportProject", () => {
  test("exports project memory as JSON and Markdown", async () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    setWorkingMemory(database, {
      projectId: project.id,
      kind: "current_task",
      content: "Finish export."
    });
    addMemory(database, {
      projectId: project.id,
      title: "Export decision",
      kind: "decision",
      content: "Mira exports local data.",
      source: "manual",
      confidence: 1,
      importance: 8
    });
    const outDir = await mkdtemp(join(tmpdir(), "mira-export-test-"));

    const json = await exportProject(database, project.id, "json", outDir);
    const markdown = await exportProject(database, project.id, "markdown", outDir);

    expect(json.files).toEqual([join(outDir, "mira-export.json")]);
    expect(markdown.files).toEqual([join(outDir, "mira-export.md")]);
    expect(await readFile(join(outDir, "mira-export.json"), "utf8")).toContain("Export decision");
    expect(await readFile(join(outDir, "mira-export.md"), "utf8")).toContain("# Mira Export");
  });
});
