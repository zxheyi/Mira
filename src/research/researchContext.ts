import type Database from "better-sqlite3";
import { getResearchCaseSnapshot } from "./researchStore.js";
import type {
  EvidenceVerification,
  ResearchCaseSnapshot,
  ResearchClaimSnapshot,
  ResearchEvidence,
  SourceSnapshotSummary
} from "./researchTypes.js";

export type ResearchContextPacket = {
  projectId: string;
  caseId: string;
  asOfDate: string;
  markdown: string;
  claimIds: string[];
  evidenceIds: string[];
  snapshotIds: string[];
  characterCount: number;
  estimatedTokens: number;
};

export type ResearchBriefingSummary = {
  id: string;
  title: string;
  status: string;
  asOfDate: string;
  approvedClaimCount: number;
  pendingReviewClaimCount: number;
  verifiedEvidenceCount: number;
  evidenceCount: number;
};

function oneLine(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function verifiedEvidenceIds(snapshot: ResearchCaseSnapshot): Set<string> {
  return new Set(snapshot.verifications
    .filter((item) => item.current && item.status === "verified")
    .map((item) => item.evidenceId));
}

function eligibleClaims(snapshot: ResearchCaseSnapshot): ResearchClaimSnapshot[] {
  const evidenceById = new Map(snapshot.evidence.map((item) => [item.id, item]));
  const verified = verifiedEvidenceIds(snapshot);
  return snapshot.claims.filter((claim) => {
    if (claim.status !== "active" || claim.reviewStatus !== "approved") return false;
    const supports = claim.links.filter((link) => link.relation === "supports");
    return supports.length > 0 && supports.every((link) => {
      const evidence = evidenceById.get(link.evidenceId);
      return evidence?.state === "current" && verified.has(link.evidenceId);
    });
  });
}

function verificationFor(
  verifications: EvidenceVerification[],
  evidenceId: string
): EvidenceVerification | undefined {
  return verifications.find((item) => item.evidenceId === evidenceId && item.current);
}

function renderEvidence(
  evidence: ResearchEvidence,
  source: SourceSnapshotSummary | undefined,
  verification: EvidenceVerification | undefined,
  relation: string
): string {
  return `  - ${relation}: ${oneLine(evidence.sourceTitle)} · ${oneLine(evidence.locator)} `
    + `[evidence:${evidence.id}] [snapshot:${source?.id ?? evidence.snapshotId ?? "missing"}] `
    + `[sha256:${source?.contentHash ?? "missing"}] [verification:${verification?.id ?? "missing"}]`;
}

export function prepareResearchContext(
  db: Database.Database,
  projectId: string,
  caseId: string
): ResearchContextPacket {
  const snapshot = getResearchCaseSnapshot(db, projectId, caseId);
  const claims = eligibleClaims(snapshot);
  const evidenceById = new Map(snapshot.evidence.map((item) => [item.id, item]));
  const snapshotsById = new Map(snapshot.snapshots.map((item) => [item.id, item]));
  const includedEvidence = new Set<string>();
  const includedSnapshots = new Set<string>();
  const lines = [
    `# Research Context: ${oneLine(snapshot.researchCase.title)}`,
    "",
    `Question: ${oneLine(snapshot.researchCase.question)}`,
    `As of: ${snapshot.researchCase.asOfDate}`,
    "",
    "Only active, approved Claims whose supporting Evidence is current and verified are included.",
    "Evidence verification proves snapshot binding and excerpt integrity; it does not independently prove the Claim inference.",
    ""
  ];

  if (claims.length === 0) {
    lines.push("No evidence-gated Claims are currently eligible for context.", "");
  } else {
    lines.push("## Approved Claims", "");
    for (const claim of claims) {
      lines.push(
        `- ${oneLine(claim.statement)} [claim:${claim.id}]`,
        `  - Confidence: ${claim.confidence}; thesis impact proposal: ${claim.thesisImpact}`,
        `  - Invalidation: ${oneLine(claim.invalidationConditions)}`
      );
      for (const link of claim.links) {
        const evidence = evidenceById.get(link.evidenceId);
        if (!evidence || evidence.state !== "current") continue;
        const verification = verificationFor(snapshot.verifications, evidence.id);
        if (!verification || verification.status !== "verified") {
          lines.push(`  - ${link.relation}: [evidence:${evidence.id}] omitted from evidence context; verification is ${verification?.status ?? "missing"}`);
          continue;
        }
        const source = evidence.snapshotId ? snapshotsById.get(evidence.snapshotId) : undefined;
        includedEvidence.add(evidence.id);
        if (source) includedSnapshots.add(source.id);
        lines.push(renderEvidence(evidence, source, verification, link.relation));
      }
      const approval = snapshot.events.slice().reverse().find((event) =>
        event.claimId === claim.id && event.eventType === "claim_reviewed"
        && event.receipt.decision === "approve"
      );
      const dispositions = approval?.receipt.contradictionDispositions;
      if (Array.isArray(dispositions)) {
        for (const item of dispositions) {
          if (!item || typeof item !== "object") continue;
          const parsed = item as {evidenceId?:unknown;disposition?:unknown;rationale?:unknown};
          if (typeof parsed.evidenceId === "string" && typeof parsed.disposition === "string"
            && typeof parsed.rationale === "string") {
            lines.push(`  - Contradiction disposition: ${parsed.disposition} for [evidence:${parsed.evidenceId}] · ${oneLine(parsed.rationale)}`);
          }
        }
      }
    }
    lines.push("");
  }

  const markdown = lines.join("\n");
  return {
    projectId,
    caseId,
    asOfDate: snapshot.researchCase.asOfDate,
    markdown,
    claimIds: claims.map((claim) => claim.id),
    evidenceIds: [...includedEvidence],
    snapshotIds: [...includedSnapshots],
    characterCount: markdown.length,
    estimatedTokens: Math.ceil(markdown.length / 4)
  };
}

export function listResearchBriefingSummaries(
  db: Database.Database,
  projectId: string
): ResearchBriefingSummary[] {
  const cases = db.prepare(`
    select id, title, status, as_of_date
    from research_cases
    where project_id = ?
    order by updated_at desc, id asc
  `).all(projectId) as Array<{id:string;title:string;status:string;as_of_date:string}>;
  const claimCounts = db.prepare(`
    select
      sum(case when status = 'active' and review_status = 'approved' then 1 else 0 end) as approved,
      sum(case when status = 'active' and review_status in ('pending', 'changes_requested') then 1 else 0 end) as pending
    from research_claims where project_id = ? and case_id = ?
  `);
  const evidenceCounts = db.prepare(`
    select count(*) as total,
      sum(case when e.state = 'current' and v.status = 'verified' then 1 else 0 end) as verified
    from research_evidence e
    left join evidence_verifications v
      on v.project_id = e.project_id and v.evidence_id = e.id and v.is_current = 1
    where e.project_id = ? and e.case_id = ?
  `);
  return cases.map((item) => {
    const claims = claimCounts.get(projectId, item.id) as {approved:number|null;pending:number|null};
    const evidence = evidenceCounts.get(projectId, item.id) as {total:number;verified:number|null};
    return {
      id:item.id,title:item.title,status:item.status,asOfDate:item.as_of_date,
      approvedClaimCount:Number(claims.approved ?? 0),
      pendingReviewClaimCount:Number(claims.pending ?? 0),
      verifiedEvidenceCount:Number(evidence.verified ?? 0),
      evidenceCount:Number(evidence.total)
    };
  });
}
