import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import {
  createProject,
  deleteProject,
  ensureProjectForRoot,
  findProjectByRoot,
  listProjects
} from "../../src/projects/projectStore.js";
import { addMemory } from "../../src/memory/memoryStore.js";
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

describe("project store", () => {
  test("creates and finds a project by root path", () => {
    const database = setupDb();

    const created = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    const found = findProjectByRoot(database, "/workspace/mira");

    expect(found).toEqual(created);
    expect(created).toMatchObject({ name: "Mira", rootPath: "/workspace/mira" });
    expect(created.id).toMatch(/^project_/);
    expect(new Date(created.createdAt).toString()).not.toBe("Invalid Date");
  });

  test("ensureProjectForRoot returns an existing project instead of duplicating it", () => {
    const database = setupDb();
    const created = createProject(database, { name: "Custom Name", rootPath: "/workspace/custom" });

    const ensured = ensureProjectForRoot(database, "/workspace/custom");

    expect(ensured).toEqual(created);
    expect(listProjects(database)).toHaveLength(1);
  });

  test("ensureProjectForRoot creates a project using the root directory name", () => {
    const database = setupDb();

    const ensured = ensureProjectForRoot(database, "/workspace/new-app");

    expect(ensured).toMatchObject({ name: "new-app", rootPath: "/workspace/new-app" });
    expect(findProjectByRoot(database, "/workspace/new-app")).toEqual(ensured);
  });

  test("lists projects by creation time", () => {
    const database = setupDb();
    const first = createProject(database, { name: "First", rootPath: "/workspace/first" });
    const second = createProject(database, { name: "Second", rootPath: "/workspace/second" });

    expect(listProjects(database)).toEqual([first, second]);
  });

  test("ensureProjectForRoot remains idempotent for repeated callers", () => {
    const database = setupDb();
    const rootPath = "/workspace/race";

    const first = ensureProjectForRoot(database, rootPath);
    const second = ensureProjectForRoot(database, rootPath);

    expect(second).toEqual(first);
    expect(listProjects(database)).toHaveLength(1);
  });

  test("removes cascaded project memories from the FTS index", () => {
    const database = setupDb();
    const project = createProject(database, { name: "Mira", rootPath: "/workspace/mira" });
    saveThread(database, {
      id: "thread_project_cascade",
      projectId: project.id,
      title: "Project cascade",
      source: "codex",
      rawFormat: "markdown",
      rawText: "Project cascade transcript"
    });
    addMemory(database, {
      projectId: project.id,
      threadId: "thread_project_cascade",
      title: "Cascade cleanup",
      kind: "decision",
      content: "Project deletion must remove the FTS row.",
      source: "manual",
      confidence: 1,
      importance: 8
    });

    expect(database.prepare("select count(*) from memory_fts").pluck().get()).toBe(1);

    deleteProject(database, project.id);

    expect(database.prepare("select count(*) from memories").pluck().get()).toBe(0);
    expect(database.prepare("select count(*) from memory_fts").pluck().get()).toBe(0);
  });

});
