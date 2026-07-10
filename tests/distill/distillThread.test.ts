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
});
