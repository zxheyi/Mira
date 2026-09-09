import {z} from 'zod';
import {selectionHash} from '../context/selectionManifest.js';
import type {ResearchCaseSnapshot,ResearchClaimSnapshot} from './researchTypes.js';
export const semanticAssessmentSchema=z.object({
 reportedMethod:z.enum(['human','model_assisted']),
 entailment:z.enum(['supported','unsupported','uncertain']),
 scope:z.enum(['matched','mismatched','uncertain']),
 timeRange:z.enum(['matched','mismatched','uncertain']),
 units:z.enum(['matched','mismatched','not_applicable','uncertain'])
}).strict();
export type SemanticAssessment=z.infer<typeof semanticAssessmentSchema>;
export function semanticSubjectHash(snapshot:ResearchCaseSnapshot,claim:ResearchClaimSnapshot):string {
 const evidence=claim.links.map(link=>snapshot.evidence.find(item=>item.id===link.evidenceId));
 const ids=new Set(evidence.filter(Boolean).map(item=>item!.id));
 const snapshotIds=new Set(evidence.filter(Boolean).map(item=>item!.snapshotId));
 return selectionHash({caseId:claim.caseId,asOfDate:snapshot.researchCase.asOfDate,
  claim:{id:claim.id,statement:claim.statement,evidenceStatus:claim.evidenceStatus,confidence:claim.confidence,thesisImpact:claim.thesisImpact,invalidationConditions:claim.invalidationConditions,status:claim.status,links:claim.links},
  evidence,snapshots:snapshot.snapshots.filter(item=>snapshotIds.has(item.id)),verifications:snapshot.verifications.filter(item=>ids.has(item.evidenceId)&&item.current)});
}
export type SemanticReviewStatus={state:'not_recorded'|'current'|'stale';assessment?:SemanticAssessment;actor?:string;reviewEventId?:string;subjectHash?:string};
export function semanticReviewStatus(snapshot:ResearchCaseSnapshot,claim:ResearchClaimSnapshot):SemanticReviewStatus {
 const latest=snapshot.events.slice().reverse().find(event=>event.claimId===claim.id&&event.eventType==='claim_reviewed');
 const stored=latest?.receipt.semanticReview as {assessment?:unknown;subjectHash?:unknown}|undefined;
 const assessment=semanticAssessmentSchema.safeParse(stored?.assessment);
 if(!latest||!assessment.success||typeof stored?.subjectHash!=='string') return {state:'not_recorded'};
 return {state:stored.subjectHash===semanticSubjectHash(snapshot,claim)?'current':'stale',assessment:assessment.data,actor:latest.receipt.actor,reviewEventId:latest.id,subjectHash:stored.subjectHash};
}
