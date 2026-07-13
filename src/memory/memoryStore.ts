import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";

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
    createdAt: row.created_at
  };
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function quoteFtsTerm(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

function toFtsQuery(query: string, mode: SearchMemoriesOptions["queryMode"] = "phrase"): string {
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
  contentHash: string
): Memory | undefined {
  const row = threadId
    ? db
        .prepare(
          `select id, project_id, thread_id, title, kind, content, source, confidence, content_hash, importance, created_at
           from memories
           where project_id = ? and thread_id = ? and kind = ? and content_hash = ?`
        )
        .get(projectId, threadId, kind, contentHash)
    : db
        .prepare(
          `select id, project_id, thread_id, title, kind, content, source, confidence, content_hash, importance, created_at
           from memories
           where project_id = ? and thread_id is null and kind = ? and content_hash = ?`
        )
        .get(projectId, kind, contentHash);

  return row ? toMemory(row as MemoryRow) : undefined;
}

export function addMemory(db: Database.Database, input: AddMemoryInput): Memory {
  const contentHash = hashContent(input.content);
  const existing = findDuplicateMemory(db, input.projectId, input.threadId, input.kind, contentHash);

  if (existing) {
    return existing;
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
    createdAt: new Date().toISOString()
  };

  try {
    const duplicate = db.transaction(() => {
      const result = db.prepare(
        `insert or ignore into memories (
          id, project_id, thread_id, title, kind, content, source, confidence, content_hash, importance, created_at
        ) values (
          @id, @projectId, @threadId, @title, @kind, @content, @source, @confidence, @contentHash, @importance, @createdAt
        )`
      ).run({ ...memory, threadId: memory.threadId ?? null });

      if (result.changes === 0) {
        return findDuplicateMemory(db, input.projectId, input.threadId, input.kind, contentHash);
      }

      return undefined;
    })();

    if (duplicate) {
      return duplicate;
    }
  } catch (error) {
    const duplicate = findDuplicateMemory(db, input.projectId, input.threadId, input.kind, contentHash);
    if (duplicate) {
      return duplicate;
    }
    throw error;
  }

  return memory;
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
      `select id, project_id, thread_id, title, kind, content, source, confidence, content_hash, importance, created_at
       from memories
       where project_id = ?
       order by created_at asc, rowid asc`
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
      `select id, project_id, thread_id, title, kind, content, source, confidence, content_hash, importance, created_at
       from memories
       where project_id = ?
       order by importance desc, confidence desc, created_at desc, rowid desc
       limit ?`
    )
    .all(projectId, limit)
    .map((row) => toMemory(row as MemoryRow));
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
         0 - bm25(memory_fts) as score
       from memory_fts
       join memories on memories.id = memory_fts.id
       where memory_fts match ? and memories.project_id = ?
       ${kindClause}
       order by memories.importance desc, memories.confidence desc, score desc, memories.created_at desc
       limit ?`
    )
    .all(...params)
    .map((row) => ({ memory: toMemory(row as SearchRow), score: (row as SearchRow).score }));
}
