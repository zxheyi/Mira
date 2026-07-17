import type Database from "better-sqlite3";

const CURRENT_SCHEMA_VERSION = 4;

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

  const hasLegacyMemories = existingVersion !== undefined && existingVersion < 4 && Boolean(
    db.prepare("select 1 from sqlite_master where type = 'table' and name = 'memories'").get()
  );
  const requiresV4Setup = existingVersion === undefined || existingVersion < 4;
  const foreignKeysEnabled = Number(db.pragma("foreign_keys", { simple: true })) === 1;
  if (hasLegacyMemories && foreignKeysEnabled) db.pragma("foreign_keys = OFF");

  try {
    db.transaction(() => {

  if (requiresV4Setup) db.exec(`
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
      status text not null default 'active' check (status in ('active', 'superseded', 'archived', 'rejected')),
      supersedes_memory_id text,
      updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      foreign key (project_id) references projects(id) on delete cascade,
      foreign key (thread_id) references threads(id) on delete cascade,
      foreign key (supersedes_memory_id) references memories(id) on delete restrict
    );

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

    create table if not exists distill_jobs (
      id text primary key,
      project_id text not null,
      thread_id text not null,
      trigger text not null check (trigger in ('hook', 'cli')),
      channel text not null check (channel in ('provider')),
      input_hash text not null,
      status text not null check (status in ('pending', 'running', 'completed', 'failed')),
      attempts integer not null default 0 check (attempts >= 0),
      last_error text,
      created_at text not null,
      updated_at text not null,
      unique(project_id, thread_id, channel, input_hash),
      foreign key (project_id) references projects(id) on delete cascade,
      foreign key (thread_id) references threads(id) on delete cascade
    );

    create index if not exists idx_distill_jobs_status_created
      on distill_jobs(status, created_at);

    create index if not exists idx_distill_jobs_project_thread
      on distill_jobs(project_id, thread_id);

    create table if not exists memory_candidates (
      id text primary key,
      project_id text not null,
      thread_id text not null,
      job_id text,
      thread_input_hash text not null,
      title text not null,
      kind text not null,
      content text not null,
      confidence real not null check (confidence >= 0 and confidence <= 1),
      importance real not null check (importance >= 0 and importance <= 1),
      source_agent text not null,
      source_model text,
      extraction_method text not null check (extraction_method in ('agent', 'provider')),
      evidence text not null,
      content_hash text not null,
      risk_level text not null check (risk_level in ('low', 'high')),
      status text not null check (status in ('pending_review', 'accepted', 'rejected')),
      review_reason text,
      reviewed_at text,
      accepted_memory_id text,
      created_at text not null,
      unique(project_id, thread_id, kind, content_hash, extraction_method, thread_input_hash),
      foreign key (project_id) references projects(id) on delete cascade,
      foreign key (thread_id) references threads(id) on delete cascade,
      foreign key (job_id) references distill_jobs(id) on delete set null,
      foreign key (accepted_memory_id) references memories(id) on delete set null
    );

    create index if not exists idx_memory_candidates_project_status
      on memory_candidates(project_id, status, created_at);

    create index if not exists idx_memory_candidates_thread
      on memory_candidates(thread_id);

    create index if not exists idx_memory_candidates_job
      on memory_candidates(job_id);

    create table if not exists memory_events (
      id text primary key,
      memory_id text not null,
      project_id text not null,
      event_type text not null check (event_type in ('accepted', 'updated', 'superseded', 'archived', 'rejected', 'restored')),
      actor text not null check (length(trim(actor)) > 0),
      reason text,
      metadata text not null default '{}' check (json_valid(metadata)),
      created_at text not null,
      foreign key (memory_id) references memories(id) on delete cascade,
      foreign key (project_id) references projects(id) on delete cascade
    );

    create index if not exists idx_memory_events_memory_created
      on memory_events(memory_id, created_at);

    create index if not exists idx_memory_events_project_created
      on memory_events(project_id, created_at);

    create virtual table if not exists memory_fts using fts5(
      id unindexed,
      project_id unindexed,
      title,
      content
    );

  `);

  if (hasLegacyMemories) {
    db.exec(`
      drop trigger if exists memories_after_insert_sync_fts;
      drop trigger if exists memories_after_update_sync_fts;
      drop trigger if exists memories_after_delete_cleanup_fts;

      create table memories_v4 (
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
        status text not null default 'active' check (status in ('active', 'superseded', 'archived', 'rejected')),
        supersedes_memory_id text,
        updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        foreign key (project_id) references projects(id) on delete cascade,
        foreign key (thread_id) references threads(id) on delete cascade,
        foreign key (supersedes_memory_id) references memories_v4(id) on delete restrict
      );

      insert into memories_v4 (
        id, project_id, thread_id, title, kind, content, source, confidence, content_hash,
        importance, created_at, status, supersedes_memory_id, updated_at
      )
      select id, project_id, thread_id, title, kind, content, source, confidence, content_hash,
             importance, created_at, 'active', null, created_at
      from memories;

      drop table memories;
      alter table memories_v4 rename to memories;
    `);
  }

  if (requiresV4Setup) db.exec(`
    drop index if exists memories_thread_content_unique;
    drop index if exists memories_project_content_unique;

    create unique index memories_thread_content_unique
      on memories(project_id, thread_id, kind, content_hash)
      where thread_id is not null and status = 'active';

    create unique index memories_project_content_unique
      on memories(project_id, kind, content_hash)
      where thread_id is null and status = 'active';

    create index if not exists idx_memories_project
      on memories(project_id);

    create index if not exists idx_memories_project_thread
      on memories(project_id, thread_id);

    create index if not exists idx_memories_thread
      on memories(thread_id);

    create unique index if not exists idx_memories_single_successor
      on memories(supersedes_memory_id)
      where supersedes_memory_id is not null;

    drop trigger if exists memories_after_insert_sync_fts;
    drop trigger if exists memories_after_update_sync_fts;
    drop trigger if exists memories_after_delete_cleanup_fts;

    create trigger memories_after_insert_sync_fts
    after insert on memories when new.status = 'active'
    begin
      insert into memory_fts (id, project_id, title, content)
      values (new.id, new.project_id, new.title, new.content);
    end;

    create trigger memories_after_update_sync_fts
    after update of project_id, title, content, status on memories
    begin
      delete from memory_fts where id = old.id;
      insert into memory_fts (id, project_id, title, content)
      select new.id, new.project_id, new.title, new.content
      where new.status = 'active';
    end;

    create trigger memories_after_delete_cleanup_fts
    after delete on memories
    begin
      delete from memory_fts where id = old.id;
    end;

    delete from memory_fts;
    insert into memory_fts (id, project_id, title, content)
      select id, project_id, title, content from memories where status = 'active';
  `);

  const foreignKeyViolation = db.prepare("pragma foreign_key_check").get();
  if (foreignKeyViolation) throw new Error("Mira schema migration produced a foreign key violation");

  if (requiresV4Setup) {
    db.prepare("insert into schema_version (version, applied_at) values (?, ?)").run(
      CURRENT_SCHEMA_VERSION,
      new Date().toISOString()
    );
  }
    })();
  } finally {
    if (hasLegacyMemories && foreignKeysEnabled) db.pragma("foreign_keys = ON");
  }
}
