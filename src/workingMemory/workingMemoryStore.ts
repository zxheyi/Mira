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
  taskId?: string;
};

export type SetWorkingMemoryInput = {
  projectId: string;
  kind: WorkingMemoryKind;
  content: string;
  taskId?: string;
};

type WorkingMemoryRow = {
  id: string;
  project_id: string;
  kind: WorkingMemoryKind;
  content: string;
  updated_at: string;
  task_id?: string;
};

function toWorkingMemory(row: WorkingMemoryRow): WorkingMemory {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    content: row.content,
    updatedAt: row.updated_at,
    ...(row.task_id ? { taskId: row.task_id } : {})
  };
}

export function setWorkingMemory(
  db: Database.Database,
  input: SetWorkingMemoryInput
): WorkingMemory {
  const updatedAt = new Date().toISOString();
  const taskId = normalizeTaskId(input.taskId);
  if (taskId) {
    const row = db.prepare(`insert into task_working_memory (id, project_id, task_id, kind, content, updated_at)
      values (@id, @projectId, @taskId, @kind, @content, @updatedAt)
      on conflict(project_id, task_id, kind) do update set content = excluded.content, updated_at = excluded.updated_at
      returning *`).get({ ...input, taskId, id: `working_${randomUUID()}`, updatedAt }) as WorkingMemoryRow;
    return toWorkingMemory(row);
  }
  const row = db.prepare(
    `insert into working_memory (id, project_id, kind, content, updated_at)
     values (@id, @projectId, @kind, @content, @updatedAt)
     on conflict(project_id, kind) do update set
       content = excluded.content,
       updated_at = excluded.updated_at
     returning id, project_id, kind, content, updated_at`
  ).get({ id: `working_${randomUUID()}`, ...input, updatedAt }) as WorkingMemoryRow;

  return toWorkingMemory(row);
}

export function normalizeTaskId(taskId?: string): string | undefined {
  if (taskId === undefined) return undefined;
  if (typeof taskId !== "string" || !taskId.trim() || taskId.trim().length > 500 || /[\u0000-\u001f\u007f]/.test(taskId)) {
    throw new Error("taskId must contain 1 to 500 characters");
  }
  return taskId.trim();
}

export function listWorkingMemory(db: Database.Database, projectId: string, taskId?: string): WorkingMemory[] {
  const task = normalizeTaskId(taskId);
  if (task) return db.prepare("select * from task_working_memory where project_id = ? and task_id = ? order by rowid asc")
    .all(projectId, task).map((row) => toWorkingMemory(row as WorkingMemoryRow));
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
  kind?: WorkingMemoryKind,
  taskId?: string
): void {
  const task = normalizeTaskId(taskId);
  if (task) {
    const clause = kind ? " and kind = ?" : "";
    db.prepare(`delete from task_working_memory where project_id = ? and task_id = ?${clause}`)
      .run(...(kind ? [projectId, task, kind] : [projectId, task]));
    return;
  }
  if (kind) {
    db.prepare("delete from working_memory where project_id = ? and kind = ?").run(projectId, kind);
    return;
  }

  db.prepare("delete from working_memory where project_id = ?").run(projectId);
}
