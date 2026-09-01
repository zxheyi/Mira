import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { assertNoSensitiveInformation } from "../distill/candidatePolicy.js";
import {
  CLAIM_EVIDENCE_RELATIONS,
  CLAIM_EVIDENCE_STATUSES,
  RESEARCH_SOURCE_TYPES,
  THESIS_IMPACTS,
  type ClaimReviewStatus,
  type ResearchCaseSnapshot,
  type ResearchClaim,
  type ResearchClaimEvidenceLink,
  type ResearchEvidence
} from "./researchTypes.js";
import {
  createResearchPacketRecords,
  getResearchCaseSnapshot,
  insertResearchEvent,
  listResearchCases
} from "./researchStore.js";

export { getResearchCaseSnapshot, listResearchCases };

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD").refine((value) => {
  const parsed = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const keySchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const linkByKeySchema = z.object({
  evidenceKey: keySchema,
  relation: z.enum(CLAIM_EVIDENCE_RELATIONS),
  rationale: text(2000)
}).strict();
const evidenceInputSchema = z.object({
  key: keySchema,
  sourceType: z.enum(RESEARCH_SOURCE_TYPES),
  sourceUri: z.url().max(4000),
  sourceTitle: text(1000),
  locator: text(1000),
  excerpt: text(8000),
  publishedAt: dateSchema.optional(),
  accessedAt: dateSchema,
  validThrough: dateSchema.optional()
}).strict();
const claimInputSchema = z.object({
  key: keySchema,
  statement: text(4000),
  evidenceStatus: z.enum(CLAIM_EVIDENCE_STATUSES),
  confidence: z.number().min(0).max(1),
  thesisImpact: z.enum(THESIS_IMPACTS),
  invalidationConditions: text(4000),
  links: z.array(linkByKeySchema).min(1).max(100)
}).strict();
const packetSchema = z.object({
  case: z.object({
    title: text(500),
    question: text(2000),
    asOfDate: dateSchema
  }).strict(),
  evidence: z.array(evidenceInputSchema).min(1).max(100),
  claims: z.array(claimInputSchema).min(1).max(100)
}).strict();
const revisionSchema = z.object({
  statement: text(4000),
  evidenceStatus: z.enum(CLAIM_EVIDENCE_STATUSES),
  confidence: z.number().min(0).max(1),
  thesisImpact: z.enum(THESIS_IMPACTS),
  invalidationConditions: text(4000),
  links: z.array(z.object({
    evidenceId: text(200),
    relation: z.enum(CLAIM_EVIDENCE_RELATIONS),
    rationale: text(2000)
  }).strict()).min(1).max(100)
}).strict();

export type SubmitResearchPacketInput = z.infer<typeof packetSchema>;
export type ReviseResearchClaimInput = z.infer<typeof revisionSchema>;
export type ResearchReviewDecision = "approve" | "reject" | "request_changes";
export type ResearchConfirmationPolicy = { actor: string; reason: string };

declare const authorityBrand: unique symbol;
export type ResearchAuthority = { readonly [authorityBrand]: true };
const authorities = new WeakMap<
  ResearchAuthority,
  ResearchConfirmationPolicy & { db: Database.Database; projectId: string }
>();

export function authorizeResearch(
  db: Database.Database,
  projectId: string,
  policy: ResearchConfirmationPolicy
): ResearchAuthority {
  const parsed = z.object({ actor: text(200), reason: text(1000) }).strict().parse(policy);
  assertNoSensitiveInformation(parsed.actor + "\n" + parsed.reason, "Research authority");
  const authority = Object.freeze({}) as ResearchAuthority;
  authorities.set(authority, { db, projectId, ...parsed });
  return authority;
}

function requireResearchAuthority(
  db: Database.Database,
  projectId: string,
  authority?: ResearchAuthority
): ResearchConfirmationPolicy {
  const policy = authority && authorities.get(authority);
  if (!policy || policy.db !== db || policy.projectId !== projectId) {
    throw new Error(
      "Research review requires host-granted project authority; use the local CLI/UI or a host confirmation policy"
    );
  }
  return policy;
}

function uniqueKeys(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(label + " keys must be unique");
}

function hashEvidence(input: z.infer<typeof evidenceInputSchema>): string {
  return createHash("sha256").update(JSON.stringify({
    sourceUri: input.sourceUri,
    locator: input.locator,
    excerpt: input.excerpt,
    publishedAt: input.publishedAt ?? null
  })).digest("hex");
}

export function submitResearchPacket(
  db: Database.Database,
  projectId: string,
  input: SubmitResearchPacketInput,
  actor = "agent"
): ResearchCaseSnapshot {
  const parsed = packetSchema.parse(input);
  const parsedActor = text(200).parse(actor);
  assertNoSensitiveInformation(JSON.stringify({ ...parsed, actor: parsedActor }), "Research packet");
  uniqueKeys(parsed.evidence.map((item) => item.key), "Evidence");
  uniqueKeys(parsed.claims.map((item) => item.key), "Claim");
  const evidenceKeys = new Set(parsed.evidence.map((item) => item.key));
  for (const claim of parsed.claims) {
    for (const link of claim.links) {
      if (!evidenceKeys.has(link.evidenceKey)) {
        throw new Error("Claim " + claim.key + " references unknown Evidence key " + link.evidenceKey);
      }
    }
  }

  const now = new Date().toISOString();
  const caseId = "research_case_" + randomUUID();
  const evidenceIds = new Map(parsed.evidence.map((item) => [item.key, "research_evidence_" + randomUUID()]));
  const claimIds = new Map(parsed.claims.map((item) => [item.key, "research_claim_" + randomUUID()]));
  const evidence: ResearchEvidence[] = parsed.evidence.map((item) => ({
    id: evidenceIds.get(item.key)!,
    projectId,
    caseId,
    sourceType: item.sourceType,
    sourceUri: item.sourceUri,
    sourceTitle: item.sourceTitle,
    locator: item.locator,
    excerpt: item.excerpt,
    publishedAt: item.publishedAt,
    accessedAt: item.accessedAt,
    validThrough: item.validThrough,
    contentHash: hashEvidence(item),
    state: "current",
    createdAt: now,
    updatedAt: now
  }));
  const claims: ResearchClaim[] = parsed.claims.map((item) => ({
    id: claimIds.get(item.key)!,
    projectId,
    caseId,
    statement: item.statement,
    evidenceStatus: item.evidenceStatus,
    reviewStatus: "pending",
    confidence: item.confidence,
    thesisImpact: item.thesisImpact,
    invalidationConditions: item.invalidationConditions,
    status: "active",
    createdAt: now,
    updatedAt: now
  }));
  const links: ResearchClaimEvidenceLink[] = parsed.claims.flatMap((claim) => claim.links.map((link) => ({
    projectId,
    caseId,
    claimId: claimIds.get(claim.key)!,
    evidenceId: evidenceIds.get(link.evidenceKey)!,
    relation: link.relation,
    rationale: link.rationale
  })));

  createResearchPacketRecords(db, {
    researchCase: {
      id: caseId,
      projectId,
      title: parsed.case.title,
      question: parsed.case.question,
      asOfDate: parsed.case.asOfDate,
      status: "draft",
      createdAt: now,
      updatedAt: now
    },
    evidence,
    claims,
    links,
    event: {
      id: "research_event_" + randomUUID(),
      projectId,
      caseId,
      eventType: "packet_submitted",
      receipt: {
        operation: "submitResearchPacket",
        actor: parsedActor,
        outcome: "created",
        evidenceIds: evidence.map((item) => item.id),
        claimIds: claims.map((item) => item.id)
      },
      createdAt: now
    }
  });
  return getResearchCaseSnapshot(db, projectId, caseId);
}

function requireActiveClaim(
  db: Database.Database,
  projectId: string,
  claimId: string
): { snapshot: ResearchCaseSnapshot; claim: ResearchClaim & { links: ResearchClaimEvidenceLink[] } } {
  const row = db.prepare(
    "select case_id from research_claims where project_id = ? and id = ?"
  ).get(projectId, claimId) as { case_id: string } | undefined;
  if (!row) throw new Error("Research Claim not found: " + claimId);
  const snapshot = getResearchCaseSnapshot(db, projectId, row.case_id);
  const claim = snapshot.claims.find((item) => item.id === claimId);
  if (!claim) throw new Error("Research Claim not found: " + claimId);
  if (claim.status !== "active") throw new Error("Only active Research Claims can be changed: " + claimId);
  return { snapshot, claim };
}

function recomputeCaseStatus(db: Database.Database, projectId: string, caseId: string, now: string): void {
  const rows = db.prepare(
    "select review_status from research_claims where project_id = ? and case_id = ? and status = 'active'"
  ).all(projectId, caseId) as Array<{ review_status: ClaimReviewStatus }>;
  const completed = rows.length > 0
    && rows.every((row) => row.review_status === "approved" || row.review_status === "rejected")
    && rows.some((row) => row.review_status === "approved");
  db.prepare(
    "update research_cases set status = ?, updated_at = ? where project_id = ? and id = ?"
  ).run(completed ? "completed" : "in_review", now, projectId, caseId);
}

function currentSupportingEvidence(snapshot: ResearchCaseSnapshot, claimId: string): ResearchEvidence[] {
  const claim = snapshot.claims.find((item) => item.id === claimId);
  if (!claim) return [];
  const evidenceById = new Map(snapshot.evidence.map((item) => [item.id, item]));
  return claim.links.filter((link) => link.relation === "supports")
    .map((link) => evidenceById.get(link.evidenceId))
    .filter((item): item is ResearchEvidence => Boolean(
      item
      && item.state === "current"
      && (!item.validThrough || item.validThrough >= snapshot.researchCase.asOfDate)
    ));
}

export function reviewResearchClaim(
  db: Database.Database,
  projectId: string,
  claimId: string,
  decision: ResearchReviewDecision,
  reason: string,
  authority?: ResearchAuthority
): ResearchCaseSnapshot {
  const policy = requireResearchAuthority(db, projectId, authority);
  const parsed = z.object({
    decision: z.enum(["approve", "reject", "request_changes"]),
    reason: text(2000)
  }).parse({ decision, reason });
  assertNoSensitiveInformation(parsed.reason, "Research review reason");

  return db.transaction(() => {
    const { snapshot, claim } = requireActiveClaim(db, projectId, claimId);
    if (parsed.decision === "approve") {
      if (claim.evidenceStatus !== "observed" && claim.evidenceStatus !== "supported") {
        throw new Error("Approval requires observed or supported Evidence Status");
      }
      if (currentSupportingEvidence(snapshot, claimId).length === 0) {
        throw new Error("Approval requires at least one current support Evidence Item");
      }
      if (!claim.invalidationConditions.trim()) {
        throw new Error("Approval requires invalidation conditions");
      }
    }
    const now = new Date().toISOString();
    const reviewStatus: ClaimReviewStatus = parsed.decision === "request_changes"
      ? "changes_requested"
      : parsed.decision === "approve" ? "approved" : "rejected";
    const changed = db.prepare(
      "update research_claims set review_status = ?, updated_at = ? where project_id = ? and id = ? and status = 'active'"
    ).run(reviewStatus, now, projectId, claimId);
    if (changed.changes !== 1) throw new Error("Research Claim changed concurrently: " + claimId);
    recomputeCaseStatus(db, projectId, claim.caseId, now);
    insertResearchEvent(db, {
      id: "research_event_" + randomUUID(),
      projectId,
      caseId: claim.caseId,
      claimId,
      eventType: "claim_reviewed",
      receipt: {
        operation: "reviewResearchClaim",
        actor: policy.actor,
        authorityReason: policy.reason,
        reason: parsed.reason,
        decision: parsed.decision,
        outcome: reviewStatus
      },
      createdAt: now
    });
    return getResearchCaseSnapshot(db, projectId, claim.caseId);
  })();
}

export function markResearchEvidenceStale(
  db: Database.Database,
  projectId: string,
  evidenceId: string,
  reason: string,
  authority?: ResearchAuthority
): ResearchCaseSnapshot {
  const policy = requireResearchAuthority(db, projectId, authority);
  const parsedReason = text(2000).parse(reason);
  assertNoSensitiveInformation(parsedReason, "Research evidence stale reason");
  return db.transaction(() => {
    const evidence = db.prepare(
      "select case_id, state from research_evidence where project_id = ? and id = ?"
    ).get(projectId, evidenceId) as { case_id: string; state: string } | undefined;
    if (!evidence) throw new Error("Research Evidence not found: " + evidenceId);
    if (evidence.state !== "current") throw new Error("Only current Research Evidence can be marked stale");
    const now = new Date().toISOString();
    db.prepare(
      "update research_evidence set state = 'stale', updated_at = ? where project_id = ? and id = ?"
    ).run(now, projectId, evidenceId);
    const affected = db.prepare(`
      select distinct c.id
      from research_claims c
      join research_claim_evidence l
        on l.project_id = c.project_id and l.case_id = c.case_id and l.claim_id = c.id
      where c.project_id = ? and c.case_id = ? and c.status = 'active' and l.evidence_id = ?
      order by c.id
    `).all(projectId, evidence.case_id, evidenceId).map((row) => (row as { id: string }).id);
    if (affected.length > 0) {
      const placeholders = affected.map(() => "?").join(", ");
      db.prepare(
        "update research_claims set review_status = 'changes_requested', updated_at = ? "
        + "where project_id = ? and id in (" + placeholders + ")"
      ).run(now, projectId, ...affected);
    }
    db.prepare(
      "update research_cases set status = 'in_review', updated_at = ? where project_id = ? and id = ?"
    ).run(now, projectId, evidence.case_id);
    insertResearchEvent(db, {
      id: "research_event_" + randomUUID(),
      projectId,
      caseId: evidence.case_id,
      evidenceId,
      eventType: "evidence_marked_stale",
      receipt: {
        operation: "markResearchEvidenceStale",
        actor: policy.actor,
        authorityReason: policy.reason,
        reason: parsedReason,
        outcome: "stale",
        affectedClaimIds: affected
      },
      createdAt: now
    });
    return getResearchCaseSnapshot(db, projectId, evidence.case_id);
  })();
}

export function reviseResearchClaim(
  db: Database.Database,
  projectId: string,
  claimId: string,
  input: ReviseResearchClaimInput,
  reason: string,
  authority?: ResearchAuthority
): ResearchCaseSnapshot {
  const policy = requireResearchAuthority(db, projectId, authority);
  const parsed = revisionSchema.parse(input);
  const parsedReason = text(2000).parse(reason);
  assertNoSensitiveInformation(JSON.stringify({ ...parsed, reason: parsedReason }), "Research claim revision");
  return db.transaction(() => {
    const { snapshot, claim } = requireActiveClaim(db, projectId, claimId);
    if (parsed.statement === claim.statement) {
      throw new Error("Revised Research Claim statement must differ from its predecessor");
    }
    const evidenceIds = new Set(snapshot.evidence.map((item) => item.id));
    for (const link of parsed.links) {
      if (!evidenceIds.has(link.evidenceId)) {
        throw new Error("Research Evidence does not belong to this Case: " + link.evidenceId);
      }
    }
    const duplicateLinks = parsed.links.map((link) => link.evidenceId + "\u0000" + link.relation);
    uniqueKeys(duplicateLinks, "Claim Evidence relation");
    const now = new Date().toISOString();
    const successorId = "research_claim_" + randomUUID();
    db.prepare(`
      insert into research_claims (
        id, project_id, case_id, statement, evidence_status, review_status, confidence,
        thesis_impact, invalidation_conditions, status, supersedes_claim_id, created_at, updated_at
      ) values (?, ?, ?, ?, ?, 'pending', ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      successorId, projectId, claim.caseId, parsed.statement, parsed.evidenceStatus,
      parsed.confidence, parsed.thesisImpact, parsed.invalidationConditions, claimId, now, now
    );
    const insertLink = db.prepare(`
      insert into research_claim_evidence (
        project_id, case_id, claim_id, evidence_id, relation, rationale
      ) values (?, ?, ?, ?, ?, ?)
    `);
    for (const link of parsed.links) {
      insertLink.run(projectId, claim.caseId, successorId, link.evidenceId, link.relation, link.rationale);
    }
    const changed = db.prepare(
      "update research_claims set status = 'superseded', updated_at = ? "
      + "where project_id = ? and id = ? and status = 'active'"
    ).run(now, projectId, claimId);
    if (changed.changes !== 1) throw new Error("Research Claim changed concurrently: " + claimId);
    db.prepare(
      "update research_cases set status = 'in_review', updated_at = ? where project_id = ? and id = ?"
    ).run(now, projectId, claim.caseId);
    insertResearchEvent(db, {
      id: "research_event_" + randomUUID(),
      projectId,
      caseId: claim.caseId,
      claimId: successorId,
      eventType: "claim_revised",
      receipt: {
        operation: "reviseResearchClaim",
        actor: policy.actor,
        authorityReason: policy.reason,
        reason: parsedReason,
        outcome: "successor_created",
        predecessorClaimId: claimId,
        successorClaimId: successorId
      },
      createdAt: now
    });
    return getResearchCaseSnapshot(db, projectId, claim.caseId);
  })();
}
