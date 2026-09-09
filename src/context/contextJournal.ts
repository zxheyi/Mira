import {assertNoSensitiveInformation} from "../distill/candidatePolicy.js";
import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {recordRecallEvent,type RecallReceipt} from './recallAuditStore.js';
import {appendDomainEvent} from '../events/domainOutboxStore.js';
import {requireCapability,type CapabilityPolicy,scopesSchema} from '../runtime/capabilities.js';
import {MiraError} from '../runtime/errors.js';

export function persistContextPacket(db:Database.Database,receipt:RecallReceipt,markdown:string,retainForSeconds:number):void {
 recordRecallEvent(db,receipt);
 // Payloads are disposable retention data; receipts and delivery events remain append-only.
 db.prepare('delete from context_payloads where project_id=? and expires_at<=?').run(receipt.projectId,new Date().toISOString());
 if(retainForSeconds>0) db.prepare('insert into context_payloads(recall_id,project_id,markdown,expires_at) values(?,?,?,?)')
  .run(receipt.id,receipt.projectId,markdown,new Date(Date.now()+retainForSeconds*1000).toISOString());
}
function receiptFor(db:Database.Database,projectId:string,recallId:string):RecallReceipt {
 const row=db.prepare('select receipt from recall_events where project_id=? and id=?').get(projectId,recallId) as {receipt:string}|undefined;
 if(!row) throw new MiraError('RECALL_NOT_FOUND','Recall not found in this project','Select a recorded recall from this project');
 return JSON.parse(row.receipt);
}
export function replayContext(db:Database.Database,projectId:string,recallId:string) {
 const receipt=receiptFor(db,projectId,recallId);
 const row=db.prepare('select markdown from context_payloads where project_id=? and recall_id=? and expires_at>?').get(projectId,recallId,new Date().toISOString()) as {markdown:string}|undefined;
 const turn=db.prepare('select before_result from lifecycle_turns where project_id=? and recall_event_id=?').get(projectId,recallId) as {before_result:string}|undefined;
 const markdown=row?.markdown??(turn?.before_result ? JSON.parse(turn.before_result).context?.markdown : undefined);
 if(typeof markdown!=='string') return {recallId,replay:'unavailable' as const,reason:'not_retained_or_expired',outputHash:receipt.outputHash};
 if(createHash('sha256').update(markdown).digest('hex')!==receipt.outputHash) throw new MiraError('CONTEXT_HASH_MISMATCH','Retained content does not match its receipt','Inspect storage integrity before using this content');
 return {recallId,replay:'exact' as const,markdown,outputHash:receipt.outputHash,source:row?'retained_payload':'lifecycle_result'};
}
declare const deliveryBrand:unique symbol;
export type DeliveryAuthority={readonly [deliveryBrand]:true};
const grants=new WeakMap<DeliveryAuthority,CapabilityPolicy & {db:Database.Database;projectId:string}>();
export function authorizeContextDelivery(db:Database.Database,projectId:string,policy:CapabilityPolicy):DeliveryAuthority {
 if(!policy.actor.trim()||policy.actor.length>200||!policy.reason.trim()||policy.reason.length>1000) throw new Error('Delivery authority requires bounded actor and reason');
 assertNoSensitiveInformation(policy.actor+'\n'+policy.reason,'Delivery authority');
 const grant=Object.freeze({}) as DeliveryAuthority;
 grants.set(grant,{...policy,scopes:scopesSchema.parse(policy.scopes),db,projectId});return grant;
}
export function recordContextDelivery(db:Database.Database,projectId:string,recallId:string,outputHash:string,authority?:DeliveryAuthority) {
 const policy=authority&&grants.get(authority);
 if(!policy||policy.db!==db||policy.projectId!==projectId) throw new MiraError('PERMISSION_DENIED','Delivery requires host-granted project authority','Have the host acknowledge the exact output hash');
 requireCapability(policy,'context.delivery');
 const receipt=receiptFor(db,projectId,recallId);
 if(receipt.outputHash!==outputHash) throw new MiraError('CONTEXT_HASH_MISMATCH','Delivery output hash does not match the prepared context','Acknowledge the exact context delivered by the host');
 return db.transaction(()=>{
 const existing=getContextDelivery(db,projectId,recallId);
 if(existing.state==='delivered') return existing;
 appendDomainEvent(db,{projectId,aggregateType:'context',aggregateId:recallId,eventType:'context_delivered',payload:{recallId,outputHash,actor:policy.actor,authorityReason:policy.reason,observation:'host_reported',modelUse:'unknown'}});
 return getContextDelivery(db,projectId,recallId);
 }).immediate();
}
export function getContextDelivery(db:Database.Database,projectId:string,recallId:string) {
 receiptFor(db,projectId,recallId);
 const row=db.prepare("select payload,created_at from domain_events where project_id=? and aggregate_id=? and event_type='context_delivered' order by created_at desc limit 1").get(projectId,recallId) as {payload:string;created_at:string}|undefined;
 return row?{state:'delivered' as const,observedAt:row.created_at,...JSON.parse(row.payload)}:{state:'unknown' as const,modelUse:'unknown'};
}
