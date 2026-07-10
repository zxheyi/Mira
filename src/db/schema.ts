import type Database from "better-sqlite3";

const CURRENT_SCHEMA_VERSION = 1;

export function migrate(db: Database.Database): void {
  db.exec(`
    create table if not exists schema_version (
      version integer primary key,
      applied_at text not null
    );

    create table if not exists projects (
      id text primary key,
      name text not null,
      root_path text not null unique,
      created_at text not null
    );

    create table if not exists threads (
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

    create table if not exists working_memory (
      id text primary key,
      project_id text not null,
      kind text not null,
      content text not null,
      updated_at text not null,
      unique(project_id, kind),
      foreign key (project_id) references projects(id) on delete cascade
    );

    create table if not exists memories (
      id text primary key,
      project_id text not null,
      thread_id text,
      title text not null,
      kind text not null,
      content text not null,
      source text not null,
      confidence real not null,
      content_hash text not null,
      importance integer not null,
      created_at text not null,
      foreign key (project_id) references projects(id) on delete cascade,
      foreign key (thread_id) references threads(id) on delete set null
    );

    create unique index if not exists memories_thread_content_unique
      on memories(project_id, thread_id, kind, content_hash)
      where thread_id is not null;

    create unique index if not exists memories_project_content_unique
      on memories(project_id, kind, content_hash)
      where thread_id is null;

    create virtual table if not exists memory_fts using fts5(
      id unindexed,
      project_id unindexed,
      title,
      content
    );
  `);

  const existingVersion = db
    .prepare("select version from schema_version order by version desc limit 1")
    .pluck()
    .get() as number | undefined;

  if (existingVersion === undefined) {
    db.prepare("insert into schema_version (version, applied_at) values (?, ?)").run(
      CURRENT_SCHEMA_VERSION,
      new Date().toISOString()
    );
  }
}
