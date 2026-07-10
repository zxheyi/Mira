import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export const WORKING_MEMORY_KINDS = [
  "current_task",
  "current_phase",
  "recent_decision",
  "blocker",
  "next_step",
  "preference",
  "decision",
  "note"
] as const;

export type WorkingMemoryKind = (typeof WORKING_MEMORY_KINDS)[number];

export type WorkingMemory = {
  id: string;
  projectId: string;
  kind: WorkingMemoryKind;
  content: string;
  updatedAt: string;
};

export type SetWorkingMemoryInput = {
  projectId: string;
  kind: WorkingMemoryKind;
  content: string;
};

type WorkingMemoryRow = {
  id: string;
  project_id: string;
  kind: WorkingMemoryKind;
  content: string;
  updated_at: string;
};

function toWorkingMemory(row: WorkingMemoryRow): WorkingMemory {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    content: row.content,
    updatedAt: row.updated_at
  };
}

export function setWorkingMemory(
  db: Database.Database,
  input: SetWorkingMemoryInput
): WorkingMemory {
  const existing = db
    .prepare(
      `select id, project_id, kind, content, updated_at
       from working_memory
       where project_id = ? and kind = ?`
    )
    .get(input.projectId, input.kind) as WorkingMemoryRow | undefined;
  const id = existing?.id ?? `working_${randomUUID()}`;
  const updatedAt = new Date().toISOString();

  db.prepare(
    `insert into working_memory (id, project_id, kind, content, updated_at)
     values (@id, @projectId, @kind, @content, @updatedAt)
     on conflict(project_id, kind) do update set
       content = excluded.content,
       updated_at = excluded.updated_at`
  ).run({ id, ...input, updatedAt });

  return {
    id,
    projectId: input.projectId,
    kind: input.kind,
    content: input.content,
    updatedAt
  };
}

export function listWorkingMemory(db: Database.Database, projectId: string): WorkingMemory[] {
  return db
    .prepare(
      `select id, project_id, kind, content, updated_at
       from working_memory
       where project_id = ?
       order by rowid asc`
    )
    .all(projectId)
    .map((row) => toWorkingMemory(row as WorkingMemoryRow));
}

export function clearWorkingMemory(
  db: Database.Database,
  projectId: string,
  kind?: WorkingMemoryKind
): void {
  if (kind) {
    db.prepare("delete from working_memory where project_id = ? and kind = ?").run(projectId, kind);
    return;
  }

  db.prepare("delete from working_memory where project_id = ?").run(projectId);
}
