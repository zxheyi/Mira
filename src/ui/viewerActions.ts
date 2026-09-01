import type Database from "better-sqlite3";
import { z } from "zod";
import { authorizeCuration, curateMemory } from "../memory/curationService.js";
import {
  authorizeRecallFeedback,
  recordRecallFeedback,
  RECALL_FEEDBACK_OUTCOMES
} from "../context/recallFeedbackStore.js";
import { retryDistillJob } from "../distill/distillJobStore.js";
import {
  authorizeResearch,
  markResearchEvidenceStale,
  markResearchSourceSnapshotStale,
  reviewResearchClaim
} from "../research/researchService.js";
import { verifyEvidence } from "../research/evidenceVerification.js";
import { CONTRADICTION_DISPOSITIONS } from "../research/researchTypes.js";

const reason = z.string().trim().min(1).max(1000).optional();
const recallFeedbackAction = z.object({
  outcome:z.enum(RECALL_FEEDBACK_OUTCOMES),
  relevantMemoryIds:z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  missingMemoryIds:z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  irrelevantMemoryIds:z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  correctedMemoryIds:z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  reason:z.string().trim().min(1).max(2000)
}).strict();
const memoryAction = z.discriminatedUnion("action", [
  z.object({
    action:z.literal("correct"),
    content:z.string().trim().min(1).max(50_000),
    title:z.string().trim().min(1).max(500).optional(),
    recallId:z.string().trim().min(1).max(500).optional(),reason
  }).strict(),
  z.object({action: z.literal("archive"), reason}).strict(),
  z.object({action: z.literal("restore"), reason}).strict()
]);
const reviewAction = z.object({decision: z.enum(["accept", "reject"]), reason,
  supersedesMemoryId: z.string().trim().min(1).max(500).optional()}).strict();
const requiredReason = z.string().trim().min(1).max(2000);
const researchClaimAction = z.object({
  decision: z.enum(["approve", "reject", "request_changes"]),
  reason: requiredReason,
  contradictionDispositions: z.array(z.object({
    evidenceId: z.string().trim().min(1).max(200),
    disposition: z.enum(CONTRADICTION_DISPOSITIONS),
    rationale: requiredReason
  }).strict()).max(100).optional()
}).strict();
const researchEvidenceAction = z.discriminatedUnion("action", [
  z.object({action: z.literal("verify"), caseId: z.string().trim().min(1).max(200)}).strict(),
  z.object({action: z.literal("stale"), reason: requiredReason}).strict()
]);
const researchSnapshotAction = z.object({action:z.literal("stale"),reason:requiredReason}).strict();

export function applyViewerAction(db: Database.Database, projectId: string, resource: string, id: string, body: unknown): unknown {
  if (resource === "recall-feedback") {
    const input = recallFeedbackAction.parse(body);
    return recordRecallFeedback(db, projectId, {recallId:id,...input}, authorizeRecallFeedback(
      db, projectId, {actor:"ui:user",reason:"Explicit local Recall Feedback UI action"}
    ));
  }
  if (resource === "memory") {
    const input = memoryAction.parse(body);
    const authority = authorizeCuration(db, projectId, {actor: "ui:user", reason: "Explicit local management UI action"});
    if (input.action === "correct") return curateMemory(db, {operation: "correct", input: {
      projectId,memoryId:id,content:input.content,title:input.title,actor:"ui:user",
      reason:input.reason,recallId:input.recallId
    }}, authority);
    return curateMemory(db, {operation: input.action, projectId, memoryId: id, actor: "ui:user", reason: input.reason}, authority);
  }
  if (resource === "candidates") {
    const input = reviewAction.parse(body);
    return curateMemory(db, {operation: "review", projectId, candidateId: id, actor: "ui:user", ...input},
      authorizeCuration(db, projectId, {actor: "ui:user", reason: "Explicit local management UI review"}));
  }
  if (resource === "jobs") {
    z.object({action: z.literal("retry")}).strict().parse(body);
    return retryDistillJob(db, projectId, id);
  }
  if (resource === "research-claims") {
    const input = researchClaimAction.parse(body);
    return reviewResearchClaim(
      db,
      projectId,
      id,
      input.decision,
      input.reason,
      authorizeResearch(db, projectId, {actor: "ui:user", reason: "Explicit local Research Claim review"}),
      input.contradictionDispositions ?? []
    );
  }
  if (resource === "research-evidence") {
    const input = researchEvidenceAction.parse(body);
    if (input.action === "verify") return verifyEvidence(db, projectId, input.caseId, id);
    return markResearchEvidenceStale(
      db,
      projectId,
      id,
      input.reason,
      authorizeResearch(db, projectId, {actor: "ui:user", reason: "Explicit local Evidence lifecycle action"})
    );
  }
  if (resource === "research-snapshots") {
    const input = researchSnapshotAction.parse(body);
    return markResearchSourceSnapshotStale(
      db,projectId,id,input.reason,
      authorizeResearch(db, projectId, {actor:"ui:user",reason:"Explicit local Source Snapshot lifecycle action"})
    );
  }
  throw new Error("Unsupported viewer action");
}
