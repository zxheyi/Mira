import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { callMiraTool, createMiraMcpServer } from "../../src/mcp/server.js";

async function setupMcpOptions() {
  const projectRoot = await mkdtemp(join(tmpdir(), "mira-mcp-project-"));
  return {
    projectRoot,
    dbPath: join(projectRoot, ".mira", "mira.sqlite")
  };
}

describe("Mira MCP tools", () => {
  test("creates the MCP server factory with the expected tool names", async () => {
    const options = await setupMcpOptions();
    const created = createMiraMcpServer(options);

    expect(created.toolNames).toEqual([
      "get_context_bundle",
      "search_memory",
      "set_working_memory",
      "list_working_memory",
      "clear_working_memory",
      "add_memory",
      "save_thread"
    ]);
    expect(created.server).toBeDefined();
  });

  test("runs the agent read/write loop through MCP tool handlers", async () => {
    const options = await setupMcpOptions();

    const savedThread = await callMiraTool(options, "save_thread", {
      id: "thread_mcp",
      title: "MCP Session",
      source: "codex",
      rawFormat: "markdown",
      rawText: "## Key Decisions\n- MCP tools should support write-back."
    });
    expect(savedThread).toMatchObject({ id: "thread_mcp", rawFormat: "markdown" });

    const memory = await callMiraTool(options, "add_memory", {
      title: "MCP write-back",
      kind: "decision",
      content: "Agents can add memories through MCP.",
      source: "mcp-test",
      confidence: 1,
      importance: 9
    });
    expect(memory).toMatchObject({ title: "MCP write-back", kind: "decision" });

    const search = await callMiraTool(options, "search_memory", { query: "MCP" });
    expect(search).toEqual([expect.objectContaining({ memory: expect.objectContaining({ title: "MCP write-back" }) })]);

    const working = await callMiraTool(options, "set_working_memory", {
      kind: "current_task",
      content: "Finish MCP phase."
    });
    expect(working).toMatchObject({ kind: "current_task", content: "Finish MCP phase." });

    expect(await callMiraTool(options, "list_working_memory", {})).toEqual([
      expect.objectContaining({ kind: "current_task" })
    ]);

    const bundle = await callMiraTool(options, "get_context_bundle", { query: "MCP" });
    expect(bundle).toContain("Finish MCP phase.");
    expect(bundle).toContain("MCP write-back");

    expect(await callMiraTool(options, "clear_working_memory", { kind: "current_task" })).toEqual({ ok: true });
    expect(await callMiraTool(options, "list_working_memory", {})).toEqual([]);
  });
});
