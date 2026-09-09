-- Schema v3; source a7c9db27c8545464c591d531adfeb10f5648aee6
CREATE TABLE schema_version (
      version integer primary key,
      applied_at text not null
    );

CREATE TABLE projects (
      id text primary key,
      name text not null,
      root_path text not null unique,
      created_at text not null
    );

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
      foreign key (project_id) references projects(id) on delete cascade,
      foreign key (thread_id) references threads(id) on delete cascade
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

CREATE VIRTUAL TABLE memory_fts using fts5(
      id unindexed,
      project_id unindexed,
      title,
      content
    );

CREATE UNIQUE INDEX memories_thread_content_unique
      on memories(project_id, thread_id, kind, content_hash)
      where thread_id is not null;

CREATE UNIQUE INDEX memories_project_content_unique
      on memories(project_id, kind, content_hash)
      where thread_id is null;

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

CREATE TRIGGER memories_after_insert_sync_fts
    after insert on memories
    begin
      insert into memory_fts (id, project_id, title, content)
      values (new.id, new.project_id, new.title, new.content);
    end;

CREATE TRIGGER memories_after_update_sync_fts
    after update of project_id, title, content on memories
    begin
      delete from memory_fts where id = old.id;
      insert into memory_fts (id, project_id, title, content)
      values (new.id, new.project_id, new.title, new.content);
    end;

CREATE TRIGGER memories_after_delete_cleanup_fts
    after delete on memories
    begin
      delete from memory_fts where id = old.id;
    end;

insert into schema_version (version,applied_at) values (3,'2026-01-01T00:00:00.000Z');
insert into projects (id,name,root_path,created_at) values ('project_fixture','Historical fixture','/fixture','2026-01-01T00:00:00.000Z');
insert into threads (id,project_id,title,source,raw_format,raw_text,created_at,updated_at) values ('thread_fixture','project_fixture','Original source','codex','markdown','Persisted legacy fact.','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
insert into memories (id,project_id,thread_id,title,kind,content,source,confidence,content_hash,importance,created_at) values ('memory_fixture','project_fixture','thread_fixture','Legacy fact','fact','Persisted legacy fact.','manual',1,'f152004811bef681cba0eb8d5d2ed6537289e038bef45ea70f5fa70eebd8477f',5,'2026-01-01T00:00:00.000Z');
insert into distill_jobs (id,project_id,thread_id,trigger,channel,input_hash,status,attempts,created_at,updated_at) values ('job_fixture','project_fixture','thread_fixture','cli','provider','input-fixture','pending',0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
insert into memory_candidates (id,project_id,thread_id,job_id,thread_input_hash,title,kind,content,confidence,importance,source_agent,extraction_method,evidence,content_hash,risk_level,status,created_at) values ('candidate_fixture','project_fixture','thread_fixture','job_fixture','input-fixture','Candidate fixture','fact','Persisted legacy fact.',0.8,0.5,'codex','agent','Persisted legacy fact.','f152004811bef681cba0eb8d5d2ed6537289e038bef45ea70f5fa70eebd8477f','low','pending_review','2026-01-01T00:00:00.000Z');
