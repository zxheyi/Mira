import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { addMemory, searchMemories } from "../../src/memory/memoryStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { deleteThread, getThread, saveThread } from "../../src/threads/threadStore.js";

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
  test("rejects reassignment of a captured thread to a different project", () => {
    const database = setupDb();
    const first = createProject(database, { name: "First", rootPath: "/first" });
    const second = createProject(database, { name: "Second", rootPath: "/second" });
    const saved = saveThread(database, {
      id: "shared-session", projectId: first.id, title: "Original", source: "codex",
      rawFormat: "markdown", rawText: "Original evidence"
    });
    expect(() => saveThread(database, { ...saved, projectId: second.id, rawText: "Other evidence" }))
      .toThrow(/different project/i);
    expect(getThread(database, first.id, saved.id)).toEqual(saved);
    expect(getThread(database, second.id, saved.id)).toBeUndefined();
  });

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

  test("cascades memories when a thread is deleted directly by SQLite", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    saveThread(database, {
      id: "thread_cascade",
      projectId: project.id,
      title: "Cascade Me",
      source: "codex",
      rawFormat: "markdown",
      rawText: "## Key Decisions\n- Cascade indexed memories."
    });
    addMemory(database, {
      projectId: project.id,
      threadId: "thread_cascade",
      title: "Cascade indexed memories",
      kind: "decision",
      content: "Cascade indexed memories.",
      source: "distill:thread_cascade",
      confidence: 1,
      importance: 8
    });

    database.prepare("delete from threads where project_id = ? and id = ?").run(project.id, "thread_cascade");

    expect(searchMemories(database, project.id, "Cascade")).toEqual([]);
    expect(database.prepare("select count(*) from memory_fts").pluck().get()).toBe(0);
  });

  test("relies on cascade when deleting a thread", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    saveThread(database, {
      id: "thread_cascade_only",
      projectId: project.id,
      title: "Cascade Only",
      source: "codex",
      rawFormat: "markdown",
      rawText: "summary"
    });
    addMemory(database, {
      projectId: project.id,
      threadId: "thread_cascade_only",
      title: "Cascade Only Memory",
      kind: "decision",
      content: "Cascade should remove this memory.",
      source: "manual",
      confidence: 1,
      importance: 5
    });
    const wrappedDb = Object.create(database) as Database.Database;
    wrappedDb.prepare = ((sql: string) => {
      if (sql.includes("delete from memories")) {
        throw new Error("deleteThread should rely on thread cascade");
      }
      return database.prepare(sql);
    }) as Database.Database["prepare"];
    wrappedDb.transaction = ((fn: () => unknown) => () => fn()) as Database.Database["transaction"];

    deleteThread(wrappedDb, project.id, "thread_cascade_only");

    expect(searchMemories(database, project.id, "Cascade")).toEqual([]);
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
