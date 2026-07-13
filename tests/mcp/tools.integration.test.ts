import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import {
  callMiraTool,
  createMiraMcpServer,
  MIRA_MCP_TOOL_DESCRIPTIONS,
  MIRA_MCP_TOOL_SCHEMAS
} from "../../src/mcp/server.js";

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

  test("defines precise agent-facing descriptions for every MCP tool", () => {
    expect(Object.keys(MIRA_MCP_TOOL_DESCRIPTIONS)).toEqual([
      "get_context_bundle",
      "search_memory",
      "set_working_memory",
      "list_working_memory",
      "clear_working_memory",
      "add_memory",
      "save_thread"
    ]);

    for (const [toolName, description] of Object.entries(MIRA_MCP_TOOL_DESCRIPTIONS)) {
      expect(description.length).toBeGreaterThan(40);
      expect(description).not.toBe(`Mira ${toolName} tool`);
      expect(description).not.toMatch(/placeholder/i);
    }
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

  test("filters MCP memory search by kind", async () => {
    const options = await setupMcpOptions();
    await callMiraTool(options, "add_memory", {
      title: "MCP decision",
      kind: "decision",
      content: "MCP search should support kind filters.",
      source: "mcp-test"
    });
    await callMiraTool(options, "add_memory", {
      title: "MCP failed attempt",
      kind: "failed_attempt",
      content: "MCP search should support kind filters.",
      source: "mcp-test"
    });

    const results = await callMiraTool(options, "search_memory", {
      query: "MCP",
      kind: "failed_attempt"
    });

    expect(results).toEqual([
      expect.objectContaining({
        memory: expect.objectContaining({ title: "MCP failed attempt", kind: "failed_attempt" })
      })
    ]);
  });

  test("generates a thread id when MCP save_thread omits id", async () => {
    const options = await setupMcpOptions();

    const saved = await callMiraTool(options, "save_thread", {
      title: "Generated MCP Thread",
      source: "codex",
      rawFormat: "markdown",
      rawText: "## Notes\n- MCP can generate thread ids."
    });

    expect(saved).toMatchObject({
      title: "Generated MCP Thread",
      rawFormat: "markdown"
    });
    expect((saved as { id: string }).id).toMatch(/^thread_/);
  });

  test("rejects invalid MCP memory and working memory kinds", async () => {
    const options = await setupMcpOptions();

    expect(() =>
      callMiraTool(options, "add_memory", {
        title: "Invalid",
        kind: "surprise",
        content: "This kind should not be accepted.",
        source: "mcp-test"
      })
    ).toThrow(/Unsupported Memory kind: surprise/);

    expect(() =>
      callMiraTool(options, "set_working_memory", {
        kind: "surprise",
        content: "This kind should not be accepted."
      })
    ).toThrow(/Unsupported Working Memory kind: surprise/);

    expect(() => callMiraTool(options, "clear_working_memory", { kind: "surprise" })).toThrow(
      /Unsupported Working Memory kind: surprise/
    );
    expect(() => callMiraTool(options, "search_memory", { query: "MCP", kind: "surprise" })).toThrow(
      /Unsupported Memory kind: surprise/
    );
  });

  test("keeps MCP missing argument errors explicit", async () => {
    const options = await setupMcpOptions();

    expect(() => callMiraTool(options, "search_memory", {})).toThrow("Missing string argument: query");
    expect(() => callMiraTool(options, "save_thread", { id: "thread_missing" })).toThrow(
      "Missing string argument: title"
    );
  });

  test("registered MCP handlers use shared database sessions", async () => {
    const db = openDatabase(":memory:");
    migrate(db);
    const created = createMiraMcpServer({
      projectRoot: "/workspace/mira",
      dbPath: ":memory:",
      db
    });
    const tools = (created.server as unknown as {
      _registeredTools: Record<string, { handler: (args: unknown) => Promise<unknown> }>;
    })._registeredTools;

    await tools.add_memory.handler({
      title: "Shared DB",
      kind: "decision",
      content: "Registered tools should share one database session.",
      source: "mcp-test"
    });
    const searchResult = (await tools.search_memory.handler({ query: "Shared" })) as {
      content: Array<{ text: string }>;
    };

    expect(searchResult.content[0]?.text).toContain("Shared DB");
    db.close();
  });

  test("MCP argument schemas reject invalid registered tool inputs", () => {
    expect(MIRA_MCP_TOOL_SCHEMAS.search_memory.kind?.safeParse("surprise").success).toBe(false);
  });
});
