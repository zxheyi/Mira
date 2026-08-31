import type Database from "better-sqlite3";
import { type Memory, type MemoryKind, updateMemory, type UpdateMemoryInput } from "./memoryStore.js";
import { listMemoryEvents, recordMemoryEvent, type MemoryEvent } from "./memoryEventStore.js";

type MemoryRow = {
  id: string; project_id: string; thread_id: string | null; title: string; kind: MemoryKind;
  content: string; source: string; confidence: number; content_hash: string; importance: number;
  created_at: string; status: Memory["status"]; supersedes_memory_id: string | null; updated_at: string;
};

function fromRow(row: MemoryRow): Memory {
  return {
    id: row.id, projectId: row.project_id, threadId: row.thread_id ?? undefined,
    title: row.title, kind: row.kind, content: row.content, source: row.source,
    confidence: row.confidence, contentHash: row.content_hash, importance: row.importance,
    createdAt: row.created_at, status: row.status,
    supersedesMemoryId: row.supersedes_memory_id ?? undefined, updatedAt: row.updated_at
  };
}

export function getMemory(db: Database.Database, projectId: string, memoryId: string): Memory | undefined {
  const row = db.prepare("select * from memories where project_id = ? and id = ?").get(projectId, memoryId);
  return row ? fromRow(row as MemoryRow) : undefined;
}

export { listMemoryEvents };

export { updateMemory };
export type { UpdateMemoryInput };

function requireMemory(db: Database.Database, projectId: string, memoryId: string): Memory {
  const memory = getMemory(db, projectId, memoryId);
  if (!memory) throw new Error(`Memory not found: ${memoryId}`);
  return memory;
}

export function archiveMemory(
  db: Database.Database, projectId: string, memoryId: string, actor: string, reason?: string
): Memory {
  return db.transaction(() => {
    const memory = requireMemory(db, projectId, memoryId);
    if (memory.status !== "active") throw new Error(`Only active Memory can be archived: ${memoryId}`);
    const now = new Date().toISOString();
    const changed = db.prepare(
      "update memories set status = 'archived', updated_at = ? where project_id = ? and id = ? and status = 'active'"
    ).run(now, projectId, memory.id);
    if (changed.changes !== 1) throw new Error(`Memory changed concurrently: ${memory.id}`);
    recordMemoryEvent(db, { memoryId, projectId, eventType: "archived", actor, reason });
    return requireMemory(db, projectId, memoryId);
  })();
}

export function restoreMemory(
  db: Database.Database, projectId: string, memoryId: string, actor: string, reason?: string
): Memory {
  return db.transaction(() => {
    const memory = requireMemory(db, projectId, memoryId);
    if (memory.status === "superseded") throw new Error(`superseded Memory cannot be restored: ${memoryId}`);
    if (memory.status !== "archived") throw new Error(`Only archived Memory can be restored: ${memoryId}`);
    const successor = db.prepare(
      "select id from memories where project_id = ? and supersedes_memory_id = ? and status = 'active'"
    ).get(projectId, memoryId);
    if (successor) throw new Error(`Archived Memory has an active successor and cannot be restored: ${memoryId}`);
    const changed = db.prepare(
      "update memories set status = 'active', updated_at = ? where project_id = ? and id = ? and status = 'archived'"
    ).run(new Date().toISOString(), projectId, memoryId);
    if (changed.changes !== 1) throw new Error(`Memory changed concurrently: ${memory.id}`);
    recordMemoryEvent(db, { memoryId, projectId, eventType: "restored", actor, reason });
    return requireMemory(db, projectId, memoryId);
  })();
}

export type MemoryHistory = { memories: Memory[]; events: MemoryEvent[] };

export function getMemoryHistory(db: Database.Database, projectId: string, memoryId: string): MemoryHistory {
  let current = requireMemory(db, projectId, memoryId);
  const seen = new Set<string>();
  while (current.supersedesMemoryId) {
    if (seen.has(current.id)) throw new Error(`Memory history cycle detected: ${memoryId}`);
    seen.add(current.id);
    current = requireMemory(db, projectId, current.supersedesMemoryId);
  }
  const memories: Memory[] = [current];
  while (true) {
    const row = db.prepare(
      "select id from memories where project_id = ? and supersedes_memory_id = ? order by created_at asc limit 1"
    ).get(projectId, current.id) as { id: string } | undefined;
    if (!row) break;
    current = requireMemory(db, projectId, row.id);
    memories.push(current);
  }
  const events = memories.flatMap((memory) => listMemoryEvents(db, projectId, memory.id))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return { memories, events };
}
