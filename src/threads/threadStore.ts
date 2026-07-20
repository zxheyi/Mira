import type Database from "better-sqlite3";

export type ThreadRawFormat = "markdown" | "jsonl";

export type Thread = {
  id: string;
  projectId: string;
  title: string;
  source: string;
  rawFormat: ThreadRawFormat;
  rawText: string;
  createdAt: string;
  updatedAt: string;
};

export type SaveThreadInput = {
  id: string;
  projectId: string;
  title: string;
  source: string;
  rawFormat: ThreadRawFormat;
  rawText: string;
};

type ThreadRow = {
  id: string;
  project_id: string;
  title: string;
  source: string;
  raw_format: ThreadRawFormat;
  raw_text: string;
  created_at: string;
  updated_at: string;
};

function toThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    source: row.source,
    rawFormat: row.raw_format,
    rawText: row.raw_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function saveThread(db: Database.Database, input: SaveThreadInput): Thread {
  if (!input.rawText.trim()) {
    throw new Error("Thread raw text is required");
  }

  const now = new Date().toISOString();

  db.prepare(
    `insert into threads (id, project_id, title, source, raw_format, raw_text, created_at, updated_at)
     values (@id, @projectId, @title, @source, @rawFormat, @rawText, @now, @now)
     on conflict(id) do update set
       project_id = excluded.project_id,
       title = excluded.title,
       source = excluded.source,
       raw_format = excluded.raw_format,
       raw_text = excluded.raw_text,
       updated_at = excluded.updated_at`
  ).run({ ...input, now });

  const row = db
    .prepare(
      `select id, project_id, title, source, raw_format, raw_text, created_at, updated_at
       from threads
       where id = ?`
    )
    .get(input.id) as ThreadRow;

  return toThread(row);
}

export function listThreadsForProject(db: Database.Database, projectId: string): Thread[] {
  return db
    .prepare(
      `select id, project_id, title, source, raw_format, raw_text, created_at, updated_at
       from threads
       where project_id = ?
       order by created_at asc, rowid asc`
    )
    .all(projectId)
    .map((row) => toThread(row as ThreadRow));
}

export function getThread(
  db: Database.Database,
  projectId: string,
  threadId: string
): Thread | undefined {
  const row = db.prepare(
    `select id, project_id, title, source, raw_format, raw_text, created_at, updated_at
     from threads where project_id = ? and id = ?`
  ).get(projectId, threadId) as ThreadRow | undefined;
  return row ? toThread(row) : undefined;
}

export function deleteThread(db: Database.Database, projectId: string, threadId: string): void {
  db.prepare("delete from threads where project_id = ? and id = ?").run(projectId, threadId);
}
