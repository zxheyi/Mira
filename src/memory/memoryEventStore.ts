import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export const MEMORY_EVENT_TYPES = ["accepted", "updated", "superseded", "archived", "rejected", "restored"] as const;
export type MemoryEventType = (typeof MEMORY_EVENT_TYPES)[number];

export type MemoryEvent = {
  id: string;
  memoryId: string;
  projectId: string;
  eventType: MemoryEventType;
  actor: string;
  reason?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type EventRow = {
  id: string; memory_id: string; project_id: string; event_type: MemoryEventType;
  actor: string; reason: string | null; metadata: string; created_at: string;
};

export function recordMemoryEvent(
  db: Database.Database,
  input: Omit<MemoryEvent, "id" | "createdAt" | "metadata"> & { metadata?: Record<string, unknown> }
): MemoryEvent {
  const actor = input.actor.trim();
  const reason = input.reason?.trim();
  if (!actor || actor.length > 200) throw new Error("Memory event actor must contain 1 to 200 characters");
  if (reason && reason.length > 1_000) throw new Error("Memory event reason must be at most 1000 characters");
  const event: MemoryEvent = {
    id: `memory_event_${randomUUID()}`,
    memoryId: input.memoryId,
    projectId: input.projectId,
    eventType: input.eventType,
    actor,
    reason: reason || undefined,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString()
  };
  db.prepare(
    `insert into memory_events (id, memory_id, project_id, event_type, actor, reason, metadata, created_at)
     values (@id, @memoryId, @projectId, @eventType, @actor, @reason, @metadata, @createdAt)`
  ).run({ ...event, reason: event.reason ?? null, metadata: JSON.stringify(event.metadata) });
  return event;
}

export function listMemoryEvents(db: Database.Database, projectId: string, memoryId: string): MemoryEvent[] {
  return db.prepare(
    "select * from memory_events where project_id = ? and memory_id = ? order by created_at asc, rowid asc"
  ).all(projectId, memoryId).map((raw) => {
    const row = raw as EventRow;
    return {
      id: row.id, memoryId: row.memory_id, projectId: row.project_id, eventType: row.event_type,
      actor: row.actor, reason: row.reason ?? undefined,
      metadata: JSON.parse(row.metadata) as Record<string, unknown>, createdAt: row.created_at
    };
  });
}
