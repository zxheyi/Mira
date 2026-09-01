import type Database from "better-sqlite3";
import type {
  ClaimEvidenceRelation,
  ClaimEvidenceStatus,
  ClaimReviewStatus,
  ClaimStatus,
  ResearchCase,
  ResearchCaseSnapshot,
  ResearchCaseStatus,
  ResearchClaim,
  ResearchClaimEvidenceLink,
  ResearchEvent,
  ResearchEventReceipt,
  ResearchEventType,
  ResearchEvidence,
  ResearchEvidenceState,
  ResearchSourceType,
  ThesisImpact
} from "./researchTypes.js";

type ResearchCaseRow = {
  id: string; project_id: string; title: string; question: string; as_of_date: string;
  status: ResearchCaseStatus; created_at: string; updated_at: string;
};
type ResearchEvidenceRow = {
  id: string; project_id: string; case_id: string; source_type: ResearchSourceType;
  source_uri: string; source_title: string; locator: string; excerpt: string;
  published_at: string | null; accessed_at: string; valid_through: string | null;
  content_hash: string; state: ResearchEvidenceState; created_at: string; updated_at: string;
};
type ResearchClaimRow = {
  id: string; project_id: string; case_id: string; statement: string;
  evidence_status: ClaimEvidenceStatus; review_status: ClaimReviewStatus; confidence: number;
  thesis_impact: ThesisImpact; invalidation_conditions: string; status: ClaimStatus;
  supersedes_claim_id: string | null; created_at: string; updated_at: string;
};
type ResearchLinkRow = {
  project_id: string; case_id: string; claim_id: string; evidence_id: string;
  relation: ClaimEvidenceRelation; rationale: string;
};
type ResearchEventRow = {
  id: string; project_id: string; case_id: string; claim_id: string | null;
  evidence_id: string | null; event_type: ResearchEventType; receipt: string; created_at: string;
};

export type StoredResearchPacket = {
  researchCase: ResearchCase;
  evidence: ResearchEvidence[];
  claims: ResearchClaim[];
  links: ResearchClaimEvidenceLink[];
  event: ResearchEvent;
};

function toResearchCase(row: ResearchCaseRow): ResearchCase {
  return {
    id: row.id, projectId: row.project_id, title: row.title, question: row.question,
    asOfDate: row.as_of_date, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function toEvidence(row: ResearchEvidenceRow): ResearchEvidence {
  return {
    id: row.id, projectId: row.project_id, caseId: row.case_id, sourceType: row.source_type,
    sourceUri: row.source_uri, sourceTitle: row.source_title, locator: row.locator, excerpt: row.excerpt,
    publishedAt: row.published_at ?? undefined, accessedAt: row.accessed_at,
    validThrough: row.valid_through ?? undefined, contentHash: row.content_hash, state: row.state,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function toClaim(row: ResearchClaimRow): ResearchClaim {
  return {
    id: row.id, projectId: row.project_id, caseId: row.case_id, statement: row.statement,
    evidenceStatus: row.evidence_status, reviewStatus: row.review_status, confidence: row.confidence,
    thesisImpact: row.thesis_impact, invalidationConditions: row.invalidation_conditions,
    status: row.status, supersedesClaimId: row.supersedes_claim_id ?? undefined,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function toLink(row: ResearchLinkRow): ResearchClaimEvidenceLink {
  return {
    projectId: row.project_id, caseId: row.case_id, claimId: row.claim_id,
    evidenceId: row.evidence_id, relation: row.relation, rationale: row.rationale
  };
}

function toEvent(row: ResearchEventRow): ResearchEvent {
  return {
    id: row.id, projectId: row.project_id, caseId: row.case_id,
    claimId: row.claim_id ?? undefined, evidenceId: row.evidence_id ?? undefined,
    eventType: row.event_type, receipt: JSON.parse(row.receipt) as ResearchEventReceipt,
    createdAt: row.created_at
  };
}

export function createResearchPacketRecords(db: Database.Database, packet: StoredResearchPacket): void {
  db.transaction(() => {
    db.prepare(`
      insert into research_cases (
        id, project_id, title, question, as_of_date, status, created_at, updated_at
      ) values (
        @id, @projectId, @title, @question, @asOfDate, @status, @createdAt, @updatedAt
      )
    `).run(packet.researchCase);

    const insertEvidence = db.prepare(`
      insert into research_evidence (
        id, project_id, case_id, source_type, source_uri, source_title, locator, excerpt,
        published_at, accessed_at, valid_through, content_hash, state, created_at, updated_at
      ) values (
        @id, @projectId, @caseId, @sourceType, @sourceUri, @sourceTitle, @locator, @excerpt,
        @publishedAt, @accessedAt, @validThrough, @contentHash, @state, @createdAt, @updatedAt
      )
    `);
    for (const evidence of packet.evidence) {
      insertEvidence.run({
        ...evidence,
        publishedAt: evidence.publishedAt ?? null,
        validThrough: evidence.validThrough ?? null
      });
    }

    const insertClaim = db.prepare(`
      insert into research_claims (
        id, project_id, case_id, statement, evidence_status, review_status, confidence,
        thesis_impact, invalidation_conditions, status, supersedes_claim_id, created_at, updated_at
      ) values (
        @id, @projectId, @caseId, @statement, @evidenceStatus, @reviewStatus, @confidence,
        @thesisImpact, @invalidationConditions, @status, @supersedesClaimId, @createdAt, @updatedAt
      )
    `);
    for (const claim of packet.claims) {
      insertClaim.run({ ...claim, supersedesClaimId: claim.supersedesClaimId ?? null });
    }

    const insertLink = db.prepare(`
      insert into research_claim_evidence (
        project_id, case_id, claim_id, evidence_id, relation, rationale
      ) values (
        @projectId, @caseId, @claimId, @evidenceId, @relation, @rationale
      )
    `);
    for (const link of packet.links) insertLink.run(link);

    insertResearchEvent(db, packet.event);
  })();
}

export function insertResearchEvent(db: Database.Database, event: ResearchEvent): void {
  db.prepare(`
    insert into research_events (
      id, project_id, case_id, claim_id, evidence_id, event_type, receipt, created_at
    ) values (
      @id, @projectId, @caseId, @claimId, @evidenceId, @eventType, @receipt, @createdAt
    )
  `).run({
    ...event,
    claimId: event.claimId ?? null,
    evidenceId: event.evidenceId ?? null,
    receipt: JSON.stringify(event.receipt)
  });
}

export function listResearchCases(db: Database.Database, projectId: string): ResearchCase[] {
  return db.prepare(`
    select id, project_id, title, question, as_of_date, status, created_at, updated_at
    from research_cases where project_id = ? order by updated_at desc, id asc
  `).all(projectId).map((row) => toResearchCase(row as ResearchCaseRow));
}

export function getResearchCaseSnapshot(
  db: Database.Database,
  projectId: string,
  caseId: string
): ResearchCaseSnapshot {
  const caseRow = db.prepare(`
    select id, project_id, title, question, as_of_date, status, created_at, updated_at
    from research_cases where project_id = ? and id = ?
  `).get(projectId, caseId) as ResearchCaseRow | undefined;
  if (!caseRow) throw new Error("Research Case not found: " + caseId);

  const evidence = db.prepare(`
    select id, project_id, case_id, source_type, source_uri, source_title, locator, excerpt,
           published_at, accessed_at, valid_through, content_hash, state, created_at, updated_at
    from research_evidence where project_id = ? and case_id = ? order by created_at asc, id asc
  `).all(projectId, caseId).map((row) => toEvidence(row as ResearchEvidenceRow));
  const links = db.prepare(`
    select project_id, case_id, claim_id, evidence_id, relation, rationale
    from research_claim_evidence where project_id = ? and case_id = ?
    order by claim_id asc, evidence_id asc, relation asc
  `).all(projectId, caseId).map((row) => toLink(row as ResearchLinkRow));
  const claims = db.prepare(`
    select id, project_id, case_id, statement, evidence_status, review_status, confidence,
           thesis_impact, invalidation_conditions, status, supersedes_claim_id, created_at, updated_at
    from research_claims where project_id = ? and case_id = ? order by created_at asc, id asc
  `).all(projectId, caseId).map((row) => {
    const claim = toClaim(row as ResearchClaimRow);
    return { ...claim, links: links.filter((link) => link.claimId === claim.id) };
  });
  const events = db.prepare(`
    select id, project_id, case_id, claim_id, evidence_id, event_type, receipt, created_at
    from research_events where project_id = ? and case_id = ? order by created_at asc, id asc
  `).all(projectId, caseId).map((row) => toEvent(row as ResearchEventRow));

  return { researchCase: toResearchCase(caseRow), evidence, claims, events };
}
