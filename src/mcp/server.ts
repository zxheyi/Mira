import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { z } from "zod";
import { buildContextBundle } from "../context/contextBundle.js";
import { openDatabase } from "../db/client.js";
import { migrate } from "../db/schema.js";
import { addMemory, searchMemories, type MemoryKind } from "../memory/memoryStore.js";
import { ensureProjectForRoot } from "../projects/projectStore.js";
import { saveThread } from "../threads/threadStore.js";
import {
  clearWorkingMemory,
  listWorkingMemory,
  setWorkingMemory,
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

export type MiraMcpOptions = {
  projectRoot: string;
  dbPath: string;
};

type ToolArgs = Record<string, unknown>;

const TOOL_SCHEMAS = {
  get_context_bundle: {
    query: z.string().optional(),
    memoryLimit: z.number().optional(),
    maxCharacters: z.number().optional()
  },
  search_memory: {
    query: z.string()
  },
  set_working_memory: {
    kind: z.string(),
    content: z.string()
  },
  list_working_memory: {},
  clear_working_memory: {
    kind: z.string().optional()
  },
  add_memory: {
    title: z.string(),
    kind: z.string(),
    content: z.string(),
    source: z.string(),
    threadId: z.string().optional(),
    thread: z.string().optional(),
    confidence: z.number().optional(),
    importance: z.number().optional()
  },
  save_thread: {
    id: z.string(),
    title: z.string(),
    source: z.string(),
    rawFormat: z.string(),
    rawText: z.string()
  }
} satisfies Record<MiraMcpToolName, Record<string, unknown>>;


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

function withToolSession<T>(options: MiraMcpOptions, run: (session: ToolSession) => T): T {
  const db = openDatabase(options.dbPath);
  migrate(db);

  try {
    const project = ensureProjectForRoot(db, options.projectRoot);
    return run({ db, projectId: project.id });
  } finally {
    db.close();
  }
}

export function callMiraTool(
  options: MiraMcpOptions,
  name: MiraMcpToolName,
  args: ToolArgs
): unknown {
  return withToolSession(options, ({ db, projectId }) => {
    switch (name) {
      case "get_context_bundle":
        return buildContextBundle(db, projectId, {
          query: optionalStringArg(args, "query"),
          memoryLimit: numberArg(args, "memoryLimit", 8),
          maxCharacters: typeof args.maxCharacters === "number" ? args.maxCharacters : undefined
        });
      case "search_memory":
        return searchMemories(db, projectId, stringArg(args, "query"));
      case "set_working_memory":
        return setWorkingMemory(db, {
          projectId,
          kind: stringArg(args, "kind") as WorkingMemoryKind,
          content: stringArg(args, "content")
        });
      case "list_working_memory":
        return listWorkingMemory(db, projectId);
      case "clear_working_memory":
        clearWorkingMemory(db, projectId, optionalStringArg(args, "kind") as WorkingMemoryKind | undefined);
        return { ok: true };
      case "add_memory":
        return addMemory(db, {
          projectId,
          threadId: optionalStringArg(args, "threadId") ?? optionalStringArg(args, "thread"),
          title: stringArg(args, "title"),
          kind: stringArg(args, "kind") as MemoryKind,
          content: stringArg(args, "content"),
          source: stringArg(args, "source"),
          confidence: numberArg(args, "confidence", 1),
          importance: numberArg(args, "importance", 5)
        });
      case "save_thread":
        return saveThread(db, {
          id: stringArg(args, "id"),
          projectId,
          title: stringArg(args, "title"),
          source: stringArg(args, "source"),
          rawFormat: stringArg(args, "rawFormat"),
          rawText: stringArg(args, "rawText")
        });
    }
  });
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

export function createMiraMcpServer(options: MiraMcpOptions): {
  server: McpServer;
  toolNames: MiraMcpToolName[];
} {
  const server = new McpServer({ name: "mira", version: "0.1.0" });

  for (const toolName of MIRA_MCP_TOOL_NAMES) {
    server.registerTool(
      toolName,
      {
        title: toolName,
        description: `Mira ${toolName} tool`,
        inputSchema: TOOL_SCHEMAS[toolName]
      },
      async (args: unknown) => toMcpToolResult(callMiraTool(options, toolName, args as ToolArgs))
    );
  }

  return { server, toolNames: [...MIRA_MCP_TOOL_NAMES] };
}
