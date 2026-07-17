import type Database from "better-sqlite3";

const CURRENT_SCHEMA_VERSION = 2;

export function migrate(db: Database.Database): void {
  db.exec(`
    create table if not exists schema_version (
      version integer primary key,
      applied_at text not null
    );
  `);

  const existingVersion = db
    .prepare("select version from schema_version order by version desc limit 1")
    .pluck()
    .get() as number | undefined;

  if (existingVersion !== undefined && existingVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Mira schema version ${existingVersion}; this Mira supports schema version ${CURRENT_SCHEMA_VERSION}`
    );
  }

  db.exec(`
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
      foreign key (thread_id) references threads(id) on delete cascade
    );

    create unique index if not exists memories_thread_content_unique
      on memories(project_id, thread_id, kind, content_hash)
      where thread_id is not null;

    create unique index if not exists memories_project_content_unique
      on memories(project_id, kind, content_hash)
      where thread_id is null;

    create index if not exists idx_memories_project
      on memories(project_id);

    create index if not exists idx_memories_project_thread
      on memories(project_id, thread_id);

    create index if not exists idx_memories_thread
      on memories(thread_id);

    create index if not exists idx_threads_project
      on threads(project_id);

    create table if not exists integration_cursors (
      project_id text not null,
      agent text not null,
      session_id text not null,
      transcript_path text not null,
      size integer not null,
      mtime_ms real not null,
      updated_at text not null,
      primary key (project_id, agent, session_id),
      foreign key (project_id) references projects(id) on delete cascade
    );

    create virtual table if not exists memory_fts using fts5(
      id unindexed,
      project_id unindexed,
      title,
      content
    );

    create trigger if not exists memories_after_insert_sync_fts
    after insert on memories
    begin
      insert into memory_fts (id, project_id, title, content)
      values (new.id, new.project_id, new.title, new.content);
    end;

    create trigger if not exists memories_after_update_sync_fts
    after update of project_id, title, content on memories
    begin
      delete from memory_fts where id = old.id;
      insert into memory_fts (id, project_id, title, content)
      values (new.id, new.project_id, new.title, new.content);
    end;

    create trigger if not exists memories_after_delete_cleanup_fts
    after delete on memories
    begin
      delete from memory_fts where id = old.id;
    end;
  `);

  if (existingVersion === undefined || existingVersion < CURRENT_SCHEMA_VERSION) {
    db.prepare("insert into schema_version (version, applied_at) values (?, ?)").run(
      CURRENT_SCHEMA_VERSION,
      new Date().toISOString()
    );
  }
}
