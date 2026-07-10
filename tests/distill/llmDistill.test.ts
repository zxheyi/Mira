import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import {
  applyLlmDistillCandidates,
  buildLlmDistillPrompt,
  buildLlmDistillPromptForThread,
  parseLlmMemoryCandidates
} from "../../src/distill/llmDistill.js";
import { addMemory, searchMemories } from "../../src/memory/memoryStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { saveThread } from "../../src/threads/threadStore.js";

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

describe("LLM distill", () => {
  test("builds a prompt with schema, memory kinds, and thread text", () => {
    const prompt = buildLlmDistillPrompt({
      threadId: "thread_1",
      rawText: "# Session\n\nWe decided to keep storage local."
    });

    expect(prompt).toContain("thread_1");
    expect(prompt).toContain('"memories"');
    expect(prompt).toContain("decision");
    expect(prompt).toContain("architecture");
    expect(prompt).toContain("We decided to keep storage local.");
  });

  test("builds a prompt from a saved thread", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    saveThread(database, {
      id: "thread_1",
      projectId: project.id,
      title: "LLM Distill",
      source: "codex",
      rawFormat: "markdown",
      rawText: "## Summary\nMira needs candidate review."
    });

    const prompt = buildLlmDistillPromptForThread(database, project.id, "thread_1");

    expect(prompt).toContain("Mira needs candidate review.");
  });

  test("parses candidates from wrapped JSON and applies defaults", () => {
    const candidates = parseLlmMemoryCandidates(
      JSON.stringify({
        memories: [
          {
            title: "Use local SQLite",
            kind: "decision",
            content: "Mira stores project memory in local SQLite."
          }
        ]
      })
    );

    expect(candidates).toEqual([
      {
        title: "Use local SQLite",
        kind: "decision",
        content: "Mira stores project memory in local SQLite.",
        confidence: 0.8,
        importance: 5
      }
    ]);
  });

  test("rejects unsupported candidate kinds", () => {
    expect(() =>
      parseLlmMemoryCandidates(
        JSON.stringify({
          memories: [
            {
              title: "Bad kind",
              kind: "random",
              content: "This should not be accepted."
            }
          ]
        })
      )
    ).toThrow("Unsupported memory kind");
  });

  test("applies candidates as the replacement distill output for a thread", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    saveThread(database, {
      id: "thread_1",
      projectId: project.id,
      title: "LLM Distill",
      source: "codex",
      rawFormat: "markdown",
      rawText: "# Session"
    });
    addMemory(database, {
      projectId: project.id,
      threadId: "thread_1",
      title: "Old memory",
      kind: "note",
      content: "This stale memory should be replaced.",
      source: "distill:thread_1",
      confidence: 1,
      importance: 4
    });

    const memories = applyLlmDistillCandidates(database, project.id, "thread_1", [
      {
        title: "Use local SQLite",
        kind: "decision",
        content: "Mira stores project memory in local SQLite.",
        confidence: 0.9,
        importance: 8
      }
    ]);

    expect(memories).toEqual([
      expect.objectContaining({
        title: "Use local SQLite",
        kind: "decision",
        content: "Mira stores project memory in local SQLite.",
        source: "llm-distill:thread_1"
      })
    ]);
    expect(searchMemories(database, project.id, "stale")).toEqual([]);
    expect(searchMemories(database, project.id, "SQLite")[0]?.memory.title).toBe("Use local SQLite");
  });
});
