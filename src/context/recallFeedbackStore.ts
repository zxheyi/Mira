import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertNoSensitiveInformation } from "../distill/candidatePolicy.js";
import type { ConfirmationPolicy } from "../memory/curationService.js";
import type { RecallReceipt } from "./recallAuditStore.js";

export const RECALL_FEEDBACK_OUTCOMES = ["useful", "partial", "missed", "incorrect"] as const;
export type RecallFeedbackOutcome = (typeof RECALL_FEEDBACK_OUTCOMES)[number];

export type RecallFeedback = {
  id: string;
  projectId: string;
  recallId: string;
  outcome: RecallFeedbackOutcome;
  relevantMemoryIds: string[];
  missingMemoryIds: string[];
  irrelevantMemoryIds: string[];
  correctedMemoryIds: string[];
  reason: string;
  actor: string;
  authorityReason: string;
  createdAt: string;
};

export type RecordRecallFeedbackInput = {
  recallId: string;
  outcome: RecallFeedbackOutcome;
  relevantMemoryIds?: string[];
  missingMemoryIds?: string[];
  irrelevantMemoryIds?: string[];
  correctedMemoryIds?: string[];
  reason: string;
};

export type RecallQualityReport = {
  projectId: string;
  recallCount: number;
  labeledRecallCount: number;
  feedbackCoverage: number;
  outcomes: Record<RecallFeedbackOutcome, number>;
  retrievalMissRecordCount: number;
  retrievalMissMemoryIds: string[];
  rankingMissMemoryIds: string[];
  budgetMissMemoryIds: string[];
  unexplainedMissingMemoryIds: string[];
  irrelevantMemoryIds: string[];
  correctedMemoryIds: string[];
  confirmedCorrectionMemoryIds: string[];
  recommendation: {
    status: "insufficient_data" | "keep_fts" | "evaluate_hybrid";
    minimumLabeledRecalls: 20;
    minimumRetrievalMissRecords: 5;
  };
};

declare const authorityBrand: unique symbol;
export type RecallFeedbackAuthority = { readonly [authorityBrand]: true };
const authorities = new WeakMap<
  RecallFeedbackAuthority,
  ConfirmationPolicy & {db: Database.Database; projectId: string}
>();

const memoryId = z.string().trim().min(1).max(500);
const inputSchema = z.object({
  recallId: z.string().trim().min(1).max(500),
  outcome: z.enum(RECALL_FEEDBACK_OUTCOMES),
  relevantMemoryIds: z.array(memoryId).max(100).default([]),
  missingMemoryIds: z.array(memoryId).max(100).default([]),
  irrelevantMemoryIds: z.array(memoryId).max(100).default([]),
  correctedMemoryIds: z.array(memoryId).max(100).default([]),
  reason: z.string().trim().min(1).max(2000)
}).strict();

type FeedbackRow = {
  id:string;project_id:string;recall_event_id:string;outcome:RecallFeedbackOutcome;
  relevant_memory_ids:string;missing_memory_ids:string;irrelevant_memory_ids:string;
  corrected_memory_ids:string;reason:string;actor:string;authority_reason:string;created_at:string;
};

function fromRow(row: FeedbackRow): RecallFeedback {
  return {
    id:row.id,projectId:row.project_id,recallId:row.recall_event_id,outcome:row.outcome,
    relevantMemoryIds:JSON.parse(row.relevant_memory_ids) as string[],
    missingMemoryIds:JSON.parse(row.missing_memory_ids) as string[],
    irrelevantMemoryIds:JSON.parse(row.irrelevant_memory_ids) as string[],
    correctedMemoryIds:JSON.parse(row.corrected_memory_ids) as string[],
    reason:row.reason,actor:row.actor,authorityReason:row.authority_reason,createdAt:row.created_at
  };
}

export function authorizeRecallFeedback(
  db: Database.Database,
  projectId: string,
  policy: ConfirmationPolicy
): RecallFeedbackAuthority {
  const parsed = z.object({
    actor:z.string().trim().min(1).max(200),
    reason:z.string().trim().min(1).max(1000)
  }).strict().parse(policy);
  assertNoSensitiveInformation(`${parsed.actor}\n${parsed.reason}`, "Recall feedback authority");
  const authority = Object.freeze({}) as RecallFeedbackAuthority;
  authorities.set(authority, {db, projectId, ...parsed});
  return authority;
}

function requireAuthority(
  db: Database.Database,
  projectId: string,
  authority?: RecallFeedbackAuthority
): ConfirmationPolicy {
  const policy = authority && authorities.get(authority);
  if (!policy || policy.db !== db || policy.projectId !== projectId) {
    throw new Error("Recall feedback requires host-granted project authority");
  }
  return policy;
}

function recallReceipt(db: Database.Database, projectId: string, recallId: string): RecallReceipt {
  const row = db.prepare("select receipt from recall_events where project_id = ? and id = ?")
    .get(projectId, recallId) as {receipt:string} | undefined;
  if (!row) throw new Error(`Recall Receipt not found: ${recallId}`);
  return JSON.parse(row.receipt) as RecallReceipt;
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} Memory IDs must be unique`);
}

function assertDisjoint(groups: Array<{label:string;values:string[]}>): void {
  const owner = new Map<string, string>();
  for (const group of groups) {
    for (const id of group.values) {
      const previous = owner.get(id);
      if (previous) throw new Error(`Memory ${id} cannot be both ${previous} and ${group.label}`);
      owner.set(id, group.label);
    }
  }
}

function assertProjectMemories(db: Database.Database, projectId: string, ids: string[]): void {
  for (const id of new Set(ids)) {
    const found = db.prepare("select 1 from memories where project_id = ? and id = ?").get(projectId, id);
    if (!found) throw new Error(`Feedback Memory not found in project: ${id}`);
  }
}

export function recordRecallFeedback(
  db: Database.Database,
  projectId: string,
  input: RecordRecallFeedbackInput,
  authority?: RecallFeedbackAuthority
): RecallFeedback {
  const policy = requireAuthority(db, projectId, authority);
  const parsed = inputSchema.parse(input);
  assertNoSensitiveInformation(parsed.reason, "Recall feedback reason");
  const groups = [
    {label:"relevant",values:parsed.relevantMemoryIds},
    {label:"missing",values:parsed.missingMemoryIds},
    {label:"irrelevant",values:parsed.irrelevantMemoryIds},
    {label:"corrected",values:parsed.correctedMemoryIds}
  ];
  for (const group of groups) assertUnique(group.values, group.label);
  assertDisjoint(groups);
  const receipt = recallReceipt(db, projectId, parsed.recallId);
  const injected = new Set(receipt.injectedMemoryIds);
  for (const id of [...parsed.relevantMemoryIds, ...parsed.irrelevantMemoryIds, ...parsed.correctedMemoryIds]) {
    if (!injected.has(id)) throw new Error(`Feedback Memory was not injected by Recall Receipt: ${id}`);
  }
  for (const id of parsed.missingMemoryIds) {
    if (injected.has(id)) throw new Error(`Missing Memory was injected by Recall Receipt: ${id}`);
  }
  assertProjectMemories(db, projectId, groups.flatMap((group) => group.values));
  if (db.prepare("select 1 from recall_feedback where project_id = ? and recall_event_id = ?")
    .get(projectId, parsed.recallId)) {
    throw new Error(`Recall Feedback already recorded: ${parsed.recallId}`);
  }
  const feedback: RecallFeedback = {
    id:`recall_feedback_${randomUUID()}`,projectId,recallId:parsed.recallId,outcome:parsed.outcome,
    relevantMemoryIds:parsed.relevantMemoryIds,missingMemoryIds:parsed.missingMemoryIds,
    irrelevantMemoryIds:parsed.irrelevantMemoryIds,correctedMemoryIds:parsed.correctedMemoryIds,
    reason:parsed.reason,actor:policy.actor,authorityReason:policy.reason,createdAt:new Date().toISOString()
  };
  db.prepare(`insert into recall_feedback (
    id, project_id, recall_event_id, outcome, relevant_memory_ids, missing_memory_ids,
    irrelevant_memory_ids, corrected_memory_ids, reason, actor, authority_reason, created_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    feedback.id,feedback.projectId,feedback.recallId,feedback.outcome,
    JSON.stringify(feedback.relevantMemoryIds),JSON.stringify(feedback.missingMemoryIds),
    JSON.stringify(feedback.irrelevantMemoryIds),JSON.stringify(feedback.correctedMemoryIds),
    feedback.reason,feedback.actor,feedback.authorityReason,feedback.createdAt
  );
  return feedback;
}

export function listRecallFeedback(
  db: Database.Database,
  projectId: string,
  options: {limit?: number} = {}
): RecallFeedback[] {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("Recall Feedback limit must be between 1 and 1000");
  }
  return (db.prepare(`select * from recall_feedback where project_id = ?
    order by created_at desc, rowid desc limit ?`).all(projectId, limit) as FeedbackRow[]).map(fromRow);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function getRecallQualityReport(db: Database.Database, projectId: string): RecallQualityReport {
  const recallCount = Number(db.prepare("select count(*) from recall_events where project_id = ?")
    .pluck().get(projectId));
  const feedback = (db.prepare(`select * from recall_feedback where project_id = ?
    order by created_at desc, rowid desc`).all(projectId) as FeedbackRow[]).map(fromRow);
  const outcomes = {useful:0,partial:0,missed:0,incorrect:0};
  const retrieval: string[] = [];
  const ranking: string[] = [];
  const budget: string[] = [];
  const unexplained: string[] = [];
  let retrievalMissRecordCount = 0;
  for (const item of feedback) {
    outcomes[item.outcome] += 1;
    const receipt = recallReceipt(db, projectId, item.recallId);
    const candidates = new Set(receipt.candidateMemoryIds);
    const dropped = new Map(receipt.dropped.map((entry) => [entry.memoryId, entry.reason]));
    let recordHasRetrievalMiss = false;
    for (const id of item.missingMemoryIds) {
      if (!candidates.has(id)) {
        retrieval.push(id);
        recordHasRetrievalMiss = true;
      } else if (dropped.get(id) === "memory_limit") ranking.push(id);
      else if (dropped.get(id) === "budget") budget.push(id);
      else unexplained.push(id);
    }
    if (recordHasRetrievalMiss) retrievalMissRecordCount += 1;
  }
  const correctedByLifecycle = db.prepare(`select memory_id from memory_events
    where project_id = ? and event_type = 'superseded'
      and json_type(metadata, '$.recallId') = 'text' order by created_at asc, rowid asc`)
    .all(projectId).map((row) => (row as {memory_id:string}).memory_id);
  const labeledRecallCount = feedback.length;
  const status = labeledRecallCount < 20
    ? "insufficient_data"
    : retrievalMissRecordCount >= 5 ? "evaluate_hybrid" : "keep_fts";
  return {
    projectId,recallCount,labeledRecallCount,
    feedbackCoverage:recallCount === 0 ? 0 : labeledRecallCount / recallCount,
    outcomes,retrievalMissRecordCount,
    retrievalMissMemoryIds:unique(retrieval),rankingMissMemoryIds:unique(ranking),
    budgetMissMemoryIds:unique(budget),unexplainedMissingMemoryIds:unique(unexplained),
    irrelevantMemoryIds:unique(feedback.flatMap((item) => item.irrelevantMemoryIds)),
    correctedMemoryIds:unique(feedback.flatMap((item) => item.correctedMemoryIds)),
    confirmedCorrectionMemoryIds:unique(correctedByLifecycle),
    recommendation:{status,minimumLabeledRecalls:20,minimumRetrievalMissRecords:5}
  };
}
