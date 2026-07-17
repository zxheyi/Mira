import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { addMemory } from "../../src/memory/memoryStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { setWorkingMemory } from "../../src/workingMemory/workingMemoryStore.js";

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function tableNames(database: Database.Database): string[] {
  return database
    .prepare("select name from sqlite_master where type in ('table', 'virtual table') order by name")
    .all()
    .map((row) => (row as { name: string }).name);
}

function columnNames(database: Database.Database, table: string): string[] {
  return database
    .prepare(`pragma table_info(${table})`)
    .all()
    .map((row) => (row as { name: string }).name);
}

describe("database schema", () => {
  test("migrate creates the MVP tables and schema version", () => {
    db = openDatabase(":memory:");

    migrate(db);

    expect(tableNames(db)).toEqual(
      expect.arrayContaining([
        "schema_version",
        "projects",
        "threads",
        "working_memory",
        "memories",
        "memory_fts",
        "integration_cursors",
        "distill_jobs",
        "memory_candidates"
        ,"memory_events"
      ])
    );
    expect(tableNames(db)).toContain("project_briefings");
    expect(db.prepare("select version from schema_version order by version desc limit 1").pluck().get()).toBe(5);
  });

  test("keeps memory FTS synchronized for direct inserts and updates", () => {
    db = openDatabase(":memory:");

    migrate(db);
    db.prepare("insert into projects (id, name, root_path, created_at) values (?, ?, ?, ?)").run(
      "project_fts",
      "Mira",
      "/workspace/mira",
      new Date().toISOString()
    );
    db.prepare(
      `insert into memories (id, project_id, thread_id, title, kind, content, source, confidence, content_hash, importance, created_at)
       values (?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "memory_direct",
      "project_fts",
      "Direct insert",
      "note",
      "Direct insert should be searchable.",
      "test",
      1,
      "hash_direct",
      5,
      new Date().toISOString()
    );

    expect(db.prepare("select count(*) from memory_fts where memory_fts match ?").pluck().get('"Direct insert"')).toBe(1);

    db.prepare("update memories set title = ?, content = ? where id = ?").run(
      "Updated title",
      "Updated memory content is searchable.",
      "memory_direct"
    );

    expect(db.prepare("select count(*) from memory_fts where memory_fts match ?").pluck().get('"Updated memory"')).toBe(1);
  });

  test("threads, memories, and FTS columns preserve planned contracts", () => {
    db = openDatabase(":memory:");

    migrate(db);

    expect(columnNames(db, "threads")).toEqual(expect.arrayContaining(["raw_format"]));
    expect(columnNames(db, "memories")).toEqual(
      expect.arrayContaining(["title", "source", "confidence", "content_hash"])
    );
    expect(columnNames(db, "memory_fts")).toEqual(expect.arrayContaining(["title", "content"]));
    expect(columnNames(db, "integration_cursors")).toEqual(
      expect.arrayContaining(["project_id", "agent", "session_id", "transcript_path", "size", "mtime_ms"])
    );
  });

  test("upgrades an existing version 1 database to the capture cursor schema", () => {
    db = openDatabase(":memory:");
    db.exec(`
      create table schema_version (version integer primary key, applied_at text not null);
      insert into schema_version (version, applied_at) values (1, '2026-07-17T00:00:00.000Z');
    `);

    migrate(db);

    expect(tableNames(db)).toContain("integration_cursors");
    expect(db.prepare("select max(version) from schema_version").pluck().get()).toBe(5);
  });

  test("upgrades version 2 without losing existing data and adds trusted distill contracts", () => {
    db = openDatabase(":memory:");
    db.exec(`
      create table schema_version (version integer primary key, applied_at text not null);
      insert into schema_version (version, applied_at) values (2, '2026-07-17T00:00:00.000Z');
      create table projects (
        id text primary key,
        name text not null,
        root_path text not null unique,
        created_at text not null
      );
      create table threads (
        id text primary key,
        project_id text not null,
        title text not null,
        source text not null,
        raw_format text not null,
        raw_text text not null,
        created_at text not null,
        updated_at text not null,
        foreign key (project_id) references projects(id) on delete cascade
      );
      insert into projects values ('project_existing', 'Existing', '/existing', '2026-07-17T00:00:00.000Z');
      insert into threads values (
        'thread_existing', 'project_existing', 'Existing thread', 'codex', 'markdown',
        'A durable decision.', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z'
      );
    `);

    migrate(db);

    expect(db.prepare("select title from threads where id = ?").pluck().get("thread_existing")).toBe("Existing thread");
    expect(columnNames(db, "distill_jobs")).toEqual(
      expect.arrayContaining(["project_id", "thread_id", "input_hash", "status", "attempts", "last_error"])
    );
    expect(columnNames(db, "memory_candidates")).toEqual(
      expect.arrayContaining([
        "job_id",
        "thread_input_hash",
        "evidence",
        "risk_level",
        "status",
        "review_reason",
        "accepted_memory_id"
      ])
    );
    expect(db.prepare("select max(version) from schema_version").pluck().get()).toBe(5);
  });

  test("upgrades version 3 memories to active lifecycle records", () => {
    db = openDatabase(":memory:");
    db.exec(`
      create table schema_version (version integer primary key, applied_at text not null);
      insert into schema_version values (3, '2026-07-17T00:00:00.000Z');
      create table projects (id text primary key, name text not null, root_path text not null unique, created_at text not null);
      create table threads (
        id text primary key, project_id text not null, title text not null, source text not null,
        raw_format text not null, raw_text text not null, created_at text not null, updated_at text not null,
        foreign key (project_id) references projects(id) on delete cascade
      );
      create table memories (
        id text primary key, project_id text not null, thread_id text, title text not null, kind text not null,
        content text not null, source text not null, confidence real not null, content_hash text not null,
        importance integer not null, created_at text not null,
        foreign key (project_id) references projects(id) on delete cascade,
        foreign key (thread_id) references threads(id) on delete cascade
      );
      insert into projects values ('project_v3', 'V3', '/v3', '2026-07-17T00:00:00.000Z');
      insert into memories values (
        'memory_v3', 'project_v3', null, 'Existing', 'fact', 'Existing fact', 'manual', 1,
        'hash-v3', 8, '2026-07-17T00:00:00.000Z'
      );
    `);

    migrate(db);

    expect(columnNames(db, "memories")).toEqual(
      expect.arrayContaining(["status", "supersedes_memory_id", "updated_at"])
    );
    expect(db.prepare("select status, updated_at from memories where id = 'memory_v3'").get()).toEqual({
      status: "active", updated_at: "2026-07-17T00:00:00.000Z"
    });
    expect(tableNames(db)).toContain("memory_events");
    const info = db.prepare("pragma table_info(memories)").all() as Array<{
      name: string; notnull: number; dflt_value: string | null;
    }>;
    expect(info.find((column) => column.name === "status")).toMatchObject({ notnull: 1 });
    expect(info.find((column) => column.name === "updated_at")).toMatchObject({ notnull: 1 });
    expect(db.prepare("pragma foreign_key_list(memories)").all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ from: "supersedes_memory_id", table: "memories" })])
    );
    expect(db.prepare("pragma index_list(memories)").all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "idx_memories_project" }),
        expect.objectContaining({ name: "idx_memories_project_thread" }),
        expect.objectContaining({ name: "idx_memories_thread" })
      ])
    );
    expect(() => db?.prepare("update memories set status = 'invalid' where id = 'memory_v3'").run()).toThrow(/CHECK/);
    expect(() => db?.prepare("update memories set updated_at = null where id = 'memory_v3'").run()).toThrow(/NOT NULL/);
    expect(db.prepare("select count(*) from memory_fts where memory_fts match ?").pluck().get("Existing")).toBe(1);
    expect(db.prepare("select max(version) from schema_version").pluck().get()).toBe(5);
  });

  test("rolls back a v3 migration before version update when foreign keys are invalid", () => {
    db = openDatabase(":memory:");
    db.pragma("foreign_keys = OFF");
    db.exec(`
      create table schema_version (version integer primary key, applied_at text not null);
      insert into schema_version values (3, '2026-07-17T00:00:00.000Z');
      create table projects (id text primary key, name text not null, root_path text not null unique, created_at text not null);
      create table threads (
        id text primary key, project_id text not null, title text not null, source text not null,
        raw_format text not null, raw_text text not null, created_at text not null, updated_at text not null,
        foreign key (project_id) references projects(id) on delete cascade
      );
      create table memories (
        id text primary key, project_id text not null, thread_id text, title text not null, kind text not null,
        content text not null, source text not null, confidence real not null, content_hash text not null,
        importance integer not null, created_at text not null,
        foreign key (project_id) references projects(id) on delete cascade,
        foreign key (thread_id) references threads(id) on delete cascade
      );
      insert into memories values (
        'memory_orphan', 'missing_project', null, 'Orphan', 'fact', 'Invalid', 'manual', 1,
        'hash-orphan', 5, '2026-07-17T00:00:00.000Z'
      );
    `);
    db.pragma("foreign_keys = ON");

    expect(() => migrate(db as Database.Database)).toThrow(/foreign key violation/);
    expect(db.prepare("select max(version) from schema_version").pluck().get()).toBe(3);
    expect(columnNames(db, "memories")).not.toContain("status");
  });

  test("does not rebuild FTS when an existing v4 database is reopened", () => {
    db = openDatabase(":memory:");
    migrate(db);
    db.prepare("insert into memory_fts (id, project_id, title, content) values (?, ?, ?, ?)")
      .run("sentinel", "project_sentinel", "Sentinel", "Preserve existing v4 FTS state");

    migrate(db);

    expect(db.prepare("select count(*) from memory_fts where id = 'sentinel'").pluck().get()).toBe(1);
  });

  test("upgrades v4 to v5 without rewriting Memory or FTS data", () => {
    db = openDatabase(":memory:");
    db.exec(`
      create table schema_version (version integer primary key, applied_at text not null);
      insert into schema_version values (4, '2026-07-17T00:00:00.000Z');
      create table projects (id text primary key, name text not null, root_path text not null unique, created_at text not null);
      create table threads (
        id text primary key, project_id text not null, title text not null, source text not null,
        raw_format text not null, raw_text text not null, created_at text not null, updated_at text not null
      );
      create table working_memory (
        id text primary key, project_id text not null, kind text not null, content text not null,
        updated_at text not null, unique(project_id, kind)
      );
      create table memories (
        id text primary key, project_id text not null, thread_id text, title text not null, kind text not null,
        content text not null, source text not null, confidence real not null, content_hash text not null,
        importance integer not null, created_at text not null, status text not null,
        supersedes_memory_id text, updated_at text not null
      );
      create virtual table memory_fts using fts5(id unindexed, project_id unindexed, title, content);
      insert into projects values ('project_v4', 'V4', '/v4', '2026-07-17T00:00:00.000Z');
      insert into memories values (
        'memory_v4', 'project_v4', null, 'Existing V4', 'fact', 'Preserve this V4 fact.',
        'manual', 1, 'hash-v4', 8, '2026-07-17T00:00:00.000Z', 'active', null, '2026-07-17T00:00:00.000Z'
      );
      insert into memory_fts values ('memory_v4', 'project_v4', 'Existing V4', 'Preserve this V4 fact.');
    `);

    migrate(db);

    expect(db.prepare("select content from memories where id = 'memory_v4'").pluck().get())
      .toBe("Preserve this V4 fact.");
    expect(db.prepare("select count(*) from memory_fts where id = 'memory_v4'").pluck().get()).toBe(1);
    expect(tableNames(db)).toContain("project_briefings");
    expect(db.prepare("select max(version) from schema_version").pluck().get()).toBe(5);
  });

  test("marks complete project briefings stale after Memory or Working Memory changes", () => {
    db = openDatabase(":memory:");
    migrate(db);
    const project = createProject(db, { name: "Mira", rootPath: "/workspace/briefing-stale" });
    db.prepare(
      `insert into project_briefings (
        id, project_id, version, markdown, source_memory_ids, source_thread_ids,
        source_working_memory_ids, generation_method, character_count, estimated_tokens,
        status, stale_at, error, created_at
      ) values (?, ?, 1, '# Briefing', '[]', '[]', '[]', 'deterministic', 10, 3, 'complete', null, null, ?)`
    ).run("briefing_1", project.id, new Date().toISOString());

    addMemory(db, {
      projectId: project.id, title: "Decision", kind: "decision", content: "Use SQLite.",
      source: "manual", confidence: 1, importance: 8
    });
    expect(db.prepare("select stale_at from project_briefings where id = 'briefing_1'").pluck().get())
      .toEqual(expect.any(String));

    db.prepare("update project_briefings set stale_at = null where id = 'briefing_1'").run();
    setWorkingMemory(db, { projectId: project.id, kind: "blocker", content: "Waiting for review." });
    expect(db.prepare("select stale_at from project_briefings where id = 'briefing_1'").pluck().get())
      .toEqual(expect.any(String));
  });
});
