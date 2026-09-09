import type {ResearchCaseSnapshot, ResearchClaimSnapshot} from './researchTypes.js';

export type Eligibility = {eligible: boolean; reasons: string[]};

/** Case-time eligibility is shared by approval, projection and recall; verification alone is not truth. */
export function evaluateResearchEvidence(snapshot: ResearchCaseSnapshot, evidenceId: string): Eligibility {
  const {id:caseId, projectId, asOfDate} = snapshot.researchCase;
  const evidence = snapshot.evidence.find(item => item.id === evidenceId && item.projectId === projectId && item.caseId === caseId);
  if (!evidence) return {eligible:false,reasons:['evidence_missing_or_wrong_scope']};
  const reasons: string[] = [];
  if (evidence.state !== 'current') reasons.push('evidence_not_current');
  if (evidence.validThrough && evidence.validThrough < asOfDate) reasons.push('evidence_expired');
  if (evidence.publishedAt && evidence.publishedAt > asOfDate) reasons.push('published_after_case');
  const source = snapshot.snapshots.find(item => item.id === evidence.snapshotId && item.projectId === projectId);
  if (!source || source.state !== 'current') reasons.push('snapshot_not_current');
  if (source?.publishedAt && source.publishedAt > asOfDate) reasons.push('snapshot_published_after_case');
  const verified = snapshot.verifications.some(item => item.evidenceId === evidence.id && item.snapshotId === source?.id
    && item.projectId === projectId && item.caseId === caseId && item.current && item.status === 'verified');
  if (!verified) reasons.push('evidence_not_verified');
  return {eligible:reasons.length === 0,reasons};
}

export function evaluateResearchClaim(snapshot: ResearchCaseSnapshot, claim: ResearchClaimSnapshot, requireApproval = true): Eligibility {
  const reasons: string[] = [];
  if (claim.projectId !== snapshot.researchCase.projectId || claim.caseId !== snapshot.researchCase.id) reasons.push('claim_wrong_scope');
  if (claim.status !== 'active') reasons.push('claim_not_active');
  if (requireApproval && claim.reviewStatus !== 'approved') reasons.push('claim_not_approved');
  if (claim.evidenceStatus !== 'observed' && claim.evidenceStatus !== 'supported') reasons.push('claim_not_supported');
  const supports = claim.links.filter(link => link.relation === 'supports');
  if (!supports.length) reasons.push('no_support');
  for (const link of supports) {
    if (link.projectId !== claim.projectId || link.caseId !== claim.caseId || link.claimId !== claim.id) reasons.push('support_wrong_scope');
    reasons.push(...evaluateResearchEvidence(snapshot, link.evidenceId).reasons);
  }
  return {eligible:reasons.length === 0,reasons:[...new Set(reasons)]};
}
