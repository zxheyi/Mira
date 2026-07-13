import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { addMemory, searchMemories } from "../../src/memory/memoryStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { deleteThread, saveThread } from "../../src/threads/threadStore.js";

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

describe("thread store", () => {
  test("saves a thread with raw format and text", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });

    const saved = saveThread(database, {
      id: "thread_1",
      projectId: project.id,
      title: "Planning Session",
      source: "codex",
      rawFormat: "markdown",
      rawText: "# Summary\nMira needs local memory."
    });

    expect(saved).toMatchObject({
      id: "thread_1",
      projectId: project.id,
      title: "Planning Session",
      source: "codex",
      rawFormat: "markdown",
      rawText: "# Summary\nMira needs local memory."
    });
    expect(new Date(saved.createdAt).toString()).not.toBe("Invalid Date");
    expect(new Date(saved.updatedAt).toString()).not.toBe("Invalid Date");
  });

  test("updates an existing thread while preserving createdAt", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    const first = saveThread(database, {
      id: "thread_1",
      projectId: project.id,
      title: "First Title",
      source: "codex",
      rawFormat: "markdown",
      rawText: "initial"
    });

    const updated = saveThread(database, {
      id: "thread_1",
      projectId: project.id,
      title: "Updated Title",
      source: "claude-code",
      rawFormat: "jsonl",
      rawText: "updated"
    });

    expect(updated).toMatchObject({
      id: "thread_1",
      projectId: project.id,
      title: "Updated Title",
      source: "claude-code",
      rawFormat: "jsonl",
      rawText: "updated",
      createdAt: first.createdAt
    });
    expect(database.prepare("select count(*) from threads").pluck().get()).toBe(1);
  });

  test("deletes a thread and its indexed memories", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    saveThread(database, {
      id: "thread_delete",
      projectId: project.id,
      title: "Delete Me",
      source: "codex",
      rawFormat: "markdown",
      rawText: "## Key Decisions\n- Delete indexed memories."
    });
    addMemory(database, {
      projectId: project.id,
      threadId: "thread_delete",
      title: "Delete indexed memories",
      kind: "decision",
      content: "Delete indexed memories.",
      source: "distill:thread_delete",
      confidence: 1,
      importance: 8
    });

    deleteThread(database, project.id, "thread_delete");

    expect(searchMemories(database, project.id, "indexed")).toEqual([]);
  });
});
