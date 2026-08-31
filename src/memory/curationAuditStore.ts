import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export type CurationEvent = {
  id: string;
  projectId: string;
  operation: string;
  actor: string;
  authorityReason: string;
  reason?: string;
  memoryId?: string;
  candidateId?: string;
  outcome: string;
  createdAt: string;
};

export function recordCurationEvent(db: Database.Database, input: Omit<CurationEvent, "id" | "createdAt">): void {
  const event: CurationEvent = {...input, id: `curation_${randomUUID()}`, createdAt: new Date().toISOString()};
  db.prepare("insert into curation_events (id, project_id, memory_id, candidate_id, receipt, created_at) values (?, ?, ?, ?, ?, ?)")
    .run(event.id, event.projectId, event.memoryId ?? null, event.candidateId ?? null, JSON.stringify(event), event.createdAt);
}

export function listCurationEvents(db: Database.Database, projectId: string, limit = 50): CurationEvent[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Curation audit limit must be between 1 and 100");
  return db.prepare("select receipt from curation_events where project_id = ? order by created_at desc, rowid desc limit ?")
    .all(projectId, limit).map(row => JSON.parse((row as {receipt: string}).receipt) as CurationEvent);
}
