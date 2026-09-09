import {z} from 'zod';
import {assertNoSensitiveInformation} from '../distill/candidatePolicy.js';
import {MiraError} from '../runtime/errors.js';
const id=z.string().regex(/^[A-Za-z0-9_.:-]{1,500}$/);
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const reason=z.string().trim().min(1).max(1000);
const host=z.enum(['codex','claude-code','cursor','cli','mcp','ui']);
const transport=z.enum(['native','cli','mcp','ui']);
const verified=z.object({caseId:id,verificationId:id,snapshotId:id.nullable(),status:z.enum(['verified','failed']),checkCodes:z.array(z.string().max(100)).max(20)}).strict();
const domainSchemas:Record<string,z.ZodType>={
 turn_started:z.object({sourceHost:host,transport,sessionId:id,recallEventId:id.optional(),captureOnly:z.boolean().optional()}).strict(),
 turn_completed:z.object({sourceHost:host,transport,sessionId:id,captureRecordId:id,threadId:id.optional(),outcomeStatus:z.enum(['succeeded','failed','cancelled'])}).strict(),
 capture_repaired:z.object({turnId:id,threadId:id}).strict(),
 context_delivered:z.object({recallId:id,outputHash:hash,actor:z.string().min(1).max(200),authorityReason:reason,observation:z.literal('host_reported'),modelUse:z.literal('unknown')}).strict(),
 projection_refresh_requested:z.object({reason}).strict(),
 source_snapshot_registered:z.object({sourceUriHash:hash,contentHash:hash}).strict(),
 evidence_verification_requested:z.object({caseId:id,snapshotId:id.optional()}).strict(),
 evidence_verified:verified,
 evidence_verification_failed:verified,
 research_context_prepared:z.object({recallId:id,caseId:id,outputHash:hash,manifestHash:hash.optional()}).strict()
};
const outboxSchemas:Record<string,z.ZodType>={
 'capture.distill.requested':z.object({captureRecordId:id,threadId:id.optional()}).strict(),
 'research.evidence.verify.requested':z.object({caseId:id,evidenceId:id,snapshotId:id.optional()}).strict(),
 'projection.refresh.requested':z.object({reason,aggregateId:id.optional(),turnId:id.optional()}).strict()
};
export const EVENT_PAYLOAD_MAX_BYTES=16_384;
function validate(schemas:Record<string,z.ZodType>,type:string,payload:unknown):Record<string,unknown> {
 const encoded=JSON.stringify(payload);
 if(!encoded || Buffer.byteLength(encoded,'utf8')>EVENT_PAYLOAD_MAX_BYTES) throw new MiraError('INVALID_EVENT_PAYLOAD','Event payload exceeds its byte limit','Use references instead of source bodies');
 const schema=Object.hasOwn(schemas,type)?schemas[type]:undefined;
 if(!schema) throw new MiraError('INVALID_EVENT_TYPE','Unknown event type or topic','Register a strict event contract before producing it');
 assertNoSensitiveInformation(encoded,'Event payload');
 const parsed=schema.safeParse(payload);
 if(!parsed.success) throw new MiraError('INVALID_EVENT_PAYLOAD','Event payload does not match its registered contract','Use only registered reference and audit fields');
 return parsed.data as Record<string,unknown>;
}
export const validateDomainPayload=(type:string,payload:unknown)=>validate(domainSchemas,type,payload);
export const validateOutboxPayload=(topic:string,payload:unknown)=>validate(outboxSchemas,topic,payload);
/** Completed payload lifetime, measured from completion; events and message identities remain. */
export const OUTBOX_RETENTION_DAYS:Record<string,number>={'capture.distill.requested':7,'research.evidence.verify.requested':7,'projection.refresh.requested':1};

export function validateEventEnvelope(value:unknown):void {
 const schema=z.object({id,projectId:id,aggregateType:z.string().regex(/^[a-z_]{1,80}$/),aggregateId:id,eventType:z.string().max(100),payload:z.record(z.string(),z.unknown()),createdAt:z.iso.datetime()}).strict();
 if(!schema.safeParse(value).success) throw new MiraError('INVALID_EVENT_ENVELOPE','Invalid event metadata','Use bounded identifiers and an ISO timestamp');
}

export function validateOutboxEnvelope(value:unknown):void {
 const timestamp=z.iso.datetime({precision:3});
 const schema=z.object({id,projectId:id,eventId:id,topic:z.enum(['capture.distill.requested','research.evidence.verify.requested','projection.refresh.requested']),
  payload:z.record(z.string(),z.unknown()),status:z.literal('pending'),attempts:z.literal(0),maxAttempts:z.number().int().min(1).max(100),
  availableAt:timestamp,createdAt:timestamp,updatedAt:timestamp}).strict();
 if(!schema.safeParse(value).success) throw new MiraError('INVALID_OUTBOX_ENVELOPE','Invalid Outbox metadata','Use bounded identifiers and canonical UTC timestamps with milliseconds');
}
