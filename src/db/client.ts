import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(path: string): Database.Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  try {
    const db = new Database(path);
    db.pragma("foreign_keys = ON");
    db.pragma("recursive_triggers = ON");
    if (path !== ":memory:") {
      db.pragma("journal_mode = WAL");
    }
    db.pragma("busy_timeout = 5000");
    return db;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("file is not a database")) {
      throw new Error(
        `Failed to open Mira database at ${path}: file is not a SQLite database. Remove or replace it, then run mira init.`
      );
    }
    throw error;
  }
}
