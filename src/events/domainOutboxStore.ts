import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export const OUTBOX_TOPICS = [
  "capture.distill.requested",
  "research.evidence.verify.requested",
  "projection.refresh.requested"
] as const;
export type OutboxTopic = (typeof OUTBOX_TOPICS)[number];
export type OutboxStatus = "pending" | "running" | "completed" | "failed";

export type DomainEvent = {
  id: string;
  projectId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type OutboxMessage = {
  id: string;
  projectId: string;
  eventId: string;
  topic: OutboxTopic;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  leaseExpiresAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

type EventRow = {id:string;project_id:string;aggregate_type:string;aggregate_id:string;event_type:string;payload:string;created_at:string};
type MessageRow = {id:string;project_id:string;event_id:string;topic:OutboxTopic;payload:string;status:OutboxStatus;attempts:number;max_attempts:number;available_at:string;lease_expires_at:string|null;last_error:string|null;created_at:string;updated_at:string};

const toEvent = (row: EventRow): DomainEvent => ({
  id: row.id, projectId: row.project_id, aggregateType: row.aggregate_type,
  aggregateId: row.aggregate_id, eventType: row.event_type,
  payload: JSON.parse(row.payload) as Record<string, unknown>, createdAt: row.created_at
});

const toMessage = (row: MessageRow): OutboxMessage => ({
  id: row.id, projectId: row.project_id, eventId: row.event_id, topic: row.topic,
  payload: JSON.parse(row.payload) as Record<string, unknown>, status: row.status,
  attempts: row.attempts, maxAttempts: row.max_attempts, availableAt: row.available_at,
  ...(row.lease_expires_at ? {leaseExpiresAt: row.lease_expires_at} : {}),
  ...(row.last_error ? {lastError: row.last_error} : {}),
  createdAt: row.created_at, updatedAt: row.updated_at
});

export function appendDomainEvent(db: Database.Database, input: Omit<DomainEvent, "id" | "createdAt"> & {id?: string; createdAt?: string}): DomainEvent {
  const event: DomainEvent = {...input, id: input.id ?? `domain_event_${randomUUID()}`, createdAt: input.createdAt ?? new Date().toISOString()};
  db.prepare(`insert into domain_events (id, project_id, aggregate_type, aggregate_id, event_type, payload, created_at)
    values (?, ?, ?, ?, ?, ?, ?)`)
    .run(event.id, event.projectId, event.aggregateType, event.aggregateId, event.eventType, JSON.stringify(event.payload), event.createdAt);
  return event;
}

export function enqueueOutboxMessage(db: Database.Database, input: {
  projectId: string; eventId: string; topic: OutboxTopic; payload: Record<string, unknown>;
  id?: string; maxAttempts?: number; availableAt?: string; createdAt?: string;
}): OutboxMessage {
  const now = input.createdAt ?? new Date().toISOString();
  const message: OutboxMessage = {
    id: input.id ?? `outbox_${randomUUID()}`, projectId: input.projectId, eventId: input.eventId,
    topic: input.topic, payload: input.payload, status: "pending", attempts: 0,
    maxAttempts: input.maxAttempts ?? 3, availableAt: input.availableAt ?? now,
    createdAt: now, updatedAt: now
  };
  db.prepare(`insert into outbox_messages (
    id, project_id, event_id, topic, payload, status, attempts, max_attempts,
    available_at, lease_expires_at, last_error, created_at, updated_at
  ) values (?, ?, ?, ?, ?, 'pending', 0, ?, ?, null, null, ?, ?)`)
    .run(message.id, message.projectId, message.eventId, message.topic, JSON.stringify(message.payload),
      message.maxAttempts, message.availableAt, message.createdAt, message.updatedAt);
  return message;
}

export function enqueueProjectionRefresh(db: Database.Database, input: {
  projectId:string;eventId:string;reason:string;aggregateId:string;createdAt?:string;
}): OutboxMessage {
  const now = input.createdAt ?? new Date().toISOString();
  db.prepare(`update project_briefings
    set stale_at = coalesce(stale_at, ?)
    where project_id = ? and status = 'complete' and stale_at is null`)
    .run(now, input.projectId);
  return enqueueOutboxMessage(db, {
    projectId:input.projectId,eventId:input.eventId,topic:"projection.refresh.requested",
    payload:{reason:input.reason,aggregateId:input.aggregateId},createdAt:now
  });
}

export function requestProjectionRefresh(db: Database.Database, input: {
  projectId:string;aggregateType:string;aggregateId:string;reason:string;createdAt?:string;
}): OutboxMessage {
  const now = input.createdAt ?? new Date().toISOString();
  const event = appendDomainEvent(db, {
    projectId:input.projectId,aggregateType:input.aggregateType,aggregateId:input.aggregateId,
    eventType:"projection_refresh_requested",payload:{reason:input.reason},createdAt:now
  });
  return enqueueProjectionRefresh(db, {
    projectId:input.projectId,eventId:event.id,reason:input.reason,
    aggregateId:input.aggregateId,createdAt:now
  });
}

export function listDomainEvents(db: Database.Database, projectId: string, limit = 100): DomainEvent[] {
  return db.prepare("select * from domain_events where project_id = ? order by created_at desc, rowid desc limit ?")
    .all(projectId, limit).map(row => toEvent(row as EventRow));
}

export function listOutboxMessages(db: Database.Database, projectId: string, status?: OutboxStatus, limit = 100): OutboxMessage[] {
  const rows = status
    ? db.prepare("select * from outbox_messages where project_id = ? and status = ? order by created_at desc, rowid desc limit ?").all(projectId, status, limit)
    : db.prepare("select * from outbox_messages where project_id = ? order by created_at desc, rowid desc limit ?").all(projectId, limit);
  return rows.map(row => toMessage(row as MessageRow));
}
