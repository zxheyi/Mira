import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { assertNoSensitiveInformation } from "../distill/candidatePolicy.js";
import { appendDomainEvent, enqueueProjectionRefresh } from "../events/domainOutboxStore.js";
import type {
  EvidenceVerification,
  EvidenceVerificationChecks,
  EvidenceVerificationReceipt,
  EvidenceVerificationStatus,
  SourceSnapshot,
  SourceSnapshotState
} from "./researchTypes.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const snapshotInputSchema = z.object({
  key: z.string().trim().min(1).max(100).optional(),
  canonicalUri: z.url().max(4000),
  sourceTitle: z.string().trim().min(1).max(1000),
  publishedAt: dateSchema.optional(),
  accessedAt: dateSchema,
  mediaType: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(5_000_000)
}).strict();

export type RegisterSourceSnapshotInput = z.infer<typeof snapshotInputSchema>;

type SnapshotRow = {
  id:string;project_id:string;canonical_uri:string;source_title:string;published_at:string|null;
  accessed_at:string;media_type:string;content:string;content_hash:string;state:SourceSnapshotState;
  created_at:string;updated_at:string;
};
type VerificationRow = {
  id:string;project_id:string;case_id:string;evidence_id:string;snapshot_id:string;
  status:EvidenceVerificationStatus;checks:string;receipt:string;is_current:number;
  supersedes_verification_id:string|null;verified_at:string|null;created_at:string;updated_at:string;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();

function toSnapshot(row: SnapshotRow): SourceSnapshot {
  return {id:row.id,projectId:row.project_id,canonicalUri:row.canonical_uri,sourceTitle:row.source_title,
    publishedAt:row.published_at ?? undefined,accessedAt:row.accessed_at,mediaType:row.media_type,
    content:row.content,contentHash:row.content_hash,state:row.state,createdAt:row.created_at,updatedAt:row.updated_at};
}

function toVerification(row: VerificationRow): EvidenceVerification {
  return {id:row.id,projectId:row.project_id,caseId:row.case_id,evidenceId:row.evidence_id,
    snapshotId:row.snapshot_id,status:row.status,checks:JSON.parse(row.checks) as EvidenceVerificationChecks,
    receipt:JSON.parse(row.receipt) as EvidenceVerificationReceipt,current:row.is_current === 1,
    supersedesVerificationId:row.supersedes_verification_id ?? undefined,
    verifiedAt:row.verified_at ?? undefined,createdAt:row.created_at,updatedAt:row.updated_at};
}

export function registerSourceSnapshot(
  db: Database.Database,
  projectId: string,
  input: RegisterSourceSnapshotInput
): SourceSnapshot {
  const parsed = snapshotInputSchema.parse(input);
  assertNoSensitiveInformation(parsed.content, "Source Snapshot");
  const contentHash = sha256(parsed.content);
  const existing = db.prepare(`
    select * from source_snapshots
    where project_id = ? and canonical_uri = ? and content_hash = ?
  `).get(projectId, parsed.canonicalUri, contentHash) as SnapshotRow | undefined;
  if (existing) return toSnapshot(existing);

  return db.transaction(() => {
    const now = new Date().toISOString();
    const id = `source_snapshot_${randomUUID()}`;
    db.prepare(`insert into source_snapshots (
      id, project_id, canonical_uri, source_title, published_at, accessed_at, media_type,
      content, content_hash, state, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', ?, ?)`)
      .run(id, projectId, parsed.canonicalUri, parsed.sourceTitle, parsed.publishedAt ?? null,
        parsed.accessedAt, parsed.mediaType, parsed.content, contentHash, now, now);
    appendDomainEvent(db, {projectId,aggregateType:"source_snapshot",aggregateId:id,
      eventType:"source_snapshot_registered",payload:{canonicalUri:parsed.canonicalUri,contentHash},createdAt:now});
    return toSnapshot(db.prepare("select * from source_snapshots where project_id = ? and id = ?")
      .get(projectId, id) as SnapshotRow);
  })();
}

export function createPendingEvidenceVerification(db: Database.Database, input: {
  projectId:string;caseId:string;evidenceId:string;snapshotId:string;createdAt?:string;
}): EvidenceVerification {
  const current = db.prepare(`select * from evidence_verifications
    where project_id = ? and evidence_id = ? and is_current = 1`)
    .get(input.projectId, input.evidenceId) as VerificationRow | undefined;
  if (current) return toVerification(current);
  const now = input.createdAt ?? new Date().toISOString();
  const checks: EvidenceVerificationChecks = {
    integrity:false,sourceBinding:false,locator:false,excerpt:false,publication:false,freshness:false
  };
  const receipt: EvidenceVerificationReceipt = {
    checkCodes:["pending"],storedContentHash:"",actualContentHash:"",locatorHash:"",excerptHash:""
  };
  const id = `evidence_verification_${randomUUID()}`;
  db.prepare(`insert into evidence_verifications (
    id, project_id, case_id, evidence_id, snapshot_id, status, checks, receipt,
    is_current, created_at, updated_at
  ) values (?, ?, ?, ?, ?, 'pending', ?, ?, 1, ?, ?)`)
    .run(id,input.projectId,input.caseId,input.evidenceId,input.snapshotId,
      JSON.stringify(checks),JSON.stringify(receipt),now,now);
  return toVerification(db.prepare("select * from evidence_verifications where id = ?").get(id) as VerificationRow);
}

export function verifyEvidence(
  db: Database.Database,
  projectId: string,
  caseId: string,
  evidenceId: string
): EvidenceVerification {
  return db.transaction(() => {
    const row = db.prepare(`
      select e.source_uri, e.locator, e.excerpt, e.published_at as evidence_published_at,
             e.accessed_at as evidence_accessed_at, e.valid_through, e.state as evidence_state,
             e.snapshot_id, c.as_of_date,
             s.canonical_uri, s.published_at as snapshot_published_at, s.content,
             s.content_hash, s.state as snapshot_state
      from research_evidence e
      join research_cases c on c.project_id = e.project_id and c.id = e.case_id
      join source_snapshots s on s.project_id = e.project_id and s.id = e.snapshot_id
      where e.project_id = ? and e.case_id = ? and e.id = ?
    `).get(projectId, caseId, evidenceId) as {
      source_uri:string;locator:string;excerpt:string;evidence_published_at:string|null;
      evidence_accessed_at:string;valid_through:string|null;evidence_state:string;snapshot_id:string;
      as_of_date:string;canonical_uri:string;snapshot_published_at:string|null;content:string;
      content_hash:string;snapshot_state:string;
    } | undefined;
    if (!row) throw new Error(`Bound Research Evidence not found: ${evidenceId}`);

    const actualContentHash = sha256(row.content);
    const normalizedContent = normalize(row.content);
    const normalizedLocator = normalize(row.locator);
    const normalizedExcerpt = normalize(row.excerpt);
    const checks: EvidenceVerificationChecks = {
      integrity: actualContentHash === row.content_hash,
      sourceBinding: row.source_uri === row.canonical_uri
        && (!row.evidence_published_at || row.evidence_published_at === row.snapshot_published_at),
      locator: normalizedContent.includes(normalizedLocator),
      excerpt: normalizedContent.includes(normalizedExcerpt),
      publication: !row.snapshot_published_at || row.snapshot_published_at <= row.as_of_date,
      freshness: (!row.snapshot_published_at || row.evidence_accessed_at >= row.snapshot_published_at)
        && (!row.snapshot_published_at || !row.valid_through || row.valid_through >= row.snapshot_published_at)
    };
    const checkCodes = [
      ...(!checks.integrity ? ["content_hash_mismatch"] : []),
      ...(!checks.sourceBinding ? ["source_binding_mismatch"] : []),
      ...(!checks.locator ? ["locator_not_found"] : []),
      ...(!checks.excerpt ? ["excerpt_not_found"] : []),
      ...(!checks.publication ? ["published_after_case_as_of"] : []),
      ...(!checks.freshness ? ["invalid_freshness_window"] : [])
    ];
    const stale = row.evidence_state !== "current" || row.snapshot_state !== "current";
    const status: EvidenceVerificationStatus = stale
      ? "stale"
      : Object.values(checks).every(Boolean) ? "verified" : "failed";
    if (stale) checkCodes.push("source_or_evidence_stale");
    const receipt: EvidenceVerificationReceipt = {
      checkCodes,storedContentHash:row.content_hash,actualContentHash,
      locatorHash:sha256(normalizedLocator),excerptHash:sha256(normalizedExcerpt)
    };
    const now = new Date().toISOString();
    const current = db.prepare(`select * from evidence_verifications
      where project_id = ? and evidence_id = ? and is_current = 1`)
      .get(projectId, evidenceId) as VerificationRow | undefined;
    if (current && current.status === status && current.receipt === JSON.stringify(receipt)) {
      return toVerification(current);
    }
    let id = current?.id;
    if (!current || current.status !== "pending") {
      if (current) db.prepare("update evidence_verifications set is_current = 0, updated_at = ? where id = ?")
        .run(now, current.id);
      id = `evidence_verification_${randomUUID()}`;
      db.prepare(`insert into evidence_verifications (
        id, project_id, case_id, evidence_id, snapshot_id, status, checks, receipt,
        is_current, supersedes_verification_id, verified_at, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
        .run(id,projectId,caseId,evidenceId,row.snapshot_id,status,JSON.stringify(checks),JSON.stringify(receipt),
          current?.id ?? null,status === "verified" ? now : null,now,now);
    } else {
      db.prepare(`update evidence_verifications set status = ?, checks = ?, receipt = ?,
        verified_at = ?, updated_at = ? where id = ?`)
        .run(status,JSON.stringify(checks),JSON.stringify(receipt),status === "verified" ? now : null,now,current.id);
    }
    const event = appendDomainEvent(db, {projectId,aggregateType:"research_evidence",aggregateId:evidenceId,
      eventType:status === "verified" ? "evidence_verified" : "evidence_verification_failed",
      payload:{caseId,verificationId:id,snapshotId:row.snapshot_id,status,checkCodes},createdAt:now});
    enqueueProjectionRefresh(db, {projectId,eventId:event.id,reason:"research_evidence_verified",
      aggregateId:evidenceId,createdAt:now});
    return toVerification(db.prepare("select * from evidence_verifications where id = ?").get(id) as VerificationRow);
  })();
}
