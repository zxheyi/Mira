import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { recordMemoryEvent, type MemoryEventType } from "./memoryEventStore.js";

export const MEMORY_KINDS = [
  "decision",
  "convention",
  "architecture",
  "preference",
  "task",
  "fact",
  "failed_attempt",
  "lesson",
  "constraint",
  "todo",
  "note"
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];
export const MEMORY_STATUSES = ["active", "superseded", "archived", "rejected"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export type Memory = {
  id: string;
  projectId: string;
  threadId?: string;
  title: string;
  kind: MemoryKind;
  content: string;
  source: string;
  confidence: number;
  contentHash: string;
  importance: number;
  createdAt: string;
  status: MemoryStatus;
  supersedesMemoryId?: string;
  updatedAt: string;
};

export type AddMemoryInput = {
  projectId: string;
  threadId?: string;
  title: string;
  kind: MemoryKind;
  content: string;
  source: string;
  confidence: number;
  importance: number;
  actor?: string;
};

type MemoryWriteInput = AddMemoryInput & {
  supersedesMemoryId?: string;
  event?: { eventType: MemoryEventType; actor: string; reason?: string; metadata?: Record<string, unknown> };
};

export type SearchResult = {
  memory: Memory;
  score: number;
};

export type SearchMemoriesOptions = {
  kind?: MemoryKind;
  limit?: number;
  queryMode?: "phrase" | "orTerms";
};

type MemoryRow = {
  id: string;
  project_id: string;
  thread_id: string | null;
  title: string;
  kind: MemoryKind;
  content: string;
  source: string;
  confidence: number;
  content_hash: string;
  importance: number;
  created_at: string;
  status: MemoryStatus;
  supersedes_memory_id: string | null;
  updated_at: string;
};

type SearchRow = MemoryRow & {
  score: number;
};

function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    projectId: row.project_id,
    threadId: row.thread_id ?? undefined,
    title: row.title,
    kind: row.kind,
    content: row.content,
    source: row.source,
    confidence: row.confidence,
    contentHash: row.content_hash,
    importance: row.importance,
    createdAt: row.created_at,
    status: row.status,
    supersedesMemoryId: row.supersedes_memory_id ?? undefined,
    updatedAt: row.updated_at
  };
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function quoteFtsTerm(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

function toFtsQuery(query: string, mode: SearchMemoriesOptions["queryMode"] = "orTerms"): string {
  if (mode === "orTerms") {
    const terms = query.split(/\s+/).map((term) => term.trim()).filter(Boolean);
    if (terms.length === 0) {
      return quoteFtsTerm(query);
    }
    return terms.map(quoteFtsTerm).join(" OR ");
  }

  return quoteFtsTerm(query);
}

function findDuplicateMemory(
  db: Database.Database,
  projectId: string,
  threadId: string | undefined,
  kind: MemoryKind,
  contentHash: string,
  scope: "active" | "restorable" | "any" = "active"
): Memory | undefined {
  const statusClause = scope === "active"
    ? "status = 'active'"
    : scope === "restorable"
      ? "status in ('active', 'archived')"
      : "status in ('active', 'archived', 'superseded', 'rejected')";
  const row = threadId
    ? db
        .prepare(
          `select id, project_id, thread_id, title, kind, content, source, confidence, content_hash, importance, created_at, status, supersedes_memory_id, updated_at
           from memories
           where project_id = ? and thread_id = ? and kind = ? and content_hash = ? and ${statusClause}
           order by case status when 'active' then 0 when 'archived' then 1 else 2 end, created_at desc limit 1`
        )
        .get(projectId, threadId, kind, contentHash)
    : db
        .prepare(
          `select id, project_id, thread_id, title, kind, content, source, confidence, content_hash, importance, created_at, status, supersedes_memory_id, updated_at
           from memories
           where project_id = ? and thread_id is null and kind = ? and content_hash = ? and ${statusClause}
           order by case status when 'active' then 0 when 'archived' then 1 else 2 end, created_at desc limit 1`
        )
        .get(projectId, kind, contentHash);

  return row ? toMemory(row as MemoryRow) : undefined;
}

function resolveDuplicateMemory(
  db: Database.Database,
  input: MemoryWriteInput,
  existing: Memory
): Memory {
  if (existing.status === "active") {
    return existing;
  }

  if (existing.status !== "archived" || input.supersedesMemoryId) {
    throw new Error(`Memory content already exists with status ${existing.status}: ${existing.id}`);
  }

  return db.transaction(() => {
    const activeSuccessor = db.prepare(
      "select id from memories where project_id = ? and supersedes_memory_id = ? and status = 'active'"
    ).get(input.projectId, existing.id);
    if (activeSuccessor) {
      throw new Error(`Archived Memory has an active successor and cannot be restored: ${existing.id}`);
    }

    const now = new Date().toISOString();
    const changed = db.prepare(
      "update memories set status = 'active', updated_at = ? where project_id = ? and id = ? and status = 'archived'"
    ).run(now, input.projectId, existing.id);
    if (changed.changes !== 1) {
      const current = findDuplicateMemory(db, input.projectId, input.threadId, input.kind, existing.contentHash);
      if (current?.status === "active") return current;
      throw new Error(`Memory changed concurrently: ${existing.id}`);
    }

    recordMemoryEvent(db, {
      memoryId: existing.id,
      projectId: input.projectId,
      eventType: "restored",
      actor: input.event?.actor ?? input.actor ?? input.source,
      reason: input.event?.reason ?? "Re-added archived Memory"
    });

    const restored = findDuplicateMemory(db, input.projectId, input.threadId, input.kind, existing.contentHash);
    if (!restored || restored.status !== "active") {
      throw new Error(`Failed to restore archived Memory: ${existing.id}`);
    }
    return restored;
  })();
}

function insertMemory(
  db: Database.Database,
  input: MemoryWriteInput,
  duplicateScope: "active" | "restorable" | "any"
): Memory {
  const contentHash = hashContent(input.content);
  const existing = findDuplicateMemory(db, input.projectId, input.threadId, input.kind, contentHash, duplicateScope);

  if (existing) {
    return resolveDuplicateMemory(db, input, existing);
  }

  const memory: Memory = {
    id: `memory_${randomUUID()}`,
    projectId: input.projectId,
    threadId: input.threadId,
    title: input.title,
    kind: input.kind,
    content: input.content,
    source: input.source,
    confidence: input.confidence,
    contentHash,
    importance: input.importance,
    createdAt: new Date().toISOString(),
    status: "active",
    supersedesMemoryId: input.supersedesMemoryId,
    updatedAt: ""
  };
  memory.updatedAt = memory.createdAt;

  try {
    const duplicate = db.transaction(() => {
      const result = db.prepare(
        `insert or ignore into memories (
          id, project_id, thread_id, title, kind, content, source, confidence, content_hash, importance,
          created_at, status, supersedes_memory_id, updated_at
        ) values (
          @id, @projectId, @threadId, @title, @kind, @content, @source, @confidence, @contentHash, @importance,
          @createdAt, @status, @supersedesMemoryId, @updatedAt
        )`
      ).run({ ...memory, threadId: memory.threadId ?? null, supersedesMemoryId: memory.supersedesMemoryId ?? null });

      if (result.changes === 0) {
        const duplicate = findDuplicateMemory(db, input.projectId, input.threadId, input.kind, contentHash);
        if (!duplicate) throw new Error("Database constraint rejected Memory insert");
        return duplicate;
      }

      recordMemoryEvent(db, {
        memoryId: memory.id,
        projectId: memory.projectId,
        eventType: input.event?.eventType ?? "accepted",
        actor: input.event?.actor ?? input.actor ?? input.source,
        reason: input.event?.reason,
        metadata: input.event?.metadata
      });

      return undefined;
    })();

    if (duplicate) {
      return resolveDuplicateMemory(db, input, duplicate);
    }
  } catch (error) {
    const duplicate = findDuplicateMemory(db, input.projectId, input.threadId, input.kind, contentHash);
    if (duplicate) {
      return resolveDuplicateMemory(db, input, duplicate);
    }
    throw error;
  }

  return memory;
}

export function addMemory(db: Database.Database, input: AddMemoryInput): Memory {
  return insertMemory(db, input, "any");
}

export type UpdateMemoryInput = {
  projectId: string; memoryId: string; content: string; title?: string; kind?: MemoryKind;
  confidence?: number; importance?: number; source?: string; actor: string; reason?: string;
};

function requireMemoryById(db: Database.Database, projectId: string, memoryId: string): Memory {
  const row = db.prepare(
    `select id, project_id, thread_id, title, kind, content, source, confidence, content_hash,
            importance, created_at, status, supersedes_memory_id, updated_at
     from memories where project_id = ? and id = ?`
  ).get(projectId, memoryId) as MemoryRow | undefined;
  if (!row) throw new Error(`Memory not found: ${memoryId}`);
  return toMemory(row);
}

export function updateMemory(db: Database.Database, input: UpdateMemoryInput): Memory {
  return db.transaction(() => {
    const predecessor = requireMemoryById(db, input.projectId, input.memoryId);
    if (predecessor.status !== "active") throw new Error(`Only active Memory can be updated: ${input.memoryId}`);
    const content = input.content.trim();
    if (!content) throw new Error("Updated Memory content is required");
    if (content === predecessor.content) throw new Error("Updated Memory content must be different from its predecessor");
    const successor = insertMemory(db, {
      projectId: predecessor.projectId,
      threadId: predecessor.threadId,
      title: input.title?.trim() || predecessor.title,
      kind: input.kind ?? predecessor.kind,
      content,
      source: input.source?.trim() || predecessor.source,
      confidence: input.confidence ?? predecessor.confidence,
      importance: input.importance ?? predecessor.importance,
      supersedesMemoryId: predecessor.id,
      event: {
        eventType: "updated", actor: input.actor, reason: input.reason,
        metadata: { predecessorId: predecessor.id }
      }
    }, "active");
    if (successor.id === predecessor.id || successor.supersedesMemoryId !== predecessor.id) {
      throw new Error(`Memory successor conflicts with an existing record: ${input.memoryId}`);
    }
    const now = new Date().toISOString();
    const changed = db.prepare(
      "update memories set status = 'superseded', updated_at = ? where project_id = ? and id = ? and status = 'active'"
    ).run(now, input.projectId, predecessor.id);
    if (changed.changes !== 1) throw new Error(`Memory changed concurrently: ${predecessor.id}`);
    recordMemoryEvent(db, {
      memoryId: predecessor.id, projectId: predecessor.projectId, eventType: "superseded",
      actor: input.actor, reason: input.reason, metadata: { successorId: successor.id }
    });
    return successor;
  })();
}

export function clearMemoriesForThread(
  db: Database.Database,
  projectId: string,
  threadId: string
): void {
  db.prepare("delete from memories where project_id = ? and thread_id = ?").run(projectId, threadId);
}

export function deleteMemoriesForProject(db: Database.Database, projectId: string): void {
  db.prepare("delete from memories where project_id = ?").run(projectId);
}

export function listMemoriesForProject(db: Database.Database, projectId: string): Memory[] {
  return db
    .prepare(
      `select id, project_id, thread_id, title, kind, content, source, confidence, content_hash, importance, created_at, status, supersedes_memory_id, updated_at
       from memories
       where project_id = ? and status = 'active'
       order by created_at asc, rowid asc`
    )
    .all(projectId)
    .map((row) => toMemory(row as MemoryRow));
}

export function listAllMemoriesForProject(db: Database.Database, projectId: string): Memory[] {
  return db
    .prepare(
      `select id, project_id, thread_id, title, kind, content, source, confidence, content_hash, importance, created_at, status, supersedes_memory_id, updated_at
       from memories
       where project_id = ?
       order by id asc`
    )
    .all(projectId)
    .map((row) => toMemory(row as MemoryRow));
}

export function listTopMemoriesForProject(
  db: Database.Database,
  projectId: string,
  limit: number
): Memory[] {
  return db
    .prepare(
      `select id, project_id, thread_id, title, kind, content, source, confidence, content_hash, importance, created_at, status, supersedes_memory_id, updated_at
       from memories
       where project_id = ? and status = 'active'
       order by importance desc, confidence desc, created_at desc, rowid desc
       limit ?`
    )
    .all(projectId, limit)
    .map((row) => toMemory(row as MemoryRow));
}

export function listTopMemoriesForProjectByKinds(
  db: Database.Database,
  projectId: string,
  kinds: readonly MemoryKind[],
  limit: number
): Memory[] {
  if (kinds.length === 0) return [];
  const placeholders = kinds.map(() => "?").join(", ");
  return db.prepare(
    `select id, project_id, thread_id, title, kind, content, source, confidence, content_hash, importance,
            created_at, status, supersedes_memory_id, updated_at
     from memories
     where project_id = ? and status = 'active' and kind in (${placeholders})
     order by importance desc, confidence desc, created_at desc, rowid desc
     limit ?`
  ).all(projectId, ...kinds, limit).map((row) => toMemory(row as MemoryRow));
}

export function searchMemories(
  db: Database.Database,
  projectId: string,
  query: string,
  options: SearchMemoriesOptions = {}
): SearchResult[] {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [];
  }

  const kindClause = options.kind ? "and memories.kind = ?" : "";
  const limit = options.limit ?? 50;
  const params = options.kind
    ? [toFtsQuery(trimmedQuery, options.queryMode), projectId, options.kind, limit]
    : [toFtsQuery(trimmedQuery, options.queryMode), projectId, limit];

  return db
    .prepare(
      `select
         memories.id,
         memories.project_id,
         memories.thread_id,
         memories.title,
         memories.kind,
         memories.content,
         memories.source,
         memories.confidence,
         memories.content_hash,
         memories.importance,
         memories.created_at,
         memories.status,
         memories.supersedes_memory_id,
         memories.updated_at,
         0 - bm25(memory_fts) as score
       from memory_fts
       join memories on memories.id = memory_fts.id
       where memory_fts match ? and memories.project_id = ? and memories.status = 'active'
       ${kindClause}
       order by memories.importance desc, memories.confidence desc, score desc, memories.created_at desc
       limit ?`
    )
    .all(...params)
    .map((row) => ({ memory: toMemory(row as SearchRow), score: (row as SearchRow).score }));
}
