import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { addMemory } from "../../src/memory/memoryStore.js";
import { createProject, findProjectByRoot } from "../../src/projects/projectStore.js";
import { listWorkingMemory, setWorkingMemory } from "../../src/workingMemory/workingMemoryStore.js";
import { enqueueDistillJob, listDistillJobs } from "../../src/distill/distillJobStore.js";
import { saveThread } from "../../src/threads/threadStore.js";

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

// Older focused migration fixtures need the pre-v9 queue table now that v9 alters it.
function addLegacyQueueFixture(database: Database.Database): void {
  database.exec(`create table distill_jobs (
    id text primary key, project_id text not null, thread_id text not null, trigger text not null,
    channel text not null, input_hash text not null, status text not null, attempts integer not null default 0,
    last_error text, created_at text not null, updated_at text not null,
    unique(project_id, thread_id, channel, input_hash),
    foreign key(project_id) references projects(id) on delete cascade,
    foreign key(thread_id) references threads(id) on delete cascade
  )`);
}

describe("database schema", () => {
  test("v8 queue migration preserves existing work and adds a finite retry budget", () => {
    db = openDatabase(":memory:"); migrate(db);
    const project = createProject(db, {name:"Queue migration",rootPath:"/queue-v8"});
    saveThread(db, {id:"queued-thread",projectId:project.id,title:"Source",source:"test",rawFormat:"markdown",rawText:"Preserve queued work."});
    const job = enqueueDistillJob(db, project.id, "queued-thread", "cli");
    db.exec("alter table distill_jobs drop column next_attempt_at; alter table distill_jobs drop column max_attempts; delete from schema_version where version >= 9; insert or ignore into schema_version values (8, '2026-08-01');");
    migrate(db); migrate(db);
    expect(listDistillJobs(db, project.id)[0]).toMatchObject({id:job.id,status:"pending",attempts:0,maxAttempts:3});
  });
  test("v7 migration adds recall audit without changing task or memory state", () => {
    db = openDatabase(":memory:"); migrate(db);
    const project = createProject(db, {name: "Audit", rootPath: "/v7-audit"});
    const memory = addMemory(db, {projectId: project.id, title: "Preserved", content: "Evidence", kind: "fact", source: "manual", confidence: 1, importance: 5});
    setWorkingMemory(db, {projectId: project.id, taskId: "a", kind: "next_step", content: "Preserve task"});
    db.exec("drop table recall_events; delete from schema_version where version >= 8; insert or ignore into schema_version values (7, '2026-08-01');");
    migrate(db); migrate(db);
    expect(tableNames(db)).toContain("recall_events");
    expect(db.prepare("select content from memories where id = ?").pluck().get(memory.id)).toBe("Evidence");
    expect(listWorkingMemory(db, project.id, "a")[0].content).toBe("Preserve task");
  });
  test("v6 project and working state remain readable across the identity migration", () => {
    db = openDatabase(":memory:");
    db.exec(`
      create table schema_version (version integer primary key, applied_at text not null);
      insert into schema_version values (6, '2026-08-01');
      create table projects (id text primary key, name text, root_path text unique, created_at text);
      insert into projects values ('legacy-project', 'Legacy', '/legacy', '2026-08-01');
      create table working_memory (id text primary key, project_id text, kind text, content text, updated_at text, unique(project_id, kind));
      insert into working_memory values ('legacy-work', 'legacy-project', 'next_step', 'Preserve this next step', '2026-08-01');
    `);
    expect(findProjectByRoot(db, '/legacy')?.id).toBe('legacy-project');
    addLegacyQueueFixture(db);
    migrate(db); migrate(db);
    expect(findProjectByRoot(db, '/legacy')?.id).toBe('legacy-project');
    expect(listWorkingMemory(db, 'legacy-project')).toEqual([expect.objectContaining({id: 'legacy-work', content: 'Preserve this next step'})]);
    setWorkingMemory(db, {projectId: 'legacy-project', taskId: 'new-task', kind: 'next_step', content: 'Independent task'});
    expect(listWorkingMemory(db, 'legacy-project')[0].content).toBe('Preserve this next step');
  });

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
        ,"memory_events",
        "history_import_runs",
        "history_import_items",
        "research_cases",
        "research_evidence",
        "research_claims",
        "research_claim_evidence",
        "research_events",
        "lifecycle_sessions",
        "lifecycle_turns",
        "capture_records",
        "domain_events",
        "outbox_messages",
        "source_snapshots",
        "evidence_verifications",
        "outbox_handler_receipts",
        "recall_feedback"
      ])
    );
    expect(tableNames(db)).toContain("project_briefings");
    expect(db.prepare("select version from schema_version order by version desc limit 1").pluck().get()).toBe(14);
  });

  test("v10 migration preserves memory data and scopes research links to one case", () => {
    db = openDatabase(":memory:");
    migrate(db);
    const project = createProject(db, { name: "Research migration", rootPath: "/research-v10" });
    const memory = addMemory(db, {
      projectId: project.id,
      title: "Preserved",
      content: "Existing memory remains intact.",
      kind: "fact",
      source: "manual",
      confidence: 1,
      importance: 5
    });

    db.exec(`
      drop table if exists evidence_verifications;
      drop table if exists source_snapshots;
      drop table if exists research_events;
      drop table if exists research_claim_evidence;
      drop table if exists research_claims;
      drop table if exists research_evidence;
      drop table if exists research_cases;
      delete from schema_version where version >= 11;
      insert or ignore into schema_version values (10, '2026-08-31T00:00:00.000Z');
    `);

    migrate(db);
    migrate(db);

    expect(db.prepare("select content from memories where id = ?").pluck().get(memory.id)).toBe(
      "Existing memory remains intact."
    );
    expect(tableNames(db)).toEqual(
      expect.arrayContaining([
        "research_cases",
        "research_evidence",
        "research_claims",
        "research_claim_evidence",
        "research_events"
      ])
    );
    expect(db.prepare("select max(version) from schema_version").pluck().get()).toBe(14);

    const now = new Date().toISOString();
    db.prepare(
      "insert into research_cases (id, project_id, title, question, as_of_date, status, created_at, updated_at) values (?, ?, ?, ?, ?, 'draft', ?, ?)"
    ).run("case-a", project.id, "A", "Question A", "2026-09-01", now, now);
    db.prepare(
      "insert into research_cases (id, project_id, title, question, as_of_date, status, created_at, updated_at) values (?, ?, ?, ?, ?, 'draft', ?, ?)"
    ).run("case-b", project.id, "B", "Question B", "2026-09-01", now, now);
    db.prepare(
      "insert into research_evidence (id, project_id, case_id, source_type, source_uri, source_title, locator, excerpt, accessed_at, content_hash, state, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', ?, ?)"
    ).run("evidence-a", project.id, "case-a", "regulatory_filing", "https://example.test/a", "A", "p.1", "Excerpt", "2026-09-01", "hash-a", now, now);
    db.prepare(
      "insert into research_claims (id, project_id, case_id, statement, evidence_status, review_status, confidence, thesis_impact, invalidation_conditions, status, created_at, updated_at) values (?, ?, ?, ?, ?, 'pending', ?, ?, ?, 'active', ?, ?)"
    ).run("claim-b", project.id, "case-b", "Claim B", "supported", 0.8, "watch", "Next filing", now, now);

    expect(() => db?.prepare(
      "insert into research_claim_evidence (project_id, case_id, claim_id, evidence_id, relation, rationale) values (?, ?, ?, ?, 'supports', ?)"
    ).run(project.id, "case-b", "claim-b", "evidence-a", "Cross-case link"))
      .toThrow();
  });

  test("v12 to v13 preserves legacy Evidence and reopens approved Claims for verification", () => {
    db = openDatabase(":memory:");
    migrate(db);
    const project = createProject(db, {name: "Legacy research", rootPath: "/research-v12"});
    const now = "2026-08-31T00:00:00.000Z";
    db.prepare(`insert into research_cases (
      id, project_id, title, question, as_of_date, status, created_at, updated_at
    ) values (?, ?, ?, ?, ?, 'completed', ?, ?)`)
      .run("legacy-case", project.id, "Legacy", "What changed?", "2026-08-31", now, now);
    db.prepare(`insert into research_evidence (
      id, project_id, case_id, source_type, source_uri, source_title, locator, excerpt,
      accessed_at, content_hash, state, created_at, updated_at
    ) values (?, ?, ?, 'regulatory_filing', ?, ?, ?, ?, ?, ?, 'current', ?, ?)`)
      .run("legacy-evidence", project.id, "legacy-case", "https://example.test/legacy", "Legacy filing",
        "p. 1", "Legacy excerpt.", "2026-08-31", "legacy-hash", now, now);
    db.prepare(`insert into research_claims (
      id, project_id, case_id, statement, evidence_status, review_status, confidence,
      thesis_impact, invalidation_conditions, status, created_at, updated_at
    ) values (?, ?, ?, ?, 'supported', 'approved', 0.8, 'watch', ?, 'active', ?, ?)`)
      .run("legacy-claim", project.id, "legacy-case", "Legacy claim.", "A later filing differs.", now, now);
    db.exec(`
      drop table evidence_verifications;
      drop table source_snapshots;
      delete from schema_version;
      insert into schema_version values (12, '2026-08-31T00:00:00.000Z');
    `);

    migrate(db);
    migrate(db);

    expect(db.prepare("select snapshot_id from research_evidence where id = 'legacy-evidence'").pluck().get()).toBeNull();
    expect(db.prepare("select review_status from research_claims where id = 'legacy-claim'").pluck().get())
      .toBe("changes_requested");
    expect(db.prepare("select status from research_cases where id = 'legacy-case'").pluck().get())
      .toBe("in_review");
    expect(db.prepare("select max(version) from schema_version").pluck().get()).toBe(14);
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
    expect(db.prepare("select max(version) from schema_version").pluck().get()).toBe(14);
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
    expect(db.prepare("select max(version) from schema_version").pluck().get()).toBe(14);
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
    expect(db.prepare("select max(version) from schema_version").pluck().get()).toBe(14);
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

    addLegacyQueueFixture(db);
    migrate(db);

    expect(db.prepare("select content from memories where id = 'memory_v4'").pluck().get())
      .toBe("Preserve this V4 fact.");
    expect(db.prepare("select count(*) from memory_fts where id = 'memory_v4'").pluck().get()).toBe(1);
    expect(tableNames(db)).toContain("project_briefings");
    expect(db.prepare("select max(version) from schema_version").pluck().get()).toBe(14);
  });

  test("upgrades v5 to v6 without losing data and creates history audit contracts", () => {
    db = openDatabase(":memory:");
    db.exec(`
      create table schema_version (version integer primary key, applied_at text not null);
      insert into schema_version values (5, '2026-07-20T00:00:00.000Z');
      create table projects (
        id text primary key, name text not null, root_path text not null unique, created_at text not null
      );
      create table threads (
        id text primary key, project_id text not null, title text not null, source text not null,
        raw_format text not null, raw_text text not null, created_at text not null, updated_at text not null,
        foreign key (project_id) references projects(id) on delete cascade
      );
      insert into projects values ('project_v5', 'Mira', '/workspace/Mira', '2026-07-20T00:00:00.000Z');
      insert into threads values (
        'thread_v5', 'project_v5', 'Existing', 'codex', 'jsonl', 'Keep me',
        '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'
      );
    `);

    addLegacyQueueFixture(db);
    migrate(db);

    expect(db.prepare("select raw_text from threads where id = 'thread_v5'").pluck().get()).toBe("Keep me");
    expect(columnNames(db, "history_import_runs")).toEqual(expect.arrayContaining([
      "project_id", "status", "agents", "root_aliases", "options", "failed_count", "started_at", "finished_at"
    ]));
    expect(columnNames(db, "history_import_items")).toEqual(expect.arrayContaining([
      "run_id", "agent", "session_id", "file_path", "recorded_cwd", "fingerprint",
      "outcome", "thread_id", "distill_status", "error_stage", "error_reason"
    ]));
    expect(db.prepare("select max(version) from schema_version").pluck().get()).toBe(14);
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
