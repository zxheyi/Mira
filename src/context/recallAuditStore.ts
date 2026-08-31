import type Database from "better-sqlite3";
import { normalizeTaskId } from "../workingMemory/workingMemoryStore.js";

export type RecallReceipt = {
  id: string;
  projectId: string;
  taskId?: string;
  query?: string;
  candidateMemoryIds: string[];
  injectedMemoryIds: string[];
  dropped: Array<{ memoryId: string; reason: "budget" | "memory_limit" }>;
  characterCount: number;
  tokenUpperBound: number;
  maxCharacters?: number;
  maxTokens?: number;
  outputHash: string;
  latencyMs: number;
  recorded: boolean;
  createdAt: string;
};

export function recordRecallEvent(db: Database.Database, receipt: RecallReceipt): void {
  db.prepare("insert into recall_events (id, project_id, task_id, receipt, created_at) values (?, ?, ?, ?, ?)")
    .run(receipt.id, receipt.projectId, receipt.taskId ?? null, JSON.stringify(receipt), receipt.createdAt);
}

export function listRecallEvents(db: Database.Database, projectId: string, options: { taskId?: string; limit?: number } = {}): RecallReceipt[] {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Recall limit must be between 1 and 100");
  const task = normalizeTaskId(options.taskId);
  return db.prepare(`select receipt from recall_events where project_id = ? ${task ? "and task_id = ?" : ""}
    order by created_at desc, rowid desc limit ?`)
    .all(projectId, ...(task ? [task] : []), limit)
    .map(row => JSON.parse((row as { receipt: string }).receipt) as RecallReceipt);
}
