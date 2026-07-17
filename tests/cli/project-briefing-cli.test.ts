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

describe("project briefing CLI", () => {
  test("shows, refreshes, rebuilds, and lists versioned Project Briefings", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-briefing-cli-"));
    await mkdir(join(root, ".git"));
    const db = join(root, ".mira", "mira.sqlite");
    await run(["working", "set", "--kind", "current_task", "--content", "Ship Project Briefing."], root, db);

    const first = json<{ version: number; markdown: string }>((await run(["briefing", "show"], root, db)).stdout);
    expect(first).toMatchObject({ version: 1 });
    expect(first.markdown).toContain("Ship Project Briefing.");

    await run(["working", "set", "--kind", "next_step", "--content", "Run complete tests."], root, db);
    const refreshed = json<{ version: number; markdown: string }>((await run(["briefing", "show"], root, db)).stdout);
    expect(refreshed).toMatchObject({ version: 2 });
    expect(refreshed.markdown).toContain("Run complete tests.");

    const rebuilt = json<{ version: number }>((await run(["briefing", "rebuild"], root, db)).stdout);
    expect(rebuilt.version).toBe(3);
    const history = json<Array<{ version: number }>>((await run(["briefing", "history", "--limit", "3"], root, db)).stdout);
    expect(history.map((item) => item.version)).toEqual([3, 2, 1]);

    const rawContext = (await run(["context", "bundle", "--max-tokens", "50"], root, db)).stdout;
    const context = rawContext.slice(rawContext.indexOf("# Mira Context Bundle"));
    expect(context.length).toBeLessThanOrEqual(200);
  }, 30_000);
});
