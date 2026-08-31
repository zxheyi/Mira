import { execFile } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
async function run(args: string[], root: string, db: string) {
  return execFileAsync("npm", ["run", "dev", "--", "--project-root", root, "--db", db, ...args], {
    cwd: process.cwd(), env: { ...process.env, NO_COLOR: "1" }
  });
}
function json<T>(stdout: string): T { return JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? ""); }

describe("memory lifecycle CLI", () => {
  test("gets, updates, archives, restores, and reads history", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-lifecycle-cli-"));
    await mkdir(join(root, ".git"));
    const db = join(root, ".mira", "mira.sqlite");
    const first = json<{ id: string }>((await run([
      "memory", "add", "--title", "Storage", "--kind", "decision",
      "--content", "Use local SQLite.", "--source", "manual"
    ], root, db)).stdout);

    expect(json<{ status: string }>((await run(["memory", "get", "--id", first.id], root, db)).stdout).status)
      .toBe("active");
    await expect(run(["memory", "update", "--id", first.id, "--content", "api_key=privatevalue123456"], root, db))
      .rejects.toMatchObject({stderr: expect.stringContaining("sensitive")});
    expect(json<{status: string}>((await run(["memory", "get", "--id", first.id], root, db)).stdout).status).toBe("active");
    const successor = json<{ id: string; supersedesMemoryId: string }>((await run([
      "memory", "update", "--id", first.id,
      "--content", "Use lifecycle-aware local SQLite.", "--reason", "Approved"
    ], root, db)).stdout);
    expect(successor.supersedesMemoryId).toBe(first.id);
    const history = json<{ memories: Array<{ id: string }> }>((await run([
      "memory", "history", "--id", successor.id
    ], root, db)).stdout);
    expect(history.memories.map((memory) => memory.id)).toEqual([first.id, successor.id]);

    expect(json<{ status: string }>((await run([
      "memory", "archive", "--id", successor.id, "--reason", "Paused"
    ], root, db)).stdout).status).toBe("archived");
    expect(json<unknown[]>((await run(["memory", "search", "SQLite"], root, db)).stdout)).toEqual([]);
    expect(json<{ status: string }>((await run([
      "memory", "restore", "--id", successor.id, "--reason", "Active again"
    ], root, db)).stdout).status).toBe("active");
  }, 30_000);

  test("requires explicit confirmation for privacy hard deletes", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-privacy-cli-"));
    await mkdir(join(root, ".git"));
    const db = join(root, ".mira", "mira.sqlite");
    await run([
      "thread", "save", "--id", "thread_private", "--title", "Private", "--source", "codex",
      "--format", "markdown", "--text", "## Notes\n- Private note."
    ], root, db);
    await run(["memory", "distill", "--thread", "thread_private"], root, db);

    await expect(run(["memory", "clear", "--thread", "thread_private"], root, db))
      .rejects.toMatchObject({ stderr: expect.stringContaining("--confirm-hard-delete") });
    expect(json<unknown[]>((await run(["memory", "search", "Private"], root, db)).stdout)).not.toEqual([]);
    await run(["memory", "clear", "--thread", "thread_private", "--confirm-hard-delete"], root, db);
    expect(json<unknown[]>((await run(["memory", "search", "Private"], root, db)).stdout)).toEqual([]);

    await expect(run(["thread", "delete", "--id", "thread_private"], root, db))
      .rejects.toMatchObject({ stderr: expect.stringContaining("--confirm-hard-delete") });
    await run(["thread", "delete", "--id", "thread_private", "--confirm-hard-delete"], root, db);

    const projects = json<Array<{ id: string }>>((await run(["project", "list"], root, db)).stdout);
    await expect(run(["project", "delete", "--id", projects[0]!.id], root, db))
      .rejects.toMatchObject({ stderr: expect.stringContaining("--confirm-hard-delete") });
    await run(["project", "delete", "--id", projects[0]!.id, "--confirm-hard-delete"], root, db);
  }, 30_000);
});
