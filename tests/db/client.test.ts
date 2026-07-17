import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../../src/db/client.js";

describe("database client", () => {
  test("enables recursive triggers for cascade cleanup hooks", () => {
    const database = openDatabase(":memory:");

    expect(database.pragma("recursive_triggers", { simple: true })).toBe(1);

    database.close();
  });

  test("converts non-SQLite file errors into a Mira recovery hint", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "mira-bad-db-"));
    const dbPath = join(tempRoot, "mira.sqlite");
    await writeFile(dbPath, "not sqlite", "utf8");

    expect(() => openDatabase(dbPath)).toThrow(/Remove or replace it, then run mira init/);
  });
});
