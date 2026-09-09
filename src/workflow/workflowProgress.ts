import {createHostAdapterRegistry} from "../lifecycle/hostAdapterRegistry.js";
import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {MiraError} from '../runtime/errors.js';
import {sanitizeDistillError} from '../distill/distillJobStore.js';

type Job={id:string;thread_id:string;input_hash:string;status:string;last_error:string|null;next_attempt_at:string|null};
export function getWorkflowProgress(db:Database.Database,projectId:string,turnId:string) {
 const turn=db.prepare('select id,session_id,status,after_result from lifecycle_turns where project_id=? and id=?').get(projectId,turnId) as {id:string;session_id:string;status:string;after_result:string|null}|undefined;
 if(!turn) throw new MiraError('TURN_NOT_FOUND','Turn not found in this project','Select a turn returned by before_turn or after_turn');
 const capture=db.prepare('select id,thread_id from capture_records where project_id=? and turn_id=?').get(projectId,turnId) as {id:string;thread_id:string|null}|undefined;
 const started=db.prepare("select payload from domain_events where project_id=? and aggregate_id=? and event_type='turn_started' order by created_at,rowid limit 1").get(projectId,turnId) as {payload:string}|undefined;
 const startMetadata=started?JSON.parse(started.payload):undefined;
 const repaired=Boolean(db.prepare("select 1 from domain_events where project_id=? and event_type='capture_repaired' and json_extract(payload,'$.turnId')=?").get(projectId,turnId));
 const hostDescriptor=createHostAdapterRegistry().list().find(item=>item.host===startMetadata?.sourceHost);
 const turnProvenance={identitySource:started?'caller_supplied':'unknown',sourceHost:startMetadata?.sourceHost??'unknown',
  hostNativeGranularity:hostDescriptor?.nativeGranularity??'unknown',capturePath:repaired?'repaired':startMetadata?.captureOnly?'capture_only':turn.status!=='completed'?'awaiting_capture':started?'normal':'unknown',
  observation:'recorded_lifecycle_events',hostCrash:'not_inferred'};
 const after=turn.after_result?JSON.parse(turn.after_result):undefined;
 const messages=(after?.outboxMessageIds??[]).map((id:string)=>db.prepare('select id,topic,status,last_error,available_at from outbox_messages where project_id=? and id=?').get(projectId,id)) as Array<{id:string;topic:string;status:string;last_error:string|null;available_at:string}>;
 const jobs:Job[]=[];
 for(const message of messages.filter(Boolean)) {
  const receipt=db.prepare('select result from outbox_handler_receipts where project_id=? and message_id=?').get(projectId,message.id) as {result:string}|undefined;
  const jobId=receipt?JSON.parse(receipt.result).distillJobId:undefined;
  if(jobId) {
   const job=db.prepare('select id,thread_id,input_hash,status,last_error,next_attempt_at from distill_jobs where project_id=? and id=?').get(projectId,jobId) as Job|undefined;
   if(job&&!jobs.some(existing=>existing.id===job.id)) jobs.push(job);
  }
 }
 const candidates=jobs.flatMap(job=>db.prepare('select id,status,accepted_memory_id,acceptance_mode from memory_candidates where project_id=? and thread_id=? and thread_input_hash=?').all(projectId,job.thread_id,job.input_hash)) as Array<{id:string;status:string;accepted_memory_id:string|null;acceptance_mode:string|null}>;
 const unique=[...new Map(candidates.map(item=>[item.id,item])).values()];
 const errors=[...messages.filter(Boolean),...jobs].filter(item=>item.last_error).map(item=>({id:item.id,message:sanitizeDistillError(item.last_error)}));
 const sourceChanged=jobs.some(job=>{
  const raw=db.prepare('select raw_text from threads where project_id=? and id=?').pluck().get(projectId,job.thread_id);
  return typeof raw!=='string'||createHash('sha256').update(raw).digest('hex')!==job.input_hash;
 });
 const stage=turn.status!=='completed'?'awaiting_capture':!capture?.thread_id?'needs_attention'
  :messages.some(item=>!item)||messages.some(item=>item.status==='failed')||jobs.some(item=>item.status==='failed')?'failed'
  :messages.some(item=>item.status==='running')||jobs.some(item=>item.status==='running')?'running'
  :messages.some(item=>item.status==='pending')||jobs.some(item=>item.status==='pending')?'queued'
  :sourceChanged?'source_changed':unique.some(item=>item.status==='pending_review')?'pending_review'
  :unique.some(item=>item.status==='accepted')?'accepted':jobs.length?'completed_without_acceptance':'captured';
 const nextAction=stage==='queued'?'Run the Outbox and distillation workers; capture is already durable'
  :stage==='pending_review'?'Review source evidence in the candidate queue'
  :stage==='failed'?'Inspect the reported error; retry failed jobs or Outbox messages through their explicit recovery commands'
  :stage==='source_changed'?'Use the latest source version and submit fresh candidates'
  :stage==='needs_attention'?'Retry the same after_turn input to repair the capture'
  :stage==='captured'?'Inspect downstream scheduling; no accepted memory is implied':'No action required';
 return {schemaVersion:1,turnProvenance,projectId,turnId,sessionId:turn.session_id,stage,observedAt:new Date().toISOString(),
  capture:capture?{id:capture.id,threadId:capture.thread_id}:null,
  outbox:messages.filter(Boolean).map(item=>({id:item.id,topic:item.topic,status:item.status,availableAt:item.available_at})),
  jobs:jobs.map(job=>({id:job.id,status:job.status,nextAttemptAt:job.next_attempt_at})),
  candidates:unique.map(item=>({id:item.id,status:item.status,memoryId:item.accepted_memory_id,acceptanceMode:item.acceptance_mode??'unknown'})),errors,nextAction};
}
export function listWorkflowProgress(db:Database.Database,projectId:string,limit=20) {
 if(!Number.isInteger(limit)||limit<1||limit>100) throw new Error('Workflow limit must be between 1 and 100');
 const rows=db.prepare('select id from lifecycle_turns where project_id=? order by started_at desc,rowid desc limit ?').all(projectId,limit) as Array<{id:string}>;
 return rows.map(row=>getWorkflowProgress(db,projectId,row.id));
}
