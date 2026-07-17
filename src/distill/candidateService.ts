import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { addMemory, type Memory, type MemoryKind } from "../memory/memoryStore.js";
import {
  candidateReviewReasons,
  hashCandidateContent,
  normalizeCandidateInput,
  normalizeCandidateTitle,
  type NormalizedCandidateInput
} from "./candidatePolicy.js";
import type {
  CandidateExtractionMethod,
  CandidateReviewReason,
  CandidateRiskLevel,
  CandidateStatus,
  MemoryCandidate,
  MemoryCandidateResult,
  SubmitMemoryCandidatesInput
} from "./candidateTypes.js";

type CandidateRow = {
  id: string;
  project_id: string;
  thread_id: string;
  job_id: string | null;
  thread_input_hash: string;
  title: string;
  kind: MemoryKind;
  content: string;
  confidence: number;
  importance: number;
  source_agent: string;
  source_model: string | null;
  extraction_method: CandidateExtractionMethod;
  evidence: string;
  content_hash: string;
  risk_level: CandidateRiskLevel;
  status: CandidateStatus;
  review_reason: string | null;
  reviewed_at: string | null;
  accepted_memory_id: string | null;
  created_at: string;
};

function toCandidate(row: CandidateRow): MemoryCandidate {
  return {
    id: row.id,
    projectId: row.project_id,
    threadId: row.thread_id,
    jobId: row.job_id ?? undefined,
    threadInputHash: row.thread_input_hash,
    title: row.title,
    kind: row.kind,
    content: row.content,
    confidence: row.confidence,
    importance: row.importance,
    sourceAgent: row.source_agent,
    sourceModel: row.source_model ?? undefined,
    extractionMethod: row.extraction_method,
    evidence: row.evidence,
    contentHash: row.content_hash,
    riskLevel: row.risk_level,
    status: row.status,
    reviewReason: row.review_reason ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    acceptedMemoryId: row.accepted_memory_id ?? undefined,
    createdAt: row.created_at
  };
}

function selectCandidate(db: Database.Database, projectId: string, id: string): MemoryCandidate | undefined {
  const row = db.prepare("select * from memory_candidates where project_id = ? and id = ?").get(projectId, id);
  return row ? toCandidate(row as CandidateRow) : undefined;
}

function findMemory(db: Database.Database, id: string | undefined): Memory | undefined {
  if (!id) return undefined;
  const row = db.prepare(
    `select id, project_id as projectId, thread_id as threadId, title, kind, content, source,
            confidence, content_hash as contentHash, importance, created_at as createdAt
     from memories where id = ?`
  ).get(id) as (Memory & { threadId: string | null }) | undefined;
  return row ? { ...row, threadId: row.threadId ?? undefined } : undefined;
}

function findExistingMemoryForCandidate(
  db: Database.Database,
  projectId: string,
  kind: MemoryKind,
  contentHash: string
): Memory | undefined {
  const row = db.prepare(
    "select id from memories where project_id = ? and kind = ? and content_hash = ? order by created_at asc, rowid asc limit 1"
  ).get(projectId, kind, contentHash) as { id: string } | undefined;
  return findMemory(db, row?.id);
}

function findDuplicate(
  db: Database.Database,
  projectId: string,
  threadId: string,
  kind: MemoryKind,
  contentHash: string,
  extractionMethod: CandidateExtractionMethod,
  threadInputHash: string
): MemoryCandidate | undefined {
  const row = db.prepare(
    `select * from memory_candidates
     where project_id = ? and thread_id = ? and kind = ? and content_hash = ?
       and extraction_method = ? and thread_input_hash = ?`
  ).get(projectId, threadId, kind, contentHash, extractionMethod, threadInputHash);
  return row ? toCandidate(row as CandidateRow) : undefined;
}

function hasMemoryConflict(
  db: Database.Database,
  projectId: string,
  candidate: NormalizedCandidateInput
): boolean {
  const rows = db.prepare(
    `select title, content_hash from memories where project_id = ? and kind = ? and content_hash <> ?`
  ).all(projectId, candidate.kind, candidate.contentHash) as Array<{ title: string; content_hash: string }>;
  const title = normalizeCandidateTitle(candidate.title);
  return rows.some((row) => normalizeCandidateTitle(row.title) === title);
}

function resultForExisting(db: Database.Database, candidate: MemoryCandidate): MemoryCandidateResult {
  return {
    candidate,
    outcome: "duplicate",
    reasons: ["duplicate"],
    memory: findMemory(db, candidate.acceptedMemoryId)
  };
}

function acceptCandidate(db: Database.Database, candidate: MemoryCandidate, reason?: string): MemoryCandidateResult {
  const memory = addMemory(db, {
    projectId: candidate.projectId,
    threadId: candidate.threadId,
    title: candidate.title,
    kind: candidate.kind,
    content: candidate.content,
    source: `candidate:${candidate.id}`,
    confidence: candidate.confidence,
    importance: Math.max(1, Math.round(candidate.importance * 10))
  });
  const reviewedAt = new Date().toISOString();
  db.prepare(
    `update memory_candidates
     set status = 'accepted', review_reason = ?, reviewed_at = ?, accepted_memory_id = ?
     where id = ?`
  ).run(reason ?? null, reviewedAt, memory.id, candidate.id);
  const accepted = selectCandidate(db, candidate.projectId, candidate.id);
  if (!accepted) throw new Error(`Memory candidate disappeared during acceptance: ${candidate.id}`);
  return { candidate: accepted, outcome: "accepted", reasons: [], memory };
}

export function submitMemoryCandidates(
  db: Database.Database,
  input: SubmitMemoryCandidatesInput
): MemoryCandidateResult[] {
  if (input.candidates.length === 0 || input.candidates.length > 50) {
    throw new Error("Candidate submission must contain between 1 and 50 candidates");
  }
  const sourceAgent = input.sourceAgent.trim();
  if (!sourceAgent || sourceAgent.length > 100) throw new Error("sourceAgent must contain 1 to 100 characters");
  const sourceModel = input.sourceModel?.trim();
  if (sourceModel && sourceModel.length > 200) throw new Error("sourceModel must be at most 200 characters");

  return db.transaction(() => {
    const thread = db.prepare("select raw_text from threads where id = ? and project_id = ?")
      .get(input.threadId, input.projectId) as { raw_text: string } | undefined;
    if (!thread) throw new Error(`Thread not found: ${input.threadId}`);
    const threadInputHash = hashCandidateContent(thread.raw_text);
    if (input.expectedThreadInputHash && input.expectedThreadInputHash !== threadInputHash) {
      throw new Error(`Candidate source Thread has changed during extraction: ${input.threadId}`);
    }
    // Validate the complete batch before the first write so invalid or sensitive input cannot be partially stored.
    const normalized = input.candidates.map((candidate) => normalizeCandidateInput(candidate, thread.raw_text));
    return normalized.map((candidate) => {
    const duplicate = findDuplicate(
      db,
      input.projectId,
      input.threadId,
      candidate.kind,
      candidate.contentHash,
      input.extractionMethod,
      threadInputHash
    );
    if (duplicate) return resultForExisting(db, duplicate);

    const existingMemory = findExistingMemoryForCandidate(
      db, input.projectId, candidate.kind, candidate.contentHash
    );
    const reasons: CandidateReviewReason[] = existingMemory
      ? ["duplicate"]
      : candidateReviewReasons(candidate, hasMemoryConflict(db, input.projectId, candidate));
    const createdAt = new Date().toISOString();
    const inserted: MemoryCandidate = {
      id: `candidate_${randomUUID()}`,
      projectId: input.projectId,
      threadId: input.threadId,
      jobId: input.jobId,
      threadInputHash,
      sourceAgent,
      sourceModel: sourceModel || undefined,
      extractionMethod: input.extractionMethod,
      ...candidate,
      status: "pending_review",
      reviewReason: reasons.length ? reasons.join(",") : undefined,
      createdAt
    };
    db.prepare(
      `insert into memory_candidates (
        id, project_id, thread_id, job_id, thread_input_hash, title, kind, content, confidence, importance,
        source_agent, source_model, extraction_method, evidence, content_hash, risk_level,
        status, review_reason, reviewed_at, accepted_memory_id, created_at
      ) values (
        @id, @projectId, @threadId, @jobId, @threadInputHash, @title, @kind, @content, @confidence, @importance,
        @sourceAgent, @sourceModel, @extractionMethod, @evidence, @contentHash, @riskLevel,
        @status, @reviewReason, null, null, @createdAt
      )`
    ).run({
      ...inserted,
      jobId: inserted.jobId ?? null,
      sourceModel: inserted.sourceModel ?? null,
      reviewReason: inserted.reviewReason ?? null
    });

    if (existingMemory) {
      const reviewedAt = new Date().toISOString();
      db.prepare(
        `update memory_candidates
         set status = 'accepted', review_reason = 'duplicate', reviewed_at = ?, accepted_memory_id = ?
         where id = ?`
      ).run(reviewedAt, existingMemory.id, inserted.id);
      const linked = selectCandidate(db, input.projectId, inserted.id);
      if (!linked) throw new Error(`Memory candidate disappeared during duplicate linking: ${inserted.id}`);
      return { candidate: linked, outcome: "duplicate" as const, reasons: ["duplicate" as const], memory: existingMemory };
    }
    if (reasons.length === 0) return acceptCandidate(db, inserted);
    return { candidate: inserted, outcome: "pending_review" as const, reasons };
    });
  })();
}

export function listMemoryCandidates(
  db: Database.Database,
  projectId: string,
  status?: CandidateStatus,
  limit = 50
): MemoryCandidate[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Candidate limit must be between 1 and 100");
  const rows = status
    ? db.prepare("select * from memory_candidates where project_id = ? and status = ? order by created_at desc, rowid desc limit ?")
      .all(projectId, status, limit)
    : db.prepare("select * from memory_candidates where project_id = ? order by created_at desc, rowid desc limit ?")
      .all(projectId, limit);
  return rows.map((row) => toCandidate(row as CandidateRow));
}

export function reviewMemoryCandidate(
  db: Database.Database,
  projectId: string,
  candidateId: string,
  decision: "accept" | "reject",
  reason?: string
): MemoryCandidateResult {
  const normalizedReason = reason?.trim();
  if (normalizedReason && normalizedReason.length > 1000) throw new Error("Review reason must be at most 1000 characters");
  return db.transaction((): MemoryCandidateResult => {
    const candidate = selectCandidate(db, projectId, candidateId);
    if (!candidate) throw new Error(`Memory candidate not found: ${candidateId}`);
    if (candidate.status === "accepted") {
      if (decision === "reject") throw new Error(`Memory candidate is already accepted: ${candidateId}`);
      return { candidate, outcome: "accepted", reasons: [], memory: findMemory(db, candidate.acceptedMemoryId) };
    }
    if (candidate.status === "rejected") {
      if (decision === "accept") throw new Error(`Memory candidate is already rejected: ${candidateId}`);
      return { candidate, outcome: "rejected", reasons: [] };
    }
    if (decision === "accept") {
      const thread = db.prepare("select raw_text from threads where project_id = ? and id = ?")
        .get(projectId, candidate.threadId) as { raw_text: string } | undefined;
      if (!thread || hashCandidateContent(thread.raw_text) !== candidate.threadInputHash) {
        throw new Error(`Memory candidate source Thread has changed; resubmit the candidate: ${candidateId}`);
      }
      if (!thread.raw_text.includes(candidate.evidence)) {
        throw new Error(`Memory candidate evidence is no longer present; resubmit the candidate: ${candidateId}`);
      }
      return acceptCandidate(db, candidate, normalizedReason);
    }

    const reviewedAt = new Date().toISOString();
    db.prepare(
      "update memory_candidates set status = 'rejected', review_reason = ?, reviewed_at = ? where id = ?"
    ).run(normalizedReason ?? null, reviewedAt, candidate.id);
    const rejected = selectCandidate(db, projectId, candidate.id);
    if (!rejected) throw new Error(`Memory candidate disappeared during rejection: ${candidate.id}`);
    return { candidate: rejected, outcome: "rejected", reasons: [] };
  })();
}
