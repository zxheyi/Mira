import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import {
  archiveMemory,
  getMemory,
  getMemoryHistory,
  listMemoryEvents,
  restoreMemory,
  updateMemory
} from "../../src/memory/memoryLifecycleStore.js";
import { addMemory, listMemoriesForProject, searchMemories } from "../../src/memory/memoryStore.js";
import { createProject } from "../../src/projects/projectStore.js";

let db: Database.Database | undefined;
afterEach(() => { db?.close(); db = undefined; });

function setup() {
  db = openDatabase(":memory:");
  migrate(db);
  const project = createProject(db, { name: "Mira", rootPath: "/workspace/mira-lifecycle" });
  const memory = addMemory(db, {
    projectId: project.id,
    title: "Storage decision",
    kind: "decision",
    content: "Mira stores memory in local SQLite.",
    source: "manual",
    confidence: 1,
    importance: 9
  });
  return { database: db, project, memory };
}

describe("memory lifecycle store", () => {
  test("creates active memories with an accepted event", () => {
    const { database, project, memory } = setup();

    expect(memory).toMatchObject({ status: "active" });
    expect(memory.updatedAt).toBe(memory.createdAt);
    expect(listMemoryEvents(database, project.id, memory.id)).toEqual([
      expect.objectContaining({ memoryId: memory.id, eventType: "accepted", actor: "manual" })
    ]);
  });

  test("updates by creating a successor and atomically superseding the predecessor", () => {
    const { database, project, memory } = setup();

    const successor = updateMemory(database, {
      projectId: project.id,
      memoryId: memory.id,
      content: "Mira stores memory in project-local SQLite with lifecycle history.",
      actor: "cli",
      reason: "Lifecycle design approved"
    });

    expect(successor).toMatchObject({
      status: "active",
      supersedesMemoryId: memory.id,
      title: memory.title,
      kind: memory.kind
    });
    expect(getMemory(database, project.id, memory.id)).toMatchObject({ status: "superseded" });
    expect(listMemoriesForProject(database, project.id).map((item) => item.id)).toEqual([successor.id]);
    expect(searchMemories(database, project.id, "local SQLite", { queryMode: "phrase" })
      .map((result) => result.memory.id)).toEqual([successor.id]);
    expect(listMemoryEvents(database, project.id, memory.id).map((event) => event.eventType))
      .toEqual(["accepted", "superseded"]);
    expect(listMemoryEvents(database, project.id, successor.id).map((event) => event.eventType))
      .toEqual(["updated"]);
  });

  test("archives active memory and restores it only without an active successor", () => {
    const { database, project, memory } = setup();

    const archived = archiveMemory(database, project.id, memory.id, "cli", "No longer current");
    expect(archived.status).toBe("archived");
    expect(searchMemories(database, project.id, "SQLite")).toEqual([]);
    expect(listMemoriesForProject(database, project.id)).toEqual([]);

    const restored = restoreMemory(database, project.id, memory.id, "cli", "Needed again");
    expect(restored.status).toBe("active");
    expect(searchMemories(database, project.id, "SQLite")[0]?.memory.id).toBe(memory.id);
    expect(listMemoryEvents(database, project.id, memory.id).map((event) => event.eventType))
      .toEqual(["accepted", "archived", "restored"]);

    const successor = updateMemory(database, {
      projectId: project.id, memoryId: memory.id,
      content: "Mira stores memory in lifecycle-aware SQLite.", actor: "cli"
    });
    expect(() => restoreMemory(database, project.id, memory.id, "cli")).toThrow(/superseded/);
    expect(successor.status).toBe("active");
  });

  test("re-adding an archived memory restores it instead of returning an inactive record", () => {
    const { database, project, memory } = setup();
    archiveMemory(database, project.id, memory.id, "cli", "Temporarily stale");

    const restored = addMemory(database, {
      projectId: project.id,
      title: memory.title,
      kind: memory.kind,
      content: memory.content,
      source: "manual",
      confidence: memory.confidence,
      importance: memory.importance
    });

    expect(restored).toMatchObject({ id: memory.id, status: "active" });
    expect(listMemoryEvents(database, project.id, memory.id).map((event) => event.eventType))
      .toEqual(["accepted", "archived", "restored"]);
  });

  test("allows a lifecycle chain to return to earlier content", () => {
    const { database, project, memory } = setup();
    const second = updateMemory(database, {
      projectId: project.id,
      memoryId: memory.id,
      content: "A newer storage decision.",
      actor: "cli"
    });
    const third = updateMemory(database, {
      projectId: project.id,
      memoryId: second.id,
      content: memory.content,
      actor: "cli"
    });

    expect(third).toMatchObject({ status: "active", supersedesMemoryId: second.id, content: memory.content });
    expect(getMemoryHistory(database, project.id, third.id).memories.map((item) => item.id))
      .toEqual([memory.id, second.id, third.id]);
  });

  test("returns the same ordered history from any memory in the chain", () => {
    const { database, project, memory } = setup();
    const second = updateMemory(database, {
      projectId: project.id, memoryId: memory.id,
      content: "Second storage decision.", actor: "mcp"
    });
    const third = updateMemory(database, {
      projectId: project.id, memoryId: second.id,
      content: "Third storage decision.", actor: "mcp"
    });

    const expectedIds = [memory.id, second.id, third.id];
    expect(getMemoryHistory(database, project.id, memory.id).memories.map((item) => item.id)).toEqual(expectedIds);
    expect(getMemoryHistory(database, project.id, third.id).memories.map((item) => item.id)).toEqual(expectedIds);
  });

  test("rejects invalid transitions without changing the existing chain", () => {
    const { database, project, memory } = setup();
    expect(() => updateMemory(database, {
      projectId: project.id, memoryId: memory.id,
      content: memory.content, actor: "cli"
    })).toThrow(/different/);
    expect(() => archiveMemory(database, project.id, "missing", "cli")).toThrow(/not found/);
    expect(getMemory(database, project.id, memory.id)?.status).toBe("active");
    expect(listMemoriesForProject(database, project.id)).toHaveLength(1);
  });
});
