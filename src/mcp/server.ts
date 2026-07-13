import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { buildContextBundle } from "../context/contextBundle.js";
import { openDatabase } from "../db/client.js";
import { migrate } from "../db/schema.js";
import { addMemory, MEMORY_KINDS, searchMemories, type MemoryKind } from "../memory/memoryStore.js";
import { ensureProjectForRoot } from "../projects/projectStore.js";
import { saveThread, type ThreadRawFormat } from "../threads/threadStore.js";
import {
  clearWorkingMemory,
  listWorkingMemory,
  setWorkingMemory,
  WORKING_MEMORY_KINDS,
  type WorkingMemoryKind
} from "../workingMemory/workingMemoryStore.js";

export const MIRA_MCP_TOOL_NAMES = [
  "get_context_bundle",
  "search_memory",
  "set_working_memory",
  "list_working_memory",
  "clear_working_memory",
  "add_memory",
  "save_thread"
] as const;

export type MiraMcpToolName = (typeof MIRA_MCP_TOOL_NAMES)[number];

export const MIRA_MCP_TOOL_DESCRIPTIONS = {
  get_context_bundle: "Use at session start to return one concise Markdown string, not JSON, containing working memory plus relevant long-term memories.",
  search_memory: "Use for targeted historical lookups; accepts optional limit and returns SearchResult[] as { memory: { title, kind, source, confidence, ... }, score }.",
  set_working_memory: "Set or replace one working-memory entry; returns the saved WorkingMemory object for the chosen kind.",
  list_working_memory: "List current working-memory entries with no arguments; returns WorkingMemory[] ordered for resuming active task state.",
  clear_working_memory: "Clear stale working memory for one kind or all kinds; returns { ok: true } after deletion.",
  add_memory: "Write a stable long-term memory; returns the Memory object and de-duplicates by projectId, kind, threadId, and content hash.",
  save_thread: "Save an agent-generated session summary; rawFormat must be markdown or jsonl, and the tool returns the Thread object."
} satisfies Record<MiraMcpToolName, string>;

export type MiraMcpOptions = {
  projectRoot: string;
  dbPath: string;
  db?: Database.Database;
};

type ToolArgs = Record<string, unknown>;

export const MIRA_MCP_TOOL_SCHEMAS = {
  get_context_bundle: {
    query: z.string().trim().min(1).max(1_000).optional(),
    memoryLimit: z.number().int().min(1).max(50).optional(),
    maxCharacters: z.number().int().min(100).max(1_000_000).optional()
  },
  search_memory: {
    query: z.string().trim().min(1).max(1_000),
    kind: z.enum(MEMORY_KINDS).optional(),
    limit: z.number().int().min(1).max(50).optional()
  },
  set_working_memory: {
    kind: z.enum(WORKING_MEMORY_KINDS),
    content: z.string().trim().min(1).max(100_000)
  },
  list_working_memory: {},
  clear_working_memory: {
    kind: z.enum(WORKING_MEMORY_KINDS).optional()
  },
  add_memory: {
    title: z.string().trim().min(1).max(500),
    kind: z.enum(MEMORY_KINDS),
    content: z.string().trim().min(1).max(50_000),
    source: z.string().trim().min(1).max(500),
    threadId: z.string().trim().min(1).max(500).optional(),
    confidence: z.number().min(0).max(1).optional(),
    importance: z.number().int().min(1).max(10).optional()
  },
  save_thread: {
    id: z.string().trim().min(1).max(500).optional(),
    title: z.string().trim().min(1).max(500),
    source: z.string().trim().min(1).max(500),
    rawFormat: z.enum(["markdown", "jsonl"]),
    rawText: z.string().trim().min(1).max(5_000_000)
  }
} satisfies Record<MiraMcpToolName, Record<string, z.ZodType>>;


type ToolSession = {
  db: Database.Database;
  projectId: string;
};

function stringArg(args: ToolArgs, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing string argument: ${name}`);
  }
  return value;
}

function optionalStringArg(args: ToolArgs, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberArg(args: ToolArgs, name: string, fallback: number): number {
  const value = args[name];
  return typeof value === "number" ? value : fallback;
}

function memoryKindArg(args: ToolArgs, name: string): MemoryKind {
  const kind = stringArg(args, name);
  if (!(MEMORY_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Unsupported Memory kind: ${kind}. Supported kinds: ${MEMORY_KINDS.join(", ")}`);
  }
  return kind as MemoryKind;
}

function optionalMemoryKindArg(args: ToolArgs, name: string): MemoryKind | undefined {
  const kind = optionalStringArg(args, name);
  if (!kind) {
    return undefined;
  }
  if (!(MEMORY_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Unsupported Memory kind: ${kind}. Supported kinds: ${MEMORY_KINDS.join(", ")}`);
  }
  return kind as MemoryKind;
}

function workingMemoryKindArg(args: ToolArgs, name: string): WorkingMemoryKind {
  const kind = stringArg(args, name);
  if (!(WORKING_MEMORY_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Unsupported Working Memory kind: ${kind}. Supported kinds: ${WORKING_MEMORY_KINDS.join(", ")}`);
  }
  return kind as WorkingMemoryKind;
}

function rawFormatArg(args: ToolArgs, name: string): ThreadRawFormat {
  const rawFormat = stringArg(args, name);
  if (rawFormat !== "markdown" && rawFormat !== "jsonl") {
    throw new Error("Thread raw format must be markdown or jsonl");
  }
  return rawFormat;
}

function optionalWorkingMemoryKindArg(args: ToolArgs, name: string): WorkingMemoryKind | undefined {
  const kind = optionalStringArg(args, name);
  if (!kind) {
    return undefined;
  }
  if (!(WORKING_MEMORY_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Unsupported Working Memory kind: ${kind}. Supported kinds: ${WORKING_MEMORY_KINDS.join(", ")}`);
  }
  return kind as WorkingMemoryKind;
}

function withToolSession<T>(options: MiraMcpOptions, run: (session: ToolSession) => T): T {
  const db = options.db ?? openDatabase(options.dbPath);
  migrate(db);

  try {
    const project = ensureProjectForRoot(db, options.projectRoot);
    return run({ db, projectId: project.id });
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

function executeMiraTool(
  session: ToolSession,
  name: MiraMcpToolName,
  args: ToolArgs
): unknown {
  const { db, projectId } = session;
    switch (name) {
      case "get_context_bundle":
        return buildContextBundle(db, projectId, {
          query: optionalStringArg(args, "query"),
          memoryLimit: numberArg(args, "memoryLimit", 8),
          maxCharacters: typeof args.maxCharacters === "number" ? args.maxCharacters : undefined
        });
      case "search_memory":
        return searchMemories(db, projectId, stringArg(args, "query"), {
          kind: optionalMemoryKindArg(args, "kind"),
          limit: numberArg(args, "limit", 50)
        });
      case "set_working_memory":
        return setWorkingMemory(db, {
          projectId,
          kind: workingMemoryKindArg(args, "kind"),
          content: stringArg(args, "content")
        });
      case "list_working_memory":
        return listWorkingMemory(db, projectId);
      case "clear_working_memory":
        clearWorkingMemory(db, projectId, optionalWorkingMemoryKindArg(args, "kind"));
        return { ok: true };
      case "add_memory":
        return addMemory(db, {
          projectId,
          threadId: optionalStringArg(args, "threadId"),
          title: stringArg(args, "title"),
          kind: memoryKindArg(args, "kind"),
          content: stringArg(args, "content"),
          source: stringArg(args, "source"),
          confidence: numberArg(args, "confidence", 1),
          importance: numberArg(args, "importance", 5)
        });
      case "save_thread":
        return saveThread(db, {
          id: optionalStringArg(args, "id") ?? `thread_${randomUUID()}`,
          projectId,
          title: stringArg(args, "title"),
          source: stringArg(args, "source"),
          rawFormat: rawFormatArg(args, "rawFormat"),
          rawText: stringArg(args, "rawText")
        });
      default: {
        const exhaustive: never = name;
        throw new Error(`Unsupported MCP tool in executor: ${String(exhaustive)}`);
      }
    }
}

export function callMiraTool(
  options: MiraMcpOptions,
  name: string,
  args: ToolArgs
): unknown {
  const parsed = parseMiraToolArgs(name, args);
  return withToolSession(options, (session) => executeMiraTool(session, parsed.name, parsed.args));
}

function isMiraMcpToolName(name: string): name is MiraMcpToolName {
  return (MIRA_MCP_TOOL_NAMES as readonly string[]).includes(name);
}

function parseMiraToolArgs(name: string, args: unknown): { name: MiraMcpToolName; args: ToolArgs } {
  if (!isMiraMcpToolName(name)) {
    throw new Error(`Unsupported MCP tool: ${name}`);
  }

  const result = z.object(MIRA_MCP_TOOL_SCHEMAS[name]).strict().safeParse(args ?? {});
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid MCP arguments for ${name}: ${details}`);
  }
  return { name, args: result.data as ToolArgs };
}

function toMcpToolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
      }
    ]
  };
}

function toMcpErrorResult(toolName: MiraMcpToolName, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: message.includes(toolName) ? message : `${toolName}: ${message}`
      }
    ]
  };
}

export function createMiraMcpServer(options: MiraMcpOptions): {
  server: McpServer;
  toolNames: MiraMcpToolName[];
} {
  const server = new McpServer({ name: "mira", version: "0.1.0" });
  const db = options.db ?? openDatabase(options.dbPath);
  migrate(db);
  const project = ensureProjectForRoot(db, options.projectRoot);
  const session = { db, projectId: project.id };
  const originalClose = server.close.bind(server);
  server.close = async () => {
    await originalClose();
    if (!options.db) {
      db.close();
    }
  };

  for (const toolName of MIRA_MCP_TOOL_NAMES) {
    server.registerTool(
      toolName,
      {
        title: toolName,
        description: MIRA_MCP_TOOL_DESCRIPTIONS[toolName],
        inputSchema: MIRA_MCP_TOOL_SCHEMAS[toolName]
      },
      async (args: unknown) => {
        try {
          return toMcpToolResult(executeMiraTool(session, toolName, parseMiraToolArgs(toolName, args).args));
        } catch (error) {
          return toMcpErrorResult(toolName, error);
        }
      }
    );
  }

  return { server, toolNames: [...MIRA_MCP_TOOL_NAMES] };
}
