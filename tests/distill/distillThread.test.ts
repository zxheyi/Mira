import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { addMemory, listMemoriesForProject, searchMemories } from "../../src/memory/memoryStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { saveThread } from "../../src/threads/threadStore.js";
import { distillMemoriesFromText, distillThreadMemories } from "../../src/distill/distillThread.js";

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

describe("distill thread memories", () => {
  test("extracts deterministic memories from common markdown headings", () => {
    const memories = distillMemoriesFromText("project_1", "thread_1", `# Session

## Key Decisions
- Use one MCP stdio server per project.

## Conventions
- Keep implementation small and local-first.

## What we learned
- Repeated distill must be idempotent.`);

    expect(memories).toEqual([
      expect.objectContaining({
        projectId: "project_1",
        threadId: "thread_1",
        kind: "decision",
        title: "Use one MCP stdio server per project",
        content: "Use one MCP stdio server per project."
      }),
      expect.objectContaining({
        kind: "convention",
        title: "Keep implementation small and local-first",
        content: "Keep implementation small and local-first."
      }),
      expect.objectContaining({
        kind: "lesson",
        title: "Repeated distill must be idempotent",
        content: "Repeated distill must be idempotent."
      })
    ]);
  });

  test("extracts planned task, fact, and failed attempt kinds", () => {
    const memories = distillMemoriesFromText("project_1", "thread_1", `# Session

## Tasks
- Import real Codex transcripts.

## Facts
- Mira stores memories in SQLite.

## Failed Attempts
- Reading browser auth files is not a safe import path.`);

    expect(memories).toEqual([
      expect.objectContaining({ kind: "task", content: "Import real Codex transcripts." }),
      expect.objectContaining({ kind: "fact", content: "Mira stores memories in SQLite." }),
      expect.objectContaining({
        kind: "failed_attempt",
        content: "Reading browser auth files is not a safe import path."
      })
    ]);
  });

  test("extracts architecture, preference, note, and todo headings", () => {
    const memories = distillMemoriesFromText("project_1", "thread_1", `# Session

## Architecture
- The MCP server is project-scoped.

## Preferences
- Keep summaries compact.

## Notes
- Mira keeps local SQLite data.

## Todos
- Add more transcript adapters.`);

    expect(memories).toEqual([
      expect.objectContaining({ kind: "architecture", content: "The MCP server is project-scoped." }),
      expect.objectContaining({ kind: "preference", content: "Keep summaries compact." }),
      expect.objectContaining({ kind: "note", content: "Mira keeps local SQLite data." }),
      expect.objectContaining({ kind: "todo", content: "Add more transcript adapters." })
    ]);
  });

  test("extracts constraint headings and preserves unmatched headings as notes", () => {
    const memories = distillMemoriesFromText("project_1", "thread_1", `# Session

## Constraints
- Do not read browser auth databases.

## MVP Shape
- Local-first memory for coding agents.`);

    expect(memories).toEqual([
      expect.objectContaining({ kind: "constraint", content: "Do not read browser auth databases." }),
      expect.objectContaining({ kind: "note", content: "Local-first memory for coding agents." })
    ]);
  });

  test("merges indented bullet continuation lines into the previous entry", () => {
    const memories = distillMemoriesFromText("project_1", "thread_1", `# Session

## Key Decisions
- Use SQLite for local storage
  because it works without a server.
- Keep MCP stdio-only.`);

    expect(memories.map((memory) => memory.content)).toEqual([
      "Use SQLite for local storage because it works without a server.",
      "Keep MCP stdio-only."
    ]);
  });

  test("throws when distilling a missing thread", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });

    expect(() => distillThreadMemories(database, project.id, "missing_thread")).toThrow(
      "Thread not found: missing_thread"
    );
  });

  test("clears old memories before writing the latest distill result", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    saveThread(database, {
      id: "thread_1",
      projectId: project.id,
      title: "Planning",
      source: "codex",
      rawFormat: "markdown",
      rawText: "## Key Decisions\n- Old decision."
    });
    addMemory(database, {
      projectId: project.id,
      threadId: "thread_1",
      title: "Old decision",
      kind: "decision",
      content: "Old decision.",
      source: "distill:thread_1",
      confidence: 1,
      importance: 8
    });

    saveThread(database, {
      id: "thread_1",
      projectId: project.id,
      title: "Planning",
      source: "codex",
      rawFormat: "markdown",
      rawText: "## Key Decisions\n- New decision."
    });
    const distilled = distillThreadMemories(database, project.id, "thread_1");

    expect(distilled.map((memory) => memory.content)).toEqual(["New decision."]);
    expect(listMemoriesForProject(database, project.id).map((memory) => memory.content)).toEqual([
      "New decision."
    ]);
    expect(searchMemories(database, project.id, "Old")).toEqual([]);
  });

  test("rolls back replacement memories when a distill write fails", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    saveThread(database, {
      id: "thread_rollback",
      projectId: project.id,
      title: "Rollback",
      source: "codex",
      rawFormat: "markdown",
      rawText: "## Key Decisions\n- New memory should not persist when write fails."
    });
    addMemory(database, {
      projectId: project.id,
      threadId: "thread_rollback",
      title: "Old memory",
      kind: "decision",
      content: "Old memory should remain after rollback.",
      source: "manual",
      confidence: 1,
      importance: 5
    });
    database.exec(`
      create trigger fail_distill_insert before insert on memories
      when new.source = 'distill:thread_rollback'
      begin
        select raise(abort, 'distill insert failed');
      end;
    `);

    expect(() => distillThreadMemories(database, project.id, "thread_rollback")).toThrow("distill insert failed");
    expect(searchMemories(database, project.id, "Old memory")[0]?.memory.content).toBe(
      "Old memory should remain after rollback."
    );
  });

  test("keeps old memories when deterministic distill produces no new memories", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    saveThread(database, {
      id: "thread_1",
      projectId: project.id,
      title: "Planning",
      source: "codex",
      rawFormat: "markdown",
      rawText: "## Key Decisions\n- Keep this decision."
    });
    distillThreadMemories(database, project.id, "thread_1");
    saveThread(database, {
      id: "thread_1",
      projectId: project.id,
      title: "Planning",
      source: "codex",
      rawFormat: "markdown",
      rawText: "# Empty"
    });

    expect(distillThreadMemories(database, project.id, "thread_1")).toEqual([]);
    expect(searchMemories(database, project.id, "decision")[0]?.memory.content).toBe("Keep this decision.");
  });

});
