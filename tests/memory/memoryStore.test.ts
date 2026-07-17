import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { createProject } from "../../src/projects/projectStore.js";
import { saveThread } from "../../src/threads/threadStore.js";
import {
  addMemory,
  clearMemoriesForThread,
  deleteMemoriesForProject,
  listMemoriesForProject,
  listTopMemoriesForProject,
  MEMORY_KINDS,
  searchMemories
} from "../../src/memory/memoryStore.js";
import { updateMemory } from "../../src/memory/memoryLifecycleStore.js";

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

describe("memory store", () => {
  test("defines the MVP memory kinds", () => {
    expect(MEMORY_KINDS).toEqual(
      expect.arrayContaining([
        "decision",
        "convention",
        "architecture",
        "preference",
        "task",
        "fact",
        "failed_attempt",
        "lesson",
        "note"
      ])
    );
  });

  test("adds a memory with provenance, confidence, and content hash", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    const thread = saveThread(database, {
      id: "thread_1",
      projectId: project.id,
      title: "Planning",
      source: "codex",
      rawFormat: "markdown",
      rawText: "summary"
    });

    const memory = addMemory(database, {
      projectId: project.id,
      threadId: thread.id,
      title: "Project name",
      kind: "decision",
      content: "The product is named Mira.",
      source: "thread:thread_1",
      confidence: 1,
      importance: 9
    });

    expect(memory).toMatchObject({
      projectId: project.id,
      threadId: thread.id,
      title: "Project name",
      kind: "decision",
      content: "The product is named Mira.",
      source: "thread:thread_1",
      confidence: 1,
      importance: 9
    });
    expect(memory.id).toMatch(/^memory_/);
    expect(memory.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("does not duplicate the same memory content for the same thread", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    saveThread(database, {
      id: "thread_1",
      projectId: project.id,
      title: "Planning",
      source: "codex",
      rawFormat: "markdown",
      rawText: "summary"
    });

    const first = addMemory(database, {
      projectId: project.id,
      threadId: "thread_1",
      title: "MCP strategy",
      kind: "architecture",
      content: "MVP uses one MCP stdio server per project.",
      source: "thread:thread_1",
      confidence: 1,
      importance: 8
    });
    const second = addMemory(database, {
      projectId: project.id,
      threadId: "thread_1",
      title: "MCP strategy updated title",
      kind: "architecture",
      content: "MVP uses one MCP stdio server per project.",
      source: "thread:thread_1",
      confidence: 0.8,
      importance: 1
    });

    expect(second).toEqual(first);
    expect(listMemoriesForProject(database, project.id)).toHaveLength(1);
  });

  test("clears memories for one thread without deleting other project memories", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    saveThread(database, {
      id: "thread_1",
      projectId: project.id,
      title: "Planning",
      source: "codex",
      rawFormat: "markdown",
      rawText: "summary"
    });
    saveThread(database, {
      id: "thread_2",
      projectId: project.id,
      title: "Follow-up",
      source: "codex",
      rawFormat: "markdown",
      rawText: "summary"
    });
    addMemory(database, {
      projectId: project.id,
      threadId: "thread_1",
      title: "Delete me",
      kind: "decision",
      content: "This came from thread one.",
      source: "thread:thread_1",
      confidence: 1,
      importance: 5
    });
    const kept = addMemory(database, {
      projectId: project.id,
      threadId: "thread_2",
      title: "Keep me",
      kind: "decision",
      content: "This came from thread two.",
      source: "thread:thread_2",
      confidence: 1,
      importance: 5
    });

    clearMemoriesForThread(database, project.id, "thread_1");

    expect(listMemoriesForProject(database, project.id)).toEqual([kept]);
    expect(searchMemories(database, project.id, "thread one", { queryMode: "phrase" })).toEqual([]);
  });

  test("searches title and content and returns scored results", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    addMemory(database, {
      projectId: project.id,
      title: "Agent context bundle",
      kind: "architecture",
      content: "Working Memory should appear before durable memories.",
      source: "manual",
      confidence: 0.9,
      importance: 6
    });
    const important = addMemory(database, {
      projectId: project.id,
      title: "MCP write tools",
      kind: "decision",
      content: "Agents must be able to add memories through MCP.",
      source: "manual",
      confidence: 1,
      importance: 10
    });
    const lessImportant = addMemory(database, {
      projectId: project.id,
      title: "MCP setup note",
      kind: "note",
      content: "Document MCP config examples for agents.",
      source: "manual",
      confidence: 1,
      importance: 3
    });

    const titleResults = searchMemories(database, project.id, "bundle");
    const contentResults = searchMemories(database, project.id, "MCP");

    expect(titleResults[0]?.memory.title).toBe("Agent context bundle");
    expect(contentResults.map((result) => result.memory)).toEqual([important, lessImportant]);
    expect(contentResults[0]?.score).toEqual(expect.any(Number));
  });

  test("orders equally important search results by score before recency", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    const exact = addMemory(database, {
      projectId: project.id,
      title: "Exact MCP",
      kind: "fact",
      content: "MCP",
      source: "manual",
      confidence: 1,
      importance: 5
    });
    addMemory(database, {
      projectId: project.id,
      title: "Later broad MCP",
      kind: "fact",
      content: "MCP appears in a longer note with extra words.",
      source: "manual",
      confidence: 1,
      importance: 5
    });

    expect(searchMemories(database, project.id, "MCP")[0]?.memory.id).toBe(exact.id);
  });

  test("filters search results by memory kind", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    addMemory(database, {
      projectId: project.id,
      title: "MCP decision",
      kind: "decision",
      content: "MCP search supports optional kind filtering.",
      source: "manual",
      confidence: 1,
      importance: 5
    });
    const failedAttempt = addMemory(database, {
      projectId: project.id,
      title: "MCP failed attempt",
      kind: "failed_attempt",
      content: "MCP search supports optional kind filtering.",
      source: "manual",
      confidence: 1,
      importance: 5
    });

    expect(searchMemories(database, project.id, "MCP", { kind: "failed_attempt" }).map((result) => result.memory)).toEqual([
      failedAttempt
    ]);
  });

  test("returns an empty list for blank search queries", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });

    expect(searchMemories(database, project.id, "   ")).toEqual([]);
    expect(searchMemories(database, project.id, "   ", { queryMode: "orTerms" })).toEqual([]);
  });

  test("matches any query term by default and keeps phrase mode explicit", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    const mcp = addMemory(database, {
      projectId: project.id,
      title: "MCP boundary",
      kind: "decision",
      content: "MCP tools should validate arguments.",
      source: "manual",
      confidence: 1,
      importance: 5
    });
    const bundle = addMemory(database, {
      projectId: project.id,
      title: "Bundle fallback",
      kind: "note",
      content: "Context bundle fallback should use one FTS query.",
      source: "manual",
      confidence: 1,
      importance: 5
    });

    expect(searchMemories(database, project.id, "MCP bundle").map((result) => result.memory)).toEqual([
      mcp,
      bundle
    ]);
    expect(searchMemories(database, project.id, "MCP bundle", { queryMode: "phrase" })).toEqual([]);
  });

  test("returns the duplicate created by a concurrent insert fallback", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    saveThread(database, {
      id: "thread_race",
      projectId: project.id,
      title: "Race",
      source: "codex",
      rawFormat: "markdown",
      rawText: "summary"
    });
    database.exec(`
      create trigger simulate_memory_race before insert on memories
      when new.title = 'Race duplicate'
      begin
        insert into memories (id, project_id, thread_id, title, kind, content, source, confidence, content_hash, importance, created_at)
        values ('memory_race_winner', new.project_id, new.thread_id, 'Race duplicate winner', new.kind, new.content, new.source, new.confidence, new.content_hash, new.importance, new.created_at);
        insert into memory_fts (id, project_id, title, content)
        values ('memory_race_winner', new.project_id, 'Race duplicate winner', new.content);
      end;
    `);

    const memory = addMemory(database, {
      projectId: project.id,
      threadId: "thread_race",
      title: "Race duplicate",
      kind: "decision",
      content: "A duplicate may appear between lookup and insert.",
      source: "manual",
      confidence: 1,
      importance: 5
    });

    expect(memory).toMatchObject({ id: "memory_race_winner", title: "Race duplicate winner" });
    expect(listMemoriesForProject(database, project.id)).toHaveLength(1);
  });

  test("returns an existing duplicate from the catch fallback path", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    saveThread(database, {
      id: "thread_catch",
      projectId: project.id,
      title: "Catch",
      source: "codex",
      rawFormat: "markdown",
      rawText: "summary"
    });
    let intercepted = false;
    const wrappedDb = Object.create(database) as Database.Database;
    wrappedDb.prepare = ((sql: string) => {
      const statement = database.prepare(sql);
      if (!intercepted && sql.includes("insert or ignore into memories")) {
        intercepted = true;
        return {
          run(params: Record<string, unknown>) {
            database
              .prepare(
                `insert into memories (id, project_id, thread_id, title, kind, content, source, confidence, content_hash, importance, created_at)
                 values ('memory_catch_winner', @projectId, @threadId, 'Catch fallback winner', @kind, @content, @source, @confidence, @contentHash, @importance, @createdAt)`
              )
              .run(params);
            database
              .prepare("insert into memory_fts (id, project_id, title, content) values (?, ?, ?, ?)")
              .run("memory_catch_winner", params.projectId, "Catch fallback winner", params.content);
            throw new Error("simulated insert failure after concurrent duplicate");
          }
        };
      }
      return statement;
    }) as Database.Database["prepare"];
    wrappedDb.transaction = ((fn: () => unknown) => () => fn()) as Database.Database["transaction"];

    const memory = addMemory(wrappedDb, {
      projectId: project.id,
      threadId: "thread_catch",
      title: "Catch duplicate",
      kind: "decision",
      content: "A duplicate may exist when the insert throws.",
      source: "manual",
      confidence: 1,
      importance: 5
    });

    expect(memory).toMatchObject({ id: "memory_catch_winner", title: "Catch fallback winner" });
    expect(listMemoriesForProject(database, project.id)).toHaveLength(1);
  });

  test("rethrows addMemory insert errors when no duplicate exists", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    const wrappedDb = Object.create(database) as Database.Database;
    wrappedDb.transaction = ((fn: () => unknown) => () => fn()) as Database.Database["transaction"];
    wrappedDb.prepare = ((sql: string) => {
      if (sql.includes("insert or ignore into memories")) {
        return { run: () => { throw new Error("insert exploded"); } };
      }
      return database.prepare(sql);
    }) as Database.Database["prepare"];

    expect(() =>
      addMemory(wrappedDb, {
        projectId: project.id,
        title: "Explode",
        kind: "note",
        content: "This insert should fail.",
        source: "manual",
        confidence: 1,
        importance: 5
      })
    ).toThrow("insert exploded");
  });

  test("rejects direct re-add of superseded content", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    const predecessor = addMemory(database, {
      projectId: project.id, title: "Original", kind: "decision", content: "Original decision.",
      source: "manual", confidence: 1, importance: 8
    });
    updateMemory(database, {
      projectId: project.id, memoryId: predecessor.id, content: "Current decision.", actor: "cli"
    });

    expect(() => addMemory(database, {
      projectId: project.id, title: "Original again", kind: "decision", content: predecessor.content,
      source: "manual", confidence: 1, importance: 8
    })).toThrow(/already exists with status superseded/);
  });

  test("limits search results and lists top memories without loading all rows", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    const high = addMemory(database, {
      projectId: project.id,
      title: "High MCP",
      kind: "decision",
      content: "MCP bounded search memory.",
      source: "manual",
      confidence: 1,
      importance: 9
    });
    addMemory(database, {
      projectId: project.id,
      title: "Low MCP",
      kind: "note",
      content: "MCP bounded search memory.",
      source: "manual",
      confidence: 1,
      importance: 1
    });

    expect(searchMemories(database, project.id, "MCP", { limit: 1 })).toHaveLength(1);
    expect(listTopMemoriesForProject(database, project.id, 1)).toEqual([high]);
  });


  test("cleans FTS records when project memories are deleted", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    addMemory(database, {
      projectId: project.id,
      title: "Ghost prevention",
      kind: "decision",
      content: "Deleted memories must not remain searchable.",
      source: "manual",
      confidence: 1,
      importance: 8
    });

    deleteMemoriesForProject(database, project.id);

    expect(listMemoriesForProject(database, project.id)).toEqual([]);
    expect(searchMemories(database, project.id, "Ghost")).toEqual([]);
  });
});
