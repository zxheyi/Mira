import {z} from 'zod';
import {MiraError} from './errors.js';
export const CAPABILITY_SCOPES=['memory.review','memory.mutate','research.review','research.mutate','recall.feedback','context.delivery'] as const;
export type CapabilityScope=typeof CAPABILITY_SCOPES[number];
export type CapabilityPolicy={actor:string;reason:string;scopes?:CapabilityScope[];developmentLegacyBroad?:boolean};
export const scopesSchema=z.array(z.enum(CAPABILITY_SCOPES)).max(CAPABILITY_SCOPES.length).optional();
export const legacyDelegationSchema=z.boolean().optional();
export function allows(policy:CapabilityPolicy|undefined,scope:CapabilityScope):boolean {
  return !!policy && (policy.scopes?.includes(scope) || (policy.scopes===undefined && policy.developmentLegacyBroad===true));
}
export function requireCapability(policy:CapabilityPolicy,scope:CapabilityScope):void {
  if(!allows(policy,scope)) throw new MiraError('PERMISSION_DENIED',`Host-granted project authority does not include ${scope}`,'Use local CLI/UI review or ask the host administrator to grant the specific scope');
}
export const GOVERNED_TOOLS:Record<string,CapabilityScope>={
  record_context_delivery:"context.delivery",
  add_memory:'memory.mutate',update_memory:'memory.mutate',archive_memory:'memory.mutate',review_memory_candidate:'memory.review',
  review_research_claim:'research.review',revise_research_claim:'research.mutate',mark_research_evidence_stale:'research.mutate',record_recall_feedback:'recall.feedback'
};
