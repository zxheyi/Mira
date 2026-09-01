export const RESEARCH_CASE_STATUSES = ["draft", "in_review", "completed", "archived"] as const;
export const RESEARCH_SOURCE_TYPES = [
  "regulatory_filing",
  "company_material",
  "market_data",
  "research_paper",
  "secondary_analysis",
  "other"
] as const;
export const RESEARCH_EVIDENCE_STATES = ["current", "stale", "archived"] as const;
export const CLAIM_EVIDENCE_STATUSES = [
  "observed",
  "supported",
  "contested",
  "unsupported",
  "rejected"
] as const;
export const CLAIM_REVIEW_STATUSES = ["pending", "approved", "rejected", "changes_requested"] as const;
export const THESIS_IMPACTS = ["none", "watch", "strengthen", "weaken", "invalidate"] as const;
export const CLAIM_STATUSES = ["active", "superseded"] as const;
export const CLAIM_EVIDENCE_RELATIONS = ["supports", "contradicts", "contextual"] as const;
export const RESEARCH_EVENT_TYPES = [
  "packet_submitted",
  "claim_revised",
  "evidence_marked_stale",
  "claim_reviewed"
] as const;

export type ResearchCaseStatus = (typeof RESEARCH_CASE_STATUSES)[number];
export type ResearchSourceType = (typeof RESEARCH_SOURCE_TYPES)[number];
export type ResearchEvidenceState = (typeof RESEARCH_EVIDENCE_STATES)[number];
export type ClaimEvidenceStatus = (typeof CLAIM_EVIDENCE_STATUSES)[number];
export type ClaimReviewStatus = (typeof CLAIM_REVIEW_STATUSES)[number];
export type ThesisImpact = (typeof THESIS_IMPACTS)[number];
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export type ClaimEvidenceRelation = (typeof CLAIM_EVIDENCE_RELATIONS)[number];
export type ResearchEventType = (typeof RESEARCH_EVENT_TYPES)[number];

export type ResearchCase = {
  id: string;
  projectId: string;
  title: string;
  question: string;
  asOfDate: string;
  status: ResearchCaseStatus;
  createdAt: string;
  updatedAt: string;
};

export type ResearchEvidence = {
  id: string;
  projectId: string;
  caseId: string;
  sourceType: ResearchSourceType;
  sourceUri: string;
  sourceTitle: string;
  locator: string;
  excerpt: string;
  publishedAt?: string;
  accessedAt: string;
  validThrough?: string;
  contentHash: string;
  state: ResearchEvidenceState;
  createdAt: string;
  updatedAt: string;
};

export type ResearchClaim = {
  id: string;
  projectId: string;
  caseId: string;
  statement: string;
  evidenceStatus: ClaimEvidenceStatus;
  reviewStatus: ClaimReviewStatus;
  confidence: number;
  thesisImpact: ThesisImpact;
  invalidationConditions: string;
  status: ClaimStatus;
  supersedesClaimId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ResearchClaimEvidenceLink = {
  projectId: string;
  caseId: string;
  claimId: string;
  evidenceId: string;
  relation: ClaimEvidenceRelation;
  rationale: string;
};

export type ResearchEventReceipt = {
  operation?: string;
  actor?: string;
  authorityReason?: string;
  reason?: string;
  decision?: string;
  outcome: string;
  [key: string]: unknown;
};

export type ResearchEvent = {
  id: string;
  projectId: string;
  caseId: string;
  claimId?: string;
  evidenceId?: string;
  eventType: ResearchEventType;
  receipt: ResearchEventReceipt;
  createdAt: string;
};

export type ResearchClaimSnapshot = ResearchClaim & {
  links: ResearchClaimEvidenceLink[];
};

export type ResearchCaseSnapshot = {
  researchCase: ResearchCase;
  evidence: ResearchEvidence[];
  claims: ResearchClaimSnapshot[];
  events: ResearchEvent[];
};
