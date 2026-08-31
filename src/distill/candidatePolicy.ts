import { createHash } from "node:crypto";
import { MEMORY_KINDS, type MemoryKind } from "../memory/memoryStore.js";
import type {
  CandidateReviewReason,
  CandidateRiskLevel,
  MemoryCandidateInput
} from "./candidateTypes.js";

const LOW_RISK_KINDS = new Set<MemoryKind>([
  "fact",
  "convention",
  "lesson",
  "failed_attempt"
]);

const SENSITIVE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_\-]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:password|passwd|token|secret|api[_-]?key)\s*[:=]\s*[^\s]{8,}/i
];

export type NormalizedCandidateInput = MemoryCandidateInput & {
  contentHash: string;
  riskLevel: CandidateRiskLevel;
};

function requireText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Candidate ${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`Candidate ${field} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function requireScore(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Candidate ${field} must be a finite number between 0 and 1`);
  }
  return value;
}

export function hashCandidateContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function normalizeCandidateTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function containsSensitiveInformation(text: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

export function assertNoSensitiveInformation(text: string, label = "Candidate"): void {
  if (containsSensitiveInformation(text)) {
    throw new Error(`${label} contains sensitive information and was not sent or persisted`);
  }
}

export function normalizeCandidateInput(input: MemoryCandidateInput, threadRawText: string): NormalizedCandidateInput {
  const title = requireText(input.title, "title", 200);
  const content = requireText(input.content, "content", 10_000);
  const evidence = requireText(input.evidence, "evidence", 4_000);
  if (!(MEMORY_KINDS as readonly string[]).includes(input.kind)) {
    throw new Error(`Unsupported memory kind: ${String(input.kind)}`);
  }
  const confidence = requireScore(input.confidence, "confidence");
  const importance = requireScore(input.importance, "importance");
  if (!threadRawText.includes(evidence)) {
    throw new Error("Candidate evidence must appear in the source Thread");
  }
  const inspected = `${title}\n${content}\n${evidence}`;
  assertNoSensitiveInformation(inspected);
  const riskLevel: CandidateRiskLevel = LOW_RISK_KINDS.has(input.kind) ? "low" : "high";
  return {
    title,
    kind: input.kind,
    content,
    evidence,
    confidence,
    importance,
    contentHash: hashCandidateContent(content),
    riskLevel
  };
}

export function candidateReviewReasons(
  candidate: NormalizedCandidateInput,
  hasConflict: boolean
): CandidateReviewReason[] {
  const reasons: CandidateReviewReason[] = [];
  const normalize = (text: string) => text.trim().replace(/\s+/g, " ");
  if (!normalize(candidate.evidence).includes(normalize(candidate.content))) reasons.push("non_verbatim_claim");
  if (candidate.confidence < 0.9) reasons.push("low_confidence");
  if (candidate.riskLevel === "high") reasons.push("high_impact_kind");
  if (hasConflict) reasons.push("conflict");
  return reasons;
}
