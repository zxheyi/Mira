-- Schema v7; source a1157ee258438ba4120b4394aff127d8579dfb49
CREATE TABLE schema_version (
      version integer primary key,
      applied_at text not null
    );

CREATE TABLE projects (
      id text primary key,
      name text not null,
      root_path text not null unique,
      created_at text not null
    , repository_key text);

CREATE TABLE threads (
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

CREATE TABLE working_memory (
      id text primary key,
      project_id text not null,
      kind text not null,
      content text not null,
      updated_at text not null,
      unique(project_id, kind),
      foreign key (project_id) references projects(id) on delete cascade
    );

CREATE TABLE memories (
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

CREATE TABLE integration_cursors (
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

CREATE TABLE distill_jobs (
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

CREATE TABLE memory_candidates (
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

CREATE TABLE memory_events (
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

CREATE VIRTUAL TABLE memory_fts using fts5(
      id unindexed,
      project_id unindexed,
      title,
      content
    );

CREATE TABLE project_briefings (
      id text primary key,
      project_id text not null,
      version integer not null check (version > 0),
      markdown text not null,
      source_memory_ids text not null default '[]'
        check (json_valid(source_memory_ids) and json_type(source_memory_ids) = 'array'),
      source_thread_ids text not null default '[]'
        check (json_valid(source_thread_ids) and json_type(source_thread_ids) = 'array'),
      source_working_memory_ids text not null default '[]'
        check (json_valid(source_working_memory_ids) and json_type(source_working_memory_ids) = 'array'),
      generation_method text not null check (generation_method in ('deterministic')),
      character_count integer not null check (character_count >= 0),
      estimated_tokens integer not null check (estimated_tokens >= 0),
      status text not null check (status in ('complete', 'failed')),
      stale_at text,
      error text,
      created_at text not null,
      unique(project_id, version),
      foreign key (project_id) references projects(id) on delete cascade
    );

CREATE TABLE history_import_runs (
      id text primary key,
      project_id text not null,
      status text not null
        check (status in ('running', 'completed', 'completed_with_errors', 'failed', 'interrupted')),
      agents text not null
        check (json_valid(agents) and json_type(agents) = 'array'),
      root_aliases text not null default '[]'
        check (json_valid(root_aliases) and json_type(root_aliases) = 'array'),
      options text not null default '{}'
        check (json_valid(options) and json_type(options) = 'object'),
      scanned_count integer not null default 0 check (scanned_count >= 0),
      imported_count integer not null default 0 check (imported_count >= 0),
      updated_count integer not null default 0 check (updated_count >= 0),
      unchanged_count integer not null default 0 check (unchanged_count >= 0),
      skipped_count integer not null default 0 check (skipped_count >= 0),
      failed_count integer not null default 0 check (failed_count >= 0),
      started_at text not null,
      finished_at text,
      error text,
      foreign key (project_id) references projects(id) on delete cascade
    );

CREATE TABLE history_import_items (
      id text primary key,
      run_id text not null,
      agent text not null check (agent in ('codex', 'claude-code')),
      session_id text,
      file_path text not null,
      recorded_cwd text,
      fingerprint text,
      outcome text not null check (outcome in ('imported', 'updated', 'unchanged', 'skipped', 'failed')),
      thread_id text,
      distill_status text not null
        check (distill_status in ('not_requested', 'not_applicable', 'queued', 'failed')),
      error_stage text,
      error_reason text,
      created_at text not null,
      unique(run_id, file_path),
      foreign key (run_id) references history_import_runs(id) on delete cascade,
      foreign key (thread_id) references threads(id) on delete set null
    );

CREATE TABLE project_roots (
      root_path text primary key,
      project_id text not null references projects(id) on delete cascade
    );

CREATE TABLE task_working_memory (
      id text primary key,
      project_id text not null references projects(id) on delete cascade,
      task_id text not null check(length(trim(task_id)) between 1 and 500),
      kind text not null,
      content text not null,
      updated_at text not null,
      unique(project_id, task_id, kind)
    );

CREATE INDEX idx_memories_project
      on memories(project_id);

CREATE INDEX idx_memories_project_thread
      on memories(project_id, thread_id);

CREATE INDEX idx_memories_thread
      on memories(thread_id);

CREATE INDEX idx_threads_project
      on threads(project_id);

CREATE INDEX idx_distill_jobs_status_created
      on distill_jobs(status, created_at);

CREATE INDEX idx_distill_jobs_project_thread
      on distill_jobs(project_id, thread_id);

CREATE INDEX idx_memory_candidates_project_status
      on memory_candidates(project_id, status, created_at);

CREATE INDEX idx_memory_candidates_thread
      on memory_candidates(thread_id);

CREATE INDEX idx_memory_candidates_job
      on memory_candidates(job_id);

CREATE INDEX idx_memory_events_memory_created
      on memory_events(memory_id, created_at);

CREATE INDEX idx_memory_events_project_created
      on memory_events(project_id, created_at);

CREATE UNIQUE INDEX memories_thread_content_unique
      on memories(project_id, thread_id, kind, content_hash)
      where thread_id is not null and status = 'active';

CREATE UNIQUE INDEX memories_project_content_unique
      on memories(project_id, kind, content_hash)
      where thread_id is null and status = 'active';

CREATE UNIQUE INDEX idx_memories_single_successor
      on memories(supersedes_memory_id)
      where supersedes_memory_id is not null;

CREATE INDEX idx_project_briefings_project_version
      on project_briefings(project_id, version desc);

CREATE INDEX idx_project_briefings_project_status
      on project_briefings(project_id, status, version desc);

CREATE INDEX idx_history_import_runs_project_started
      on history_import_runs(project_id, started_at desc);

CREATE INDEX idx_history_import_items_run_outcome
      on history_import_items(run_id, outcome, created_at);

CREATE INDEX idx_history_import_items_thread
      on history_import_items(thread_id);

CREATE UNIQUE INDEX idx_projects_repository_key on projects(repository_key) where repository_key is not null;

CREATE TRIGGER memories_after_insert_sync_fts
    after insert on memories when new.status = 'active'
    begin
      insert into memory_fts (id, project_id, title, content)
      values (new.id, new.project_id, new.title, new.content);
    end;

CREATE TRIGGER memories_after_update_sync_fts
    after update of project_id, title, content, status on memories
    begin
      delete from memory_fts where id = old.id;
      insert into memory_fts (id, project_id, title, content)
      select new.id, new.project_id, new.title, new.content
      where new.status = 'active';
    end;

CREATE TRIGGER memories_after_delete_cleanup_fts
    after delete on memories
    begin
      delete from memory_fts where id = old.id;
    end;

CREATE TRIGGER memories_after_insert_stale_briefing
    after insert on memories
    begin
      update project_briefings
      set stale_at = coalesce(stale_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      where project_id = new.project_id and status = 'complete' and stale_at is null;
    end;

CREATE TRIGGER memories_after_update_stale_briefing
    after update on memories
    begin
      update project_briefings
      set stale_at = coalesce(stale_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      where project_id = new.project_id and status = 'complete' and stale_at is null;
    end;

CREATE TRIGGER memories_after_delete_stale_briefing
    after delete on memories
    begin
      update project_briefings
      set stale_at = coalesce(stale_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      where project_id = old.project_id and status = 'complete' and stale_at is null;
    end;

CREATE TRIGGER working_memory_after_insert_stale_briefing
    after insert on working_memory
    begin
      update project_briefings
      set stale_at = coalesce(stale_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      where project_id = new.project_id and status = 'complete' and stale_at is null;
    end;

CREATE TRIGGER working_memory_after_update_stale_briefing
    after update on working_memory
    begin
      update project_briefings
      set stale_at = coalesce(stale_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      where project_id = new.project_id and status = 'complete' and stale_at is null;
    end;

CREATE TRIGGER working_memory_after_delete_stale_briefing
    after delete on working_memory
    begin
      update project_briefings
      set stale_at = coalesce(stale_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      where project_id = old.project_id and status = 'complete' and stale_at is null;
    end;

insert into schema_version (version,applied_at) values (7,'2026-01-01T00:00:00.000Z');
insert into projects (id,name,root_path,created_at) values ('project_fixture','Historical fixture','/fixture','2026-01-01T00:00:00.000Z');
insert into threads (id,project_id,title,source,raw_format,raw_text,created_at,updated_at) values ('thread_fixture','project_fixture','Original source','codex','markdown','Persisted legacy fact.','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
insert into memories (id,project_id,thread_id,title,kind,content,source,confidence,content_hash,importance,created_at,updated_at,status) values ('memory_fixture','project_fixture','thread_fixture','Legacy fact','fact','Persisted legacy fact.','manual',1,'f152004811bef681cba0eb8d5d2ed6537289e038bef45ea70f5fa70eebd8477f',5,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','active');
insert into distill_jobs (id,project_id,thread_id,trigger,channel,input_hash,status,attempts,created_at,updated_at) values ('job_fixture','project_fixture','thread_fixture','cli','provider','input-fixture','pending',0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
insert into memory_candidates (id,project_id,thread_id,job_id,thread_input_hash,title,kind,content,confidence,importance,source_agent,extraction_method,evidence,content_hash,risk_level,status,created_at) values ('candidate_fixture','project_fixture','thread_fixture','job_fixture','input-fixture','Candidate fixture','fact','Persisted legacy fact.',0.8,0.5,'codex','agent','Persisted legacy fact.','f152004811bef681cba0eb8d5d2ed6537289e038bef45ea70f5fa70eebd8477f','low','pending_review','2026-01-01T00:00:00.000Z');
