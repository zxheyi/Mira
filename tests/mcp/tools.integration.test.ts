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
      "prepare_context",
      "list_recall_events",
      "get_project_briefing",
      "rebuild_project_briefing",
      "search_memory",
      "set_working_memory",
      "list_working_memory",
      "clear_working_memory",
      "add_memory",
      "save_thread",
      "submit_memory_candidates",
      "list_memory_candidates",
      "review_memory_candidate",
      "get_memory",
      "update_memory",
      "archive_memory",
      "get_memory_history"
    ]);
    expect(created.server).toBeDefined();
  });

  test("defines precise agent-facing descriptions for every MCP tool", () => {
    expect(Object.keys(MIRA_MCP_TOOL_DESCRIPTIONS)).toEqual([
      "get_context_bundle",
      "prepare_context",
      "list_recall_events",
      "get_project_briefing",
      "rebuild_project_briefing",
      "search_memory",
      "set_working_memory",
      "list_working_memory",
      "clear_working_memory",
      "add_memory",
      "save_thread",
      "submit_memory_candidates",
      "list_memory_candidates",
      "review_memory_candidate",
      "get_memory",
      "update_memory",
      "archive_memory",
      "get_memory_history"
    ]);

    for (const [toolName, description] of Object.entries(MIRA_MCP_TOOL_DESCRIPTIONS)) {
      expect(description.length).toBeGreaterThan(40);
      expect(description).not.toBe(`Mira ${toolName} tool`);
      expect(description).not.toMatch(/placeholder/i);
    }
  });


  test("distinguishes context bundle and targeted memory search descriptions", () => {
    expect(MIRA_MCP_TOOL_DESCRIPTIONS.get_context_bundle).toMatch(/session start/i);
    expect(MIRA_MCP_TOOL_DESCRIPTIONS.get_context_bundle).toMatch(/Markdown/i);
    expect(MIRA_MCP_TOOL_DESCRIPTIONS.search_memory).toMatch(/targeted/i);
    expect(MIRA_MCP_TOOL_DESCRIPTIONS.search_memory).toMatch(/SearchResult/i);
  });

  test("documents low-priority MCP details", () => {
    expect(MIRA_MCP_TOOL_DESCRIPTIONS.add_memory).toContain("projectId");
    expect(MIRA_MCP_TOOL_DESCRIPTIONS.list_working_memory).toMatch(/no arguments/i);
    expect(MIRA_MCP_TOOL_SCHEMAS.get_context_bundle.maxCharacters?.safeParse(1).success).toBe(false);
  });

  test("supports MCP context bundle top-N and maxCharacters paths", async () => {
    const options = await setupMcpOptions();
    await callMiraTool(options, "add_memory", {
      title: "High priority",
      kind: "decision",
      content: "High priority memory should be selected without a query.",
      source: "mcp-test",
      importance: 10
    });
    await callMiraTool(options, "add_memory", {
      title: "Low priority",
      kind: "note",
      content: "Low priority memory should be excluded by top-N.",
      source: "mcp-test",
      importance: 1
    });

    const bundle = callMiraTool(options, "get_context_bundle", { memoryLimit: 1, maxCharacters: 450 }) as string;

    expect(bundle.length).toBeLessThanOrEqual(450);
    expect(bundle).toContain("High priority");
    expect(bundle).not.toContain("Low priority");
  });

  test("documents MCP return shapes and raw format values", () => {
    expect(MIRA_MCP_TOOL_DESCRIPTIONS.get_context_bundle).toMatch(/Markdown string/i);
    expect(MIRA_MCP_TOOL_DESCRIPTIONS.get_context_bundle).toMatch(/not JSON/i);
    expect(MIRA_MCP_TOOL_DESCRIPTIONS.search_memory).toContain("{ memory:");
    expect(MIRA_MCP_TOOL_DESCRIPTIONS.search_memory).toContain("score");
    expect(MIRA_MCP_TOOL_DESCRIPTIONS.save_thread).toMatch(/rawFormat/i);
    expect(MIRA_MCP_TOOL_DESCRIPTIONS.save_thread).toMatch(/markdown/);
    expect(MIRA_MCP_TOOL_DESCRIPTIONS.save_thread).toMatch(/jsonl/);
  });

  test("limits get_context_bundle query length", () => {
    expect(MIRA_MCP_TOOL_SCHEMAS.get_context_bundle.query?.safeParse("x".repeat(1001)).success).toBe(false);
    expect(MIRA_MCP_TOOL_SCHEMAS.get_context_bundle.maxTokens?.safeParse(24).success).toBe(false);
    expect(MIRA_MCP_TOOL_SCHEMAS.get_context_bundle.maxTokens?.safeParse(25).success).toBe(true);
    expect(MIRA_MCP_TOOL_SCHEMAS.get_context_bundle.maxTokens?.safeParse(250001).success).toBe(false);
  });

  test("rejects unsupported MCP tool names", async () => {
    const options = await setupMcpOptions();

    expect(() => callMiraTool(options, "unknown_tool" as never, {})).toThrow("Unsupported MCP tool: unknown_tool");
  });

  test("constrains MCP schema boundaries and keeps threadId as the only thread reference", () => {
    expect("thread" in MIRA_MCP_TOOL_SCHEMAS.add_memory).toBe(false);
    expect(MIRA_MCP_TOOL_SCHEMAS.add_memory.confidence?.safeParse(1.5).success).toBe(false);
    expect(MIRA_MCP_TOOL_SCHEMAS.add_memory.importance?.safeParse(0).success).toBe(false);
    expect(MIRA_MCP_TOOL_SCHEMAS.add_memory.title.safeParse("x".repeat(501)).success).toBe(false);
    expect(MIRA_MCP_TOOL_SCHEMAS.add_memory.content.safeParse("x".repeat(50001)).success).toBe(false);
    expect(MIRA_MCP_TOOL_SCHEMAS.save_thread.rawFormat.safeParse("plain").success).toBe(false);
    expect(MIRA_MCP_TOOL_SCHEMAS.save_thread.rawFormat.safeParse("markdown").success).toBe(true);
    expect(MIRA_MCP_TOOL_SCHEMAS.save_thread.rawText.safeParse("x".repeat(5_000_001)).success).toBe(false);
    expect(MIRA_MCP_TOOL_SCHEMAS.search_memory.queryMode?.safeParse("orTerms").success).toBe(true);
    expect(MIRA_MCP_TOOL_SCHEMAS.search_memory.queryMode?.safeParse("phrase").success).toBe(true);
    expect(MIRA_MCP_TOOL_SCHEMAS.search_memory.queryMode?.safeParse("semantic").success).toBe(false);
  });

  test("uses keyword OR search by default and supports explicit phrase search", async () => {
    const options = await setupMcpOptions();
    await callMiraTool(options, "add_memory", {
      title: "Auth decision",
      kind: "decision",
      content: "Authentication uses signed sessions.",
      source: "mcp-test"
    });
    await callMiraTool(options, "add_memory", {
      title: "Token constraint",
      kind: "constraint",
      content: "Tokens never enter project logs.",
      source: "mcp-test"
    });

    expect((await callMiraTool(options, "search_memory", { query: "auth token" })) as unknown[]).toHaveLength(2);
    expect(
      (await callMiraTool(options, "search_memory", { query: "auth token", queryMode: "phrase" })) as unknown[]
    ).toEqual([]);
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

  test("submits, lists, and reviews trusted candidates through MCP", async () => {
    const options = await setupMcpOptions();
    await callMiraTool(options, "save_thread", {
      id: "thread_candidate_mcp",
      title: "Candidate MCP",
      source: "codex",
      rawFormat: "markdown",
      rawText: "Architecture changes require explicit review."
    });

    const submitted = await callMiraTool(options, "submit_memory_candidates", {
      threadId: "thread_candidate_mcp",
      sourceAgent: "codex",
      sourceModel: "gpt-5",
      candidates: [{
        title: "Architecture review",
        kind: "architecture",
        content: "Architecture changes require explicit review.",
        evidence: "Architecture changes require explicit review.",
        confidence: 0.99,
        importance: 0.9
      }]
    }) as { results: Array<{ candidate: { id: string }; outcome: string }> };
    expect(submitted.results[0]?.outcome).toBe("pending_review");

    const listed = await callMiraTool(options, "list_memory_candidates", {
      status: "pending_review",
      limit: 10
    }) as { candidates: Array<{ id: string }> };
    expect(listed.candidates).toHaveLength(1);

    const reviewed = await callMiraTool(options, "review_memory_candidate", {
      candidateId: listed.candidates[0]?.id,
      decision: "accept",
      reason: "Confirmed"
    }) as { outcome: string; memory: { title: string } };
    expect(reviewed).toMatchObject({ outcome: "accepted", memory: { title: "Architecture review" } });
  });

  test("constrains candidate MCP schemas", () => {
    expect(MIRA_MCP_TOOL_SCHEMAS.submit_memory_candidates.candidates.safeParse([]).success).toBe(false);
    expect(MIRA_MCP_TOOL_SCHEMAS.submit_memory_candidates.candidates.safeParse(Array.from({ length: 51 }, () => ({}))).success).toBe(false);
    expect(MIRA_MCP_TOOL_SCHEMAS.list_memory_candidates.limit?.safeParse(101).success).toBe(false);
    expect(MIRA_MCP_TOOL_SCHEMAS.review_memory_candidate.decision.safeParse("delete").success).toBe(false);
    expect(MIRA_MCP_TOOL_SCHEMAS.review_memory_candidate.supersedesMemoryId?.safeParse("").success).toBe(false);
  });

  test("runs immutable Memory lifecycle through MCP", async () => {
    const options = await setupMcpOptions();
    const first = await callMiraTool(options, "add_memory", {
      title: "Storage", kind: "decision", content: "Use local SQLite.", source: "user-provided-source"
    }) as { id: string };
    expect(await callMiraTool(options, "get_memory", { memoryId: first.id }))
      .toMatchObject({ id: first.id, status: "active" });

    const successor = await callMiraTool(options, "update_memory", {
      memoryId: first.id,
      content: "Use lifecycle-aware local SQLite.",
      reason: "Approved"
    }) as { id: string; supersedesMemoryId: string };
    expect(successor.supersedesMemoryId).toBe(first.id);
    expect(await callMiraTool(options, "get_memory_history", { memoryId: successor.id }))
      .toMatchObject({ memories: [{ id: first.id }, { id: successor.id }] });
    expect(await callMiraTool(options, "get_memory_history", { memoryId: first.id }))
      .toMatchObject({ events: expect.arrayContaining([expect.objectContaining({ eventType: "accepted", actor: "mcp" })]) });
    expect(await callMiraTool(options, "archive_memory", { memoryId: successor.id, reason: "Paused" }))
      .toMatchObject({ status: "archived" });
    expect(await callMiraTool(options, "search_memory", { query: "lifecycle-aware" })).toEqual([]);
  });

  test("gets and rebuilds proactive Project Briefings through MCP", async () => {
    const options = await setupMcpOptions();
    await callMiraTool(options, "set_working_memory", {
      kind: "current_task", content: "Expose Briefing through MCP."
    });

    const first = await callMiraTool(options, "get_project_briefing", {}) as {
      briefing: { version: number; markdown: string };
    };
    expect(first.briefing).toMatchObject({ version: 1 });
    expect(first.briefing.markdown).toContain("Expose Briefing through MCP.");

    await callMiraTool(options, "set_working_memory", {
      kind: "next_step", content: "Verify MCP Briefing versions."
    });
    const fresh = await callMiraTool(options, "get_project_briefing", {}) as {
      briefing: { version: number; markdown: string };
    };
    expect(fresh.briefing).toMatchObject({ version: 2 });
    const rebuilt = await callMiraTool(options, "rebuild_project_briefing", {}) as {
      briefing: { version: number };
    };
    expect(rebuilt.briefing.version).toBe(3);

    const bundle = await callMiraTool(options, "get_context_bundle", { maxTokens: 50 }) as string;
    expect(bundle.length).toBeLessThanOrEqual(200);
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

  test("rejects invalid MCP boundary inputs through direct calls", async () => {
    const options = await setupMcpOptions();

    expect(() =>
      callMiraTool(options, "add_memory", {
        title: "Invalid confidence",
        kind: "decision",
        content: "Confidence must stay bounded.",
        source: "mcp-test",
        confidence: 2
      })
    ).toThrow(/confidence/);

    expect(() =>
      callMiraTool(options, "add_memory", {
        title: "Legacy thread alias",
        kind: "decision",
        content: "The MCP API should only accept threadId.",
        source: "mcp-test",
        thread: "thread_legacy"
      })
    ).toThrow(/thread/);

    expect(() =>
      callMiraTool(options, "save_thread", {
        title: "Invalid format",
        source: "codex",
        rawFormat: "plain",
        rawText: "summary"
      })
    ).toThrow(/rawFormat/);

    expect(() =>
      callMiraTool(options, "review_memory_candidate", {
        candidateId: "candidate_missing",
        decision: "reject",
        supersedesMemoryId: "memory_invalid"
      })
    ).toThrow(/supersedes is only valid when accepting/);
  });

  test("registered MCP handlers wrap validation errors without throwing", async () => {
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

    const result = (await tools.add_memory.handler({
      title: "Invalid confidence",
      kind: "decision",
      content: "Confidence must stay bounded.",
      source: "mcp-test",
      confidence: 2
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("add_memory");
    expect(result.content[0]?.text).not.toContain("at ");
    db.close();
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
    ).toThrow(/Invalid MCP arguments for add_memory.*kind/);

    expect(() =>
      callMiraTool(options, "set_working_memory", {
        kind: "surprise",
        content: "This kind should not be accepted."
      })
    ).toThrow(/Invalid MCP arguments for set_working_memory.*kind/);

    expect(() => callMiraTool(options, "clear_working_memory", { kind: "surprise" })).toThrow(
      /Invalid MCP arguments for clear_working_memory.*kind/
    );
    expect(() => callMiraTool(options, "search_memory", { query: "MCP", kind: "surprise" })).toThrow(
      /Invalid MCP arguments for search_memory.*kind/
    );
  });

  test("keeps MCP missing argument errors explicit", async () => {
    const options = await setupMcpOptions();

    expect(() => callMiraTool(options, "search_memory", {})).toThrow(/Invalid MCP arguments for search_memory.*query/);
    expect(() => callMiraTool(options, "save_thread", { id: "thread_missing" })).toThrow(
      /Invalid MCP arguments for save_thread.*title/
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
