import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";

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
      ])
    );
    expect(db.prepare("select version from schema_version order by version desc limit 1").pluck().get()).toBe(3);
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
    expect(db.prepare("select max(version) from schema_version").pluck().get()).toBe(3);
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
    expect(db.prepare("select max(version) from schema_version").pluck().get()).toBe(3);
  });
});
