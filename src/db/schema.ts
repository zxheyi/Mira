import type Database from "better-sqlite3";

export const CURRENT_SCHEMA_VERSION = 13;

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
  const requiresV5Setup = existingVersion === undefined || existingVersion < 5;
  const requiresV6Setup = existingVersion === undefined || existingVersion < 6;
  const requiresV7Setup = existingVersion === undefined || existingVersion < 7;
  const requiresV8Setup = existingVersion === undefined || existingVersion < 8;
  const requiresV9Setup = existingVersion === undefined || existingVersion < 9;
  const requiresV10Setup = existingVersion === undefined || existingVersion < 10;
  const requiresV11Setup = existingVersion === undefined || existingVersion < 11;
  const requiresV12Setup = existingVersion === undefined || existingVersion < 12;
  const requiresV13Setup = existingVersion === undefined || existingVersion < 13;
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
      thread_id text,
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

  if (requiresV5Setup) db.exec(`
    create table if not exists project_briefings (
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

    create index if not exists idx_project_briefings_project_version
      on project_briefings(project_id, version desc);

    create index if not exists idx_project_briefings_project_status
      on project_briefings(project_id, status, version desc);

    create trigger if not exists memories_after_insert_stale_briefing
    after insert on memories
    begin
      update project_briefings
      set stale_at = coalesce(stale_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      where project_id = new.project_id and status = 'complete' and stale_at is null;
    end;

    create trigger if not exists memories_after_update_stale_briefing
    after update on memories
    begin
      update project_briefings
      set stale_at = coalesce(stale_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      where project_id = new.project_id and status = 'complete' and stale_at is null;
    end;

    create trigger if not exists memories_after_delete_stale_briefing
    after delete on memories
    begin
      update project_briefings
      set stale_at = coalesce(stale_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      where project_id = old.project_id and status = 'complete' and stale_at is null;
    end;

    create trigger if not exists working_memory_after_insert_stale_briefing
    after insert on working_memory
    begin
      update project_briefings
      set stale_at = coalesce(stale_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      where project_id = new.project_id and status = 'complete' and stale_at is null;
    end;

    create trigger if not exists working_memory_after_update_stale_briefing
    after update on working_memory
    begin
      update project_briefings
      set stale_at = coalesce(stale_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      where project_id = new.project_id and status = 'complete' and stale_at is null;
    end;

    create trigger if not exists working_memory_after_delete_stale_briefing
    after delete on working_memory
    begin
      update project_briefings
      set stale_at = coalesce(stale_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      where project_id = old.project_id and status = 'complete' and stale_at is null;
    end;
  `);

  if (requiresV6Setup) db.exec(`
    create table if not exists history_import_runs (
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

    create index if not exists idx_history_import_runs_project_started
      on history_import_runs(project_id, started_at desc);

    create table if not exists history_import_items (
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

    create index if not exists idx_history_import_items_run_outcome
      on history_import_items(run_id, outcome, created_at);

    create index if not exists idx_history_import_items_thread
      on history_import_items(thread_id);
  `);

  if (requiresV7Setup) db.exec(`
    alter table projects add column repository_key text;
    create unique index idx_projects_repository_key on projects(repository_key) where repository_key is not null;
    create table project_roots (
      root_path text primary key,
      project_id text not null references projects(id) on delete cascade
    );
    insert into project_roots (root_path, project_id) select root_path, id from projects;
    create table task_working_memory (
      id text primary key,
      project_id text not null references projects(id) on delete cascade,
      task_id text not null check(length(trim(task_id)) between 1 and 500),
      kind text not null,
      content text not null,
      updated_at text not null,
      unique(project_id, task_id, kind)
    );
  `);

  if (requiresV8Setup) db.exec(`
    create table recall_events (
      id text primary key,
      project_id text not null references projects(id) on delete cascade,
      task_id text,
      receipt text not null check(json_valid(receipt)),
      created_at text not null
    );
    create index idx_recall_events_project_task on recall_events(project_id, task_id, created_at desc);
  `);

  if (requiresV9Setup) {
    const columns = db.prepare("pragma table_info(distill_jobs)").all() as Array<{name: string}>;
    if (!columns.some(column => column.name === "next_attempt_at")) db.exec("alter table distill_jobs add column next_attempt_at text");
    if (!columns.some(column => column.name === "max_attempts")) db.exec("alter table distill_jobs add column max_attempts integer not null default 3");
  }

  if (requiresV10Setup) db.exec(`
    create table if not exists curation_events (
      id text primary key,
      project_id text not null references projects(id) on delete cascade,
      memory_id text references memories(id) on delete cascade,
      candidate_id text references memory_candidates(id) on delete cascade,
      receipt text not null check(json_valid(receipt)),
      created_at text not null
    );
    create index if not exists idx_curation_events_project on curation_events(project_id, created_at desc);
  `);

  if (requiresV11Setup) db.exec(`
    create table if not exists research_cases (
      id text primary key,
      project_id text not null,
      title text not null check(length(trim(title)) between 1 and 500),
      question text not null check(length(trim(question)) between 1 and 2000),
      as_of_date text not null,
      status text not null check(status in ('draft', 'in_review', 'completed', 'archived')),
      created_at text not null,
      updated_at text not null,
      unique(project_id, id),
      foreign key(project_id) references projects(id) on delete cascade
    );
    create index if not exists idx_research_cases_project_updated
      on research_cases(project_id, updated_at desc);

    create table if not exists research_evidence (
      id text primary key,
      project_id text not null,
      case_id text not null,
      source_type text not null check(source_type in (
        'regulatory_filing', 'company_material', 'market_data',
        'research_paper', 'secondary_analysis', 'other'
      )),
      source_uri text not null check(length(trim(source_uri)) between 1 and 4000),
      source_title text not null check(length(trim(source_title)) between 1 and 1000),
      locator text not null check(length(trim(locator)) between 1 and 1000),
      excerpt text not null check(length(trim(excerpt)) between 1 and 8000),
      published_at text,
      accessed_at text not null,
      valid_through text,
      content_hash text not null,
      state text not null check(state in ('current', 'stale', 'archived')),
      created_at text not null,
      updated_at text not null,
      unique(project_id, case_id, id),
      foreign key(project_id, case_id) references research_cases(project_id, id) on delete cascade
    );
    create index if not exists idx_research_evidence_case
      on research_evidence(project_id, case_id, created_at);

    create table if not exists research_claims (
      id text primary key,
      project_id text not null,
      case_id text not null,
      statement text not null check(length(trim(statement)) between 1 and 4000),
      evidence_status text not null check(evidence_status in (
        'observed', 'supported', 'contested', 'unsupported', 'rejected'
      )),
      review_status text not null check(review_status in (
        'pending', 'approved', 'rejected', 'changes_requested'
      )),
      confidence real not null check(confidence >= 0 and confidence <= 1),
      thesis_impact text not null check(thesis_impact in (
        'none', 'watch', 'strengthen', 'weaken', 'invalidate'
      )),
      invalidation_conditions text not null check(length(trim(invalidation_conditions)) between 1 and 4000),
      status text not null check(status in ('active', 'superseded')),
      supersedes_claim_id text,
      created_at text not null,
      updated_at text not null,
      unique(project_id, case_id, id),
      foreign key(project_id, case_id) references research_cases(project_id, id) on delete cascade,
      foreign key(project_id, case_id, supersedes_claim_id)
        references research_claims(project_id, case_id, id) on delete restrict
    );
    create index if not exists idx_research_claims_case
      on research_claims(project_id, case_id, status, created_at);
    create unique index if not exists idx_research_claims_single_successor
      on research_claims(supersedes_claim_id)
      where supersedes_claim_id is not null;

    create table if not exists research_claim_evidence (
      project_id text not null,
      case_id text not null,
      claim_id text not null,
      evidence_id text not null,
      relation text not null check(relation in ('supports', 'contradicts', 'contextual')),
      rationale text not null check(length(trim(rationale)) between 1 and 2000),
      primary key(claim_id, evidence_id, relation),
      foreign key(project_id, case_id, claim_id)
        references research_claims(project_id, case_id, id) on delete cascade,
      foreign key(project_id, case_id, evidence_id)
        references research_evidence(project_id, case_id, id) on delete cascade
    );
    create index if not exists idx_research_claim_evidence_case
      on research_claim_evidence(project_id, case_id, claim_id);

    create table if not exists research_events (
      id text primary key,
      project_id text not null,
      case_id text not null,
      claim_id text,
      evidence_id text,
      event_type text not null check(event_type in (
        'packet_submitted', 'claim_revised', 'evidence_marked_stale', 'claim_reviewed'
      )),
      receipt text not null check(json_valid(receipt) and json_type(receipt) = 'object'),
      created_at text not null,
      foreign key(project_id, case_id) references research_cases(project_id, id) on delete cascade,
      foreign key(project_id, case_id, claim_id)
        references research_claims(project_id, case_id, id) on delete cascade,
      foreign key(project_id, case_id, evidence_id)
        references research_evidence(project_id, case_id, id) on delete cascade
    );
    create index if not exists idx_research_events_case_created
      on research_events(project_id, case_id, created_at, id);
  `);

  if (requiresV12Setup) db.exec(`
    create table if not exists lifecycle_sessions (
      id text primary key,
      project_id text not null,
      host text not null check(host in ('codex', 'claude-code', 'cursor', 'cli', 'mcp', 'ui')),
      host_session_id text not null check(length(trim(host_session_id)) between 1 and 500),
      status text not null check(status in ('open', 'closed')),
      opened_at text not null,
      last_seen_at text not null,
      closed_at text,
      unique(project_id, id),
      unique(project_id, host, host_session_id),
      foreign key(project_id) references projects(id) on delete cascade
    );
    create index if not exists idx_lifecycle_sessions_project_seen
      on lifecycle_sessions(project_id, last_seen_at desc);

    create table if not exists lifecycle_turns (
      id text primary key,
      project_id text not null,
      session_id text not null,
      host_turn_id text not null check(length(trim(host_turn_id)) between 1 and 500),
      task_id text,
      query text not null check(length(trim(query)) between 1 and 50000),
      response text,
      outcome_status text check(outcome_status is null or outcome_status in ('succeeded', 'failed', 'cancelled')),
      status text not null check(status in ('started', 'completed')),
      recall_event_id text references recall_events(id) on delete set null,
      before_input_hash text,
      before_result text check(before_result is null or json_valid(before_result)),
      after_input_hash text,
      after_result text check(after_result is null or json_valid(after_result)),
      started_at text not null,
      completed_at text,
      unique(project_id, id),
      unique(project_id, session_id, host_turn_id),
      foreign key(project_id, session_id) references lifecycle_sessions(project_id, id) on delete cascade
    );
    create index if not exists idx_lifecycle_turns_session_started
      on lifecycle_turns(project_id, session_id, started_at);

    create table if not exists capture_records (
      id text primary key,
      project_id text not null,
      turn_id text not null,
      thread_id text,
      content_hash text not null,
      outcome text not null check(outcome in ('imported', 'updated', 'unchanged')),
      captured_at text not null,
      unique(project_id, id),
      unique(project_id, turn_id),
      foreign key(project_id, turn_id) references lifecycle_turns(project_id, id) on delete cascade,
      foreign key(thread_id) references threads(id) on delete set null
    );
    create index if not exists idx_capture_records_project_captured
      on capture_records(project_id, captured_at desc);

    create table if not exists domain_events (
      id text primary key,
      project_id text not null,
      aggregate_type text not null check(length(trim(aggregate_type)) between 1 and 100),
      aggregate_id text not null check(length(trim(aggregate_id)) between 1 and 500),
      event_type text not null check(length(trim(event_type)) between 1 and 100),
      payload text not null check(json_valid(payload) and json_type(payload) = 'object'),
      created_at text not null,
      unique(project_id, id),
      foreign key(project_id) references projects(id) on delete cascade
    );
    create index if not exists idx_domain_events_project_created
      on domain_events(project_id, created_at desc, id desc);

    create table if not exists outbox_messages (
      id text primary key,
      project_id text not null,
      event_id text not null,
      topic text not null check(topic in (
        'capture.distill.requested',
        'research.evidence.verify.requested',
        'projection.refresh.requested'
      )),
      payload text not null check(json_valid(payload) and json_type(payload) = 'object'),
      status text not null check(status in ('pending', 'running', 'completed', 'failed')),
      attempts integer not null default 0 check(attempts >= 0),
      max_attempts integer not null default 3 check(max_attempts >= 1),
      available_at text not null,
      lease_expires_at text,
      last_error text,
      created_at text not null,
      updated_at text not null,
      unique(project_id, id),
      unique(event_id, topic),
      foreign key(project_id, event_id) references domain_events(project_id, id) on delete cascade,
      foreign key(project_id) references projects(id) on delete cascade
    );
    create index if not exists idx_outbox_messages_due
      on outbox_messages(status, available_at, created_at);
    create index if not exists idx_outbox_messages_project_status
      on outbox_messages(project_id, status, created_at desc);
  `);

  if (requiresV13Setup) {
    db.exec(`
      create table if not exists source_snapshots (
        id text primary key,
        project_id text not null,
        canonical_uri text not null check(length(trim(canonical_uri)) between 1 and 4000),
        source_title text not null check(length(trim(source_title)) between 1 and 1000),
        published_at text,
        accessed_at text not null,
        media_type text not null check(length(trim(media_type)) between 1 and 200),
        content text not null check(length(content) between 1 and 5000000),
        content_hash text not null check(length(content_hash) = 64),
        state text not null check(state in ('current', 'stale', 'archived')),
        created_at text not null,
        updated_at text not null,
        unique(project_id, id),
        unique(project_id, canonical_uri, content_hash),
        foreign key(project_id) references projects(id) on delete cascade
      );
      create index if not exists idx_source_snapshots_project_uri
        on source_snapshots(project_id, canonical_uri, created_at desc);
    `);

    const evidenceColumns = db.prepare("pragma table_info(research_evidence)").all() as Array<{name: string}>;
    if (!evidenceColumns.some((column) => column.name === "snapshot_id")) {
      db.exec("alter table research_evidence add column snapshot_id text");
    }
    const outboxColumns = db.prepare("pragma table_info(outbox_messages)").all() as Array<{name: string}>;
    if (!outboxColumns.some((column) => column.name === "lease_token")) {
      db.exec("alter table outbox_messages add column lease_token text");
    }
    db.exec(`
      create index if not exists idx_research_evidence_snapshot
        on research_evidence(project_id, snapshot_id);

      create table if not exists evidence_verifications (
        id text primary key,
        project_id text not null,
        case_id text not null,
        evidence_id text not null,
        snapshot_id text not null,
        status text not null check(status in ('pending', 'verified', 'failed', 'stale')),
        checks text not null check(json_valid(checks) and json_type(checks) = 'object'),
        receipt text not null check(json_valid(receipt) and json_type(receipt) = 'object'),
        is_current integer not null default 1 check(is_current in (0, 1)),
        supersedes_verification_id text,
        verified_at text,
        created_at text not null,
        updated_at text not null,
        unique(project_id, case_id, id),
        foreign key(project_id, case_id) references research_cases(project_id, id) on delete cascade,
        foreign key(project_id, case_id, evidence_id)
          references research_evidence(project_id, case_id, id) on delete cascade,
        foreign key(project_id, snapshot_id)
          references source_snapshots(project_id, id) on delete restrict,
        foreign key(supersedes_verification_id) references evidence_verifications(id) on delete set null
      );
      create unique index if not exists idx_evidence_verifications_current
        on evidence_verifications(project_id, evidence_id) where is_current = 1;
      create index if not exists idx_evidence_verifications_case
        on evidence_verifications(project_id, case_id, created_at);

      create table if not exists outbox_handler_receipts (
        message_id text primary key,
        project_id text not null,
        topic text not null,
        result text not null check(json_valid(result) and json_type(result) = 'object'),
        completed_at text not null,
        foreign key(project_id, message_id) references outbox_messages(project_id, id) on delete cascade
      );
      create index if not exists idx_outbox_handler_receipts_project
        on outbox_handler_receipts(project_id, completed_at desc);

      update research_claims
      set review_status = 'changes_requested',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      where review_status = 'approved';
      update research_cases
      set status = 'in_review',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      where id in (
        select distinct case_id from research_claims where review_status = 'changes_requested'
      );
    `);
  }

  const foreignKeyViolation = db.prepare("pragma foreign_key_check").get();
  if (foreignKeyViolation) throw new Error("Mira schema migration produced a foreign key violation");

  if (existingVersion !== CURRENT_SCHEMA_VERSION) {
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
