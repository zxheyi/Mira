import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { createProject } from "../../src/projects/projectStore.js";
import {
  clearWorkingMemory,
  listWorkingMemory,
  setWorkingMemory,
  WORKING_MEMORY_KINDS
} from "../../src/workingMemory/workingMemoryStore.js";

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

describe("working memory store", () => {
  test("defines the MVP working memory kinds", () => {
    expect(WORKING_MEMORY_KINDS).toEqual(
      expect.arrayContaining([
        "current_task",
        "current_phase",
        "recent_decision",
        "blocker",
        "next_step",
        "preference",
        "note"
      ])
    );
  });

  test("sets and lists working memory for a project", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });

    const currentTask = setWorkingMemory(database, {
      projectId: project.id,
      kind: "current_task",
      content: "Implement Phase 3."
    });
    const blocker = setWorkingMemory(database, {
      projectId: project.id,
      kind: "blocker",
      content: "- Need MCP command shape later"
    });

    expect(listWorkingMemory(database, project.id)).toEqual([currentTask, blocker]);
  });

  test("keeps only the latest record per project and kind", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });

    const first = setWorkingMemory(database, {
      projectId: project.id,
      kind: "current_task",
      content: "Old task"
    });
    const updated = setWorkingMemory(database, {
      projectId: project.id,
      kind: "current_task",
      content: "New task"
    });

    expect(updated).toMatchObject({ id: first.id, content: "New task" });
    expect(listWorkingMemory(database, project.id)).toEqual([updated]);
  });

  test("clears one kind or all working memory for a project", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    setWorkingMemory(database, { projectId: project.id, kind: "current_task", content: "Task" });
    const nextStep = setWorkingMemory(database, { projectId: project.id, kind: "next_step", content: "Ship" });

    clearWorkingMemory(database, project.id, "current_task");
    expect(listWorkingMemory(database, project.id)).toEqual([nextStep]);

    clearWorkingMemory(database, project.id);
    expect(listWorkingMemory(database, project.id)).toEqual([]);
  });
});
