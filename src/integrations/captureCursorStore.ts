import type Database from "better-sqlite3";
import type { IntegrationAgent } from "./configInstaller.js";

export type CaptureCursor = {
  projectId: string;
  agent: IntegrationAgent;
  sessionId: string;
  transcriptPath: string;
  size: number;
  mtimeMs: number;
  updatedAt: string;
};

export type SaveCaptureCursorInput = Omit<CaptureCursor, "updatedAt">;

type CaptureCursorRow = {
  project_id: string;
  agent: IntegrationAgent;
  session_id: string;
  transcript_path: string;
  size: number;
  mtime_ms: number;
  updated_at: string;
};

function toCaptureCursor(row: CaptureCursorRow): CaptureCursor {
  return {
    projectId: row.project_id,
    agent: row.agent,
    sessionId: row.session_id,
    transcriptPath: row.transcript_path,
    size: row.size,
    mtimeMs: row.mtime_ms,
    updatedAt: row.updated_at
  };
}

export function getCaptureCursor(
  db: Database.Database,
  projectId: string,
  agent: IntegrationAgent,
  sessionId: string
): CaptureCursor | undefined {
  const row = db
    .prepare(
      `select project_id, agent, session_id, transcript_path, size, mtime_ms, updated_at
       from integration_cursors
       where project_id = ? and agent = ? and session_id = ?`
    )
    .get(projectId, agent, sessionId) as CaptureCursorRow | undefined;

  return row ? toCaptureCursor(row) : undefined;
}

export function saveCaptureCursor(
  db: Database.Database,
  input: SaveCaptureCursorInput
): CaptureCursor {
  const updatedAt = new Date().toISOString();
  db.prepare(
    `insert into integration_cursors (
       project_id, agent, session_id, transcript_path, size, mtime_ms, updated_at
     ) values (
       @projectId, @agent, @sessionId, @transcriptPath, @size, @mtimeMs, @updatedAt
     )
     on conflict(project_id, agent, session_id) do update set
       transcript_path = excluded.transcript_path,
       size = excluded.size,
       mtime_ms = excluded.mtime_ms,
       updated_at = excluded.updated_at`
  ).run({ ...input, updatedAt });

  return getCaptureCursor(db, input.projectId, input.agent, input.sessionId) as CaptureCursor;
}
