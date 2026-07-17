import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
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

describe("vault CLI", () => {
  test("syncs to the default and project-relative custom output", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-vault-cli-"));
    await mkdir(join(root, ".git"));
    const db = join(root, ".mira", "mira.sqlite");
    await run(["working", "set", "--kind", "current_task", "--content", "Ship Markdown Vault."], root, db);

    const first = json<{ outputPath: string; fileCount: number }>((await run(["vault", "sync"], root, db)).stdout);
    expect(first.outputPath).toBe(join(root, ".mira", "vault"));
    expect(first.fileCount).toBe(4);
    expect(await readFile(join(first.outputPath, "working-memory.md"), "utf8")).toContain("Ship Markdown Vault.");

    const second = json<{ outputPath: string }>((await run(["vault", "sync", "--out", "notes/mira"], root, db)).stdout);
    expect(second.outputPath).toBe(join(root, "notes", "mira"));
    expect(await readFile(join(second.outputPath, "index.md"), "utf8")).toContain(" Memory Vault");
  }, 30_000);
});
