import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

describe("schema infrastructure readiness", () => {
  test("configures indexes and rejects newer schema versions", () => {
    db = openDatabase(":memory:");

    migrate(db);
    db.prepare("insert into schema_version (version, applied_at) values (?, ?)").run(999, new Date().toISOString());

    const indexes = db
      .prepare("select name from sqlite_master where type = 'index'")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(indexes).toEqual(
      expect.arrayContaining(["idx_memories_project", "idx_memories_project_thread", "idx_threads_project"])
    );
    expect(() => migrate(db as Database.Database)).toThrow("Unsupported Mira schema version");
  });
});
