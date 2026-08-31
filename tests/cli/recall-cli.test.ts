import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { callMiraTool } from "../../src/mcp/server.js";
import type { ContextPacket } from "../../src/context/contextPreparation.js";

test("CLI and MCP share context receipts, preview opt-out and task filters", () => {
  const root = mkdtempSync(join(tmpdir(), "mira-recall-interface-"));
  const options = {projectRoot: root, dbPath: join(root, ".mira", "mira.sqlite")};
  const run = (...args: string[]) => JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "src/index.ts", "--project-root", root, ...args], {encoding: "utf8"}));
  try {
    const preview = run("context", "prepare", "--preview") as ContextPacket;
    expect(preview.receipt.recorded).toBe(false);
    expect(callMiraTool(options, "list_recall_events", {})).toEqual([]);
    const packet = callMiraTool(options, "prepare_context", {taskId: "a", maxCharacters: 300}) as ContextPacket;
    expect(run("--task", "a", "context", "recalls")).toEqual([packet.receipt]);
    expect(run("--task", "b", "context", "recalls")).toEqual([]);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
