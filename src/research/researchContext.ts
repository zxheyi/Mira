import {normalizeBudget, withinBudget, type ContextBudget, type ContextSelection} from "../context/contextBudget.js";
import {contextScope, type ScopeRequest, type ContextScope} from "../context/contextScope.js";
import {evaluateResearchClaim, evaluateResearchEvidence} from "./researchEligibility.js";
import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { appendDomainEvent } from "../events/domainOutboxStore.js";
import { getResearchCaseSnapshot } from "./researchStore.js";
import type {
  EvidenceVerification,
  ResearchCaseSnapshot,
  ResearchClaimSnapshot,
  ResearchEvidence,
  SourceSnapshotSummary
} from "./researchTypes.js";

export type ResearchContextPacket = {
  schemaVersion:1; scope:ContextScope; generatedAt:string;
  selections:ContextSelection[]; budget:Required<ContextBudget>; tokenUpperBound:number; deliveryState:"prepared";
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

export type ResearchContextRecallReceipt = {
  schemaVersion?:2;scope?:ContextScope;selections?:ContextSelection[];deliveryState?:"prepared";budget?:Required<ContextBudget>;
  id: string;
  projectId: string;
  caseId: string;
  taskId?: string;
  transport: "mcp" | "cli" | "ui" | "internal";
  claimIds: string[];
  evidenceIds: string[];
  snapshotIds: string[];
  outputHash: string;
  characterCount: number;
  estimatedTokens: number;
  recorded: true;
  createdAt: string;
};

export type AuditedResearchContextPacket = ResearchContextPacket & {
  receipt: ResearchContextRecallReceipt;
};

export type ResearchBriefingSummary = {
  id: string;
  title: string;
  status: string;
  asOfDate: string;
  approvedClaimCount: number;
  eligibleClaimCount: number;
  pendingReviewClaimCount: number;
  verifiedEvidenceCount: number;
  evidenceCount: number;
};

function oneLine(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function eligibleClaims(snapshot: ResearchCaseSnapshot): ResearchClaimSnapshot[] {
  return snapshot.claims.filter(claim => evaluateResearchClaim(snapshot, claim).eligible);
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
  caseId: string,
  options: ScopeRequest & ContextBudget = {}
): ResearchContextPacket {
  const scope = contextScope(db, projectId, options);
  const budget=normalizeBudget(options);
  const snapshot = getResearchCaseSnapshot(db, projectId, caseId);
  const claims = eligibleClaims(snapshot);
  const selectedClaims:string[]=[];
  const selections:ContextSelection[]=snapshot.claims.filter(claim=>!evaluateResearchClaim(snapshot,claim).eligible).map(claim=>({type:"claim",id:claim.id,caseId,selected:false,reasons:evaluateResearchClaim(snapshot,claim).reasons}));
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
      const start=lines.length;
      const previousEvidence=new Set(includedEvidence);
      const previousSnapshots=new Set(includedSnapshots);
      lines.push(
        `- ${oneLine(claim.statement)} [claim:${claim.id}]`,
        `  - Confidence: ${claim.confidence}; thesis impact proposal: ${claim.thesisImpact}`,
        `  - Invalidation: ${oneLine(claim.invalidationConditions)}`
      );
      for (const link of claim.links) {
        const evidence = evidenceById.get(link.evidenceId);
        if (!evidence || evidence.state !== "current") continue;
        const verification = verificationFor(snapshot.verifications, evidence.id);
        if (!evaluateResearchEvidence(snapshot, evidence.id).eligible) {
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
      if (withinBudget(lines.join("\n") + "\n",budget)) {
        selectedClaims.push(claim.id);
        selections.push({type:"claim",id:claim.id,caseId,selected:true,reasons:["approved_current_verified_support"]});
      } else {
        lines.splice(start);
        for (const id of includedEvidence) if(!previousEvidence.has(id)) includedEvidence.delete(id);
        for (const id of includedSnapshots) if(!previousSnapshots.has(id)) includedSnapshots.delete(id);
        selections.push({type:"claim",id:claim.id,caseId,selected:false,reasons:["budget"]});
      }
    }
    lines.push("");
  }

  const rendered = lines.join("\n");
  const markdown = withinBudget(rendered,budget) ? rendered : "";
  return {
    schemaVersion:1, scope, generatedAt:new Date().toISOString(),
    selections,budget,tokenUpperBound:Buffer.byteLength(markdown,"utf8"),deliveryState:"prepared",
    projectId,
    caseId,
    asOfDate: snapshot.researchCase.asOfDate,
    markdown,
    claimIds: selectedClaims,
    evidenceIds: [...includedEvidence],
    snapshotIds: [...includedSnapshots],
    characterCount: markdown.length,
    estimatedTokens: Buffer.byteLength(markdown,"utf8")
  };
}

export function recallResearchContext(
  db: Database.Database,
  projectId: string,
  caseId: string,
  options: ScopeRequest & ContextBudget & {transport: "mcp" | "cli" | "ui" | "internal"}
): AuditedResearchContextPacket {
  const packet = prepareResearchContext(db, projectId, caseId, options);
  return recordPreparedResearchContext(db,packet,options);
}

export function recordPreparedResearchContext(db:Database.Database,packet:ResearchContextPacket,options:{taskId?:string;transport:"mcp"|"cli"|"ui"|"internal"}):AuditedResearchContextPacket {
  const {projectId,caseId}=packet;
  const receipt: ResearchContextRecallReceipt = {
    schemaVersion:2,scope:packet.scope,selections:packet.selections,deliveryState:"prepared",budget:packet.budget,
    id: `research_context_recall_${randomUUID()}`,
    projectId,
    caseId,
    ...(options.taskId ? {taskId: options.taskId} : {}),
    transport: options.transport,
    claimIds: packet.claimIds,
    evidenceIds: packet.evidenceIds,
    snapshotIds: packet.snapshotIds,
    outputHash: createHash("sha256").update(packet.markdown).digest("hex"),
    characterCount: packet.characterCount,
    estimatedTokens: packet.estimatedTokens,
    recorded: true,
    createdAt: new Date().toISOString()
  };
  appendDomainEvent(db, {
    id: receipt.id,
    projectId,
    aggregateType: "research_case",
    aggregateId: caseId,
    eventType: "research_context_prepared",
    payload: receipt,
    createdAt: receipt.createdAt
  });
  return {...packet, receipt};
}

export function listResearchContextRecalls(
  db: Database.Database,
  projectId: string,
  options: {caseId?: string; limit?: number} = {}
): ResearchContextRecallReceipt[] {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Research Context recall limit must be between 1 and 100");
  }
  const rows = options.caseId
    ? db.prepare(`select payload from domain_events
        where project_id = ? and aggregate_type = 'research_case'
          and event_type = 'research_context_prepared' and aggregate_id = ?
        order by created_at desc, rowid desc limit ?`)
      .all(projectId, options.caseId, limit)
    : db.prepare(`select payload from domain_events
        where project_id = ? and aggregate_type = 'research_case'
          and event_type = 'research_context_prepared'
        order by created_at desc, rowid desc limit ?`)
      .all(projectId, limit);
  return rows.map((row) =>
    JSON.parse((row as {payload: string}).payload) as ResearchContextRecallReceipt
  );
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
      eligibleClaimCount:eligibleClaims(getResearchCaseSnapshot(db, projectId, item.id)).length,
      pendingReviewClaimCount:Number(claims.pending ?? 0),
      verifiedEvidenceCount:Number(evidence.verified ?? 0),
      evidenceCount:Number(evidence.total)
    };
  });
}
