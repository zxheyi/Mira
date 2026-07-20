import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  HistoryAgent,
  HistoryDistillStatus,
  HistoryImportCounts,
  HistoryImportErrorStage,
  HistoryImportItem,
  HistoryImportOutcome,
  HistoryImportRun,
  HistoryImportRunStatus
} from "./historyTypes.js";

type RunRow = {
  id: string; project_id: string; status: HistoryImportRunStatus; agents: string; root_aliases: string;
  options: string; scanned_count: number; imported_count: number; updated_count: number;
  unchanged_count: number; skipped_count: number; failed_count: number; started_at: string;
  finished_at: string | null; error: string | null;
};

type ItemRow = {
  id: string; run_id: string; agent: HistoryAgent; session_id: string | null; file_path: string;
  recorded_cwd: string | null; fingerprint: string | null; outcome: HistoryImportOutcome;
  thread_id: string | null; distill_status: HistoryDistillStatus; error_stage: HistoryImportErrorStage | null;
  error_reason: string | null; created_at: string;
};

function toRun(row: RunRow): HistoryImportRun {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    agents: JSON.parse(row.agents) as HistoryAgent[],
    rootAliases: JSON.parse(row.root_aliases) as string[],
    options: JSON.parse(row.options) as { distill: boolean },
    scannedCount: row.scanned_count,
    importedCount: row.imported_count,
    updatedCount: row.updated_count,
    unchangedCount: row.unchanged_count,
    skippedCount: row.skipped_count,
    failedCount: row.failed_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    error: row.error ?? undefined
  };
}

function toItem(row: ItemRow): HistoryImportItem {
  return {
    id: row.id,
    runId: row.run_id,
    agent: row.agent,
    sessionId: row.session_id ?? undefined,
    filePath: row.file_path,
    cwd: row.recorded_cwd ?? undefined,
    fingerprint: row.fingerprint ?? undefined,
    outcome: row.outcome,
    threadId: row.thread_id ?? undefined,
    distillStatus: row.distill_status,
    errorStage: row.error_stage ?? undefined,
    errorReason: row.error_reason ?? undefined,
    createdAt: row.created_at
  };
}

export function sanitizeHistoryImportError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_\-]{12,}\b/g, "[REDACTED]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_\-]{12,}\b/g, "[REDACTED]")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 1_000);
}

export function createHistoryImportRun(
  db: Database.Database,
  input: {
    projectId: string;
    agents: HistoryAgent[];
    rootAliases: string[];
    options: { distill: boolean };
  }
): HistoryImportRun {
  return db.transaction(() => {
    const now = new Date().toISOString();
    db.prepare(
      `update history_import_runs
       set status = 'interrupted', finished_at = ?, error = coalesce(error, 'Interrupted by a newer import run')
       where project_id = ? and status = 'running'`
    ).run(now, input.projectId);

    const id = `history_run_${randomUUID()}`;
    db.prepare(
      `insert into history_import_runs (
        id, project_id, status, agents, root_aliases, options, started_at
      ) values (?, ?, 'running', ?, ?, ?, ?)`
    ).run(
      id,
      input.projectId,
      JSON.stringify(input.agents),
      JSON.stringify(input.rootAliases),
      JSON.stringify(input.options),
      now
    );
    return toRun(db.prepare("select * from history_import_runs where id = ?").get(id) as RunRow);
  })();
}

function selectRun(db: Database.Database, id: string): HistoryImportRun {
  const row = db.prepare("select * from history_import_runs where id = ?").get(id) as RunRow | undefined;
  if (!row) throw new Error(`History import run not found: ${id}`);
  return toRun(row);
}

export function finishHistoryImportRun(
  db: Database.Database,
  id: string,
  counts: HistoryImportCounts,
  options: { hasErrors?: boolean; error?: unknown } = {}
): HistoryImportRun {
  const status = counts.failed > 0 || options.hasErrors ? "completed_with_errors" : "completed";
  const result = db.prepare(
    `update history_import_runs set
      status = ?, scanned_count = ?, imported_count = ?, updated_count = ?, unchanged_count = ?,
      skipped_count = ?, failed_count = ?, finished_at = ?, error = ?
     where id = ? and status = 'running'`
  ).run(
    status,
    counts.scanned,
    counts.imported,
    counts.updated,
    counts.unchanged,
    counts.skipped,
    counts.failed,
    new Date().toISOString(),
    options.error === undefined ? null : sanitizeHistoryImportError(options.error),
    id
  );
  if (result.changes !== 1) throw new Error(`Running history import run not found: ${id}`);
  return selectRun(db, id);
}

export function failHistoryImportRun(
  db: Database.Database,
  id: string,
  error: unknown,
  counts: HistoryImportCounts
): HistoryImportRun {
  const result = db.prepare(
    `update history_import_runs set
      status = 'failed', scanned_count = ?, imported_count = ?, updated_count = ?, unchanged_count = ?,
      skipped_count = ?, failed_count = ?, finished_at = ?, error = ?
     where id = ? and status = 'running'`
  ).run(
    counts.scanned, counts.imported, counts.updated, counts.unchanged, counts.skipped, counts.failed,
    new Date().toISOString(), sanitizeHistoryImportError(error), id
  );
  if (result.changes !== 1) throw new Error(`Running history import run not found: ${id}`);
  return selectRun(db, id);
}

export function recordHistoryImportItem(
  db: Database.Database,
  input: {
    runId: string; agent: HistoryAgent; sessionId?: string; filePath: string; cwd?: string;
    fingerprint?: string; outcome: HistoryImportOutcome; threadId?: string;
    distillStatus: HistoryDistillStatus; errorStage?: HistoryImportErrorStage; errorReason?: unknown;
  }
): HistoryImportItem {
  const id = `history_item_${randomUUID()}`;
  db.prepare(
    `insert into history_import_items (
      id, run_id, agent, session_id, file_path, recorded_cwd, fingerprint, outcome,
      thread_id, distill_status, error_stage, error_reason, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, input.runId, input.agent, input.sessionId ?? null, input.filePath, input.cwd ?? null,
    input.fingerprint ?? null, input.outcome, input.threadId ?? null, input.distillStatus,
    input.errorStage ?? null,
    input.errorReason === undefined ? null : sanitizeHistoryImportError(input.errorReason),
    new Date().toISOString()
  );
  return toItem(db.prepare("select * from history_import_items where id = ?").get(id) as ItemRow);
}

export function listHistoryImportRuns(
  db: Database.Database,
  projectId: string,
  limit = 20
): HistoryImportRun[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("History import run limit must be between 1 and 100");
  }
  return (db.prepare(
    "select * from history_import_runs where project_id = ? order by started_at desc, rowid desc limit ?"
  ).all(projectId, limit) as RunRow[]).map(toRun);
}

export function listHistoryImportFailures(
  db: Database.Database,
  projectId: string,
  options: { runId?: string; limit?: number } = {}
): HistoryImportItem[] {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("History import failure limit must be between 1 and 500");
  }
  const rows = options.runId
    ? db.prepare(
      `select item.* from history_import_items item
       join history_import_runs run on run.id = item.run_id
       where run.project_id = ? and item.run_id = ?
         and (item.outcome = 'failed' or item.distill_status = 'failed')
       order by item.created_at asc, item.rowid asc limit ?`
    ).all(projectId, options.runId, limit)
    : db.prepare(
      `select item.* from history_import_items item
       join history_import_runs run on run.id = item.run_id
       where run.project_id = ? and (item.outcome = 'failed' or item.distill_status = 'failed')
       order by item.created_at desc, item.rowid desc limit ?`
    ).all(projectId, limit);
  return (rows as ItemRow[]).map(toItem);
}

export function findLatestHistoryImportItem(
  db: Database.Database,
  projectId: string,
  agent: HistoryAgent,
  sessionId: string
): HistoryImportItem | undefined {
  const row = db.prepare(
    `select item.* from history_import_items item
     join history_import_runs run on run.id = item.run_id
     where run.project_id = ? and item.agent = ? and item.session_id = ?
       and item.outcome in ('imported', 'updated', 'unchanged')
     order by item.created_at desc, item.rowid desc limit 1`
  ).get(projectId, agent, sessionId) as ItemRow | undefined;
  return row ? toItem(row) : undefined;
}
