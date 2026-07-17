import type { Memory, MemoryKind } from "../memory/memoryStore.js";

export const CANDIDATE_STATUSES = ["pending_review", "accepted", "rejected"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const CANDIDATE_REVIEW_REASONS = [
  "low_confidence",
  "high_impact_kind",
  "conflict",
  "duplicate"
] as const;
export type CandidateReviewReason = (typeof CANDIDATE_REVIEW_REASONS)[number];

export type CandidateExtractionMethod = "agent" | "provider";
export type CandidateRiskLevel = "low" | "high";

export type MemoryCandidateInput = {
  title: string;
  kind: MemoryKind;
  content: string;
  evidence: string;
  confidence: number;
  importance: number;
};

export type MemoryCandidate = MemoryCandidateInput & {
  id: string;
  projectId: string;
  threadId: string;
  jobId?: string;
  threadInputHash: string;
  sourceAgent: string;
  sourceModel?: string;
  extractionMethod: CandidateExtractionMethod;
  contentHash: string;
  riskLevel: CandidateRiskLevel;
  status: CandidateStatus;
  reviewReason?: string;
  reviewedAt?: string;
  acceptedMemoryId?: string;
  createdAt: string;
};

export type SubmitMemoryCandidatesInput = {
  projectId: string;
  threadId: string;
  jobId?: string;
  expectedThreadInputHash?: string;
  sourceAgent: string;
  sourceModel?: string;
  extractionMethod: CandidateExtractionMethod;
  candidates: MemoryCandidateInput[];
};

export type MemoryCandidateResult = {
  candidate: MemoryCandidate;
  outcome: "accepted" | "pending_review" | "rejected" | "duplicate";
  reasons: CandidateReviewReason[];
  memory?: Memory;
};
