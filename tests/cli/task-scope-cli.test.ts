import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { callMiraTool } from "../../src/mcp/server.js";

test("CLI and MCP select the same task without exposing another task", () => {
  const root = mkdtempSync(join(tmpdir(), "mira-task-interface-"));
  const options = { projectRoot: root, dbPath: join(root, ".mira", "mira.sqlite") };
  const run = (...args: string[]) => execFileSync(process.execPath, ["--import", "tsx", "src/index.ts", "--project-root", root, ...args], { encoding: "utf8" });
  try {
    run("--task", "a", "working", "set", "--kind", "next_step", "--content", "Task A");
    callMiraTool(options, "set_working_memory", { taskId: "b", kind: "next_step", content: "Task B" });
    expect(callMiraTool(options, "list_working_memory", { taskId: "a" })).toEqual([expect.objectContaining({content: "Task A", taskId: "a"})]);
    expect(run("--task", "a", "context", "bundle")).toContain("Task A");
    expect(run("--task", "a", "context", "bundle")).not.toContain("Task B");
    callMiraTool(options, "clear_working_memory", { taskId: "a" });
    expect(JSON.parse(run("--task", "b", "working", "list"))).toEqual([expect.objectContaining({content: "Task B"})]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
