import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";

export const DISTILL_JOB_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type DistillJobStatus = (typeof DISTILL_JOB_STATUSES)[number];
export type DistillJobTrigger = "hook" | "cli";

export type DistillJob = {
  id: string;
  projectId: string;
  threadId: string;
  trigger: DistillJobTrigger;
  channel: "provider";
  inputHash: string;
  status: DistillJobStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

type JobRow = {
  id: string; project_id: string; thread_id: string; trigger: DistillJobTrigger;
  channel: "provider"; input_hash: string; status: DistillJobStatus; attempts: number;
  last_error: string | null; created_at: string; updated_at: string;
};

function toJob(row: JobRow): DistillJob {
  return {
    id: row.id, projectId: row.project_id, threadId: row.thread_id, trigger: row.trigger,
    channel: row.channel, inputHash: row.input_hash, status: row.status, attempts: row.attempts,
    lastError: row.last_error ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function selectJob(db: Database.Database, id: string): DistillJob | undefined {
  const row = db.prepare("select * from distill_jobs where id = ?").get(id);
  return row ? toJob(row as JobRow) : undefined;
}

export function enqueueDistillJob(
  db: Database.Database,
  projectId: string,
  threadId: string,
  trigger: DistillJobTrigger
): DistillJob {
  const thread = db.prepare("select raw_text from threads where project_id = ? and id = ?")
    .get(projectId, threadId) as { raw_text: string } | undefined;
  if (!thread) throw new Error(`Thread not found: ${threadId}`);
  const inputHash = createHash("sha256").update(thread.raw_text).digest("hex");
  const existing = db.prepare(
    "select * from distill_jobs where project_id = ? and thread_id = ? and channel = 'provider' and input_hash = ?"
  ).get(projectId, threadId, inputHash);
  if (existing) return toJob(existing as JobRow);

  const now = new Date().toISOString();
  const job: DistillJob = {
    id: `distill_job_${randomUUID()}`, projectId, threadId, trigger, channel: "provider",
    inputHash, status: "pending", attempts: 0, createdAt: now, updatedAt: now
  };
  db.prepare(
    `insert or ignore into distill_jobs (
      id, project_id, thread_id, trigger, channel, input_hash, status, attempts, last_error, created_at, updated_at
    ) values (@id, @projectId, @threadId, @trigger, @channel, @inputHash, @status, @attempts, null, @createdAt, @updatedAt)`
  ).run(job);
  const ensured = db.prepare(
    "select * from distill_jobs where project_id = ? and thread_id = ? and channel = 'provider' and input_hash = ?"
  ).get(projectId, threadId, inputHash) as JobRow | undefined;
  return ensured ? toJob(ensured) : job;
}

export function listDistillJobs(
  db: Database.Database,
  projectId: string,
  status?: DistillJobStatus,
  limit = 100
): DistillJob[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Distill job limit must be between 1 and 100");
  const rows = status
    ? db.prepare("select * from distill_jobs where project_id = ? and status = ? order by created_at desc, rowid desc limit ?")
      .all(projectId, status, limit)
    : db.prepare("select * from distill_jobs where project_id = ? order by created_at desc, rowid desc limit ?")
      .all(projectId, limit);
  return rows.map((row) => toJob(row as JobRow));
}

export function claimNextDistillJob(db: Database.Database, projectId?: string): DistillJob | undefined {
  return db.transaction(() => {
    const row = projectId
      ? db.prepare("select * from distill_jobs where status = 'pending' and project_id = ? order by created_at asc, rowid asc limit 1")
        .get(projectId)
      : db.prepare("select * from distill_jobs where status = 'pending' order by created_at asc, rowid asc limit 1").get();
    if (!row) return undefined;
    const job = toJob(row as JobRow);
    const now = new Date().toISOString();
    const updated = db.prepare(
      "update distill_jobs set status = 'running', attempts = attempts + 1, last_error = null, updated_at = ? where id = ? and status = 'pending'"
    ).run(now, job.id);
    return updated.changes === 1 ? selectJob(db, job.id) : undefined;
  })();
}

export function completeDistillJob(db: Database.Database, id: string): void {
  const result = db.prepare(
    "update distill_jobs set status = 'completed', last_error = null, updated_at = ? where id = ? and status = 'running'"
  ).run(new Date().toISOString(), id);
  if (result.changes !== 1) throw new Error(`Running distill job not found: ${id}`);
}

export function sanitizeDistillError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_\-]{12,}\b/g, "[REDACTED]")
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_\-]{12,}\b/g, "[REDACTED]")
    .slice(0, 500);
}

export function failDistillJob(db: Database.Database, id: string, error: unknown): void {
  const result = db.prepare(
    "update distill_jobs set status = 'failed', last_error = ?, updated_at = ? where id = ? and status = 'running'"
  ).run(sanitizeDistillError(error), new Date().toISOString(), id);
  if (result.changes !== 1) throw new Error(`Running distill job not found: ${id}`);
}

export function retryDistillJob(db: Database.Database, projectId: string, id: string): DistillJob {
  const existing = selectJob(db, id);
  if (!existing || existing.projectId !== projectId) throw new Error(`Retryable distill job not found: ${id}`);
  if (existing.status === "running") {
    if (Date.parse(existing.updatedAt) > Date.now() - 5 * 60_000) {
      throw new Error(`Distill job is still running and its lease is active: ${id}`);
    }
  } else if (existing.status !== "failed") {
    throw new Error(`Retryable distill job not found: ${id}`);
  }
  const result = db.prepare(
    `update distill_jobs set status = 'pending', last_error = null, updated_at = ?
     where project_id = ? and id = ? and status in ('failed', 'running')`
  ).run(new Date().toISOString(), projectId, id);
  if (result.changes !== 1) throw new Error(`Retryable distill job not found: ${id}`);
  const job = selectJob(db, id);
  if (!job) throw new Error(`Distill job not found after retry: ${id}`);
  return job;
}
