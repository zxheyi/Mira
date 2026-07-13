import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { buildContextBundle } from "../context/contextBundle.js";
import { openDatabase } from "../db/client.js";
import { migrate } from "../db/schema.js";
import { addMemory, MEMORY_KINDS, searchMemories, type MemoryKind } from "../memory/memoryStore.js";
import { ensureProjectForRoot } from "../projects/projectStore.js";
import { saveThread } from "../threads/threadStore.js";
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
  get_context_bundle: "Build a concise Markdown context bundle with current working memory and relevant long-term memories for this project.",
  search_memory: "Search this project's long-term memories by text and return ranked results with score, kind, title, source, and confidence.",
  set_working_memory: "Set the current project working-memory snapshot for a supported kind such as current_task, blocker, or next_step.",
  list_working_memory: "List the current project working-memory entries so the agent can resume the active task state.",
  clear_working_memory: "Clear stale working-memory entries for one supported kind, or clear all working memory when no kind is provided.",
  add_memory: "Write a stable, reviewed long-term memory for this project with provenance, confidence, importance, and a supported kind.",
  save_thread: "Save an agent-generated session summary as a Mira thread for later distillation, search, and provenance tracking."
} satisfies Record<MiraMcpToolName, string>;

export type MiraMcpOptions = {
  projectRoot: string;
  dbPath: string;
  db?: Database.Database;
};

type ToolArgs = Record<string, unknown>;

export const MIRA_MCP_TOOL_SCHEMAS = {
  get_context_bundle: {
    query: z.string().optional(),
    memoryLimit: z.number().optional(),
    maxCharacters: z.number().optional()
  },
  search_memory: {
    query: z.string(),
    kind: z.enum(MEMORY_KINDS).optional()
  },
  set_working_memory: {
    kind: z.enum(WORKING_MEMORY_KINDS),
    content: z.string()
  },
  list_working_memory: {},
  clear_working_memory: {
    kind: z.enum(WORKING_MEMORY_KINDS).optional()
  },
  add_memory: {
    title: z.string(),
    kind: z.enum(MEMORY_KINDS),
    content: z.string(),
    source: z.string(),
    threadId: z.string().optional(),
    thread: z.string().optional(),
    confidence: z.number().optional(),
    importance: z.number().optional()
  },
  save_thread: {
    id: z.string().optional(),
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
          kind: optionalMemoryKindArg(args, "kind")
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
          threadId: optionalStringArg(args, "threadId") ?? optionalStringArg(args, "thread"),
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
          rawFormat: stringArg(args, "rawFormat"),
          rawText: stringArg(args, "rawText")
        });
    }
}

export function callMiraTool(
  options: MiraMcpOptions,
  name: MiraMcpToolName,
  args: ToolArgs
): unknown {
  return withToolSession(options, (session) => executeMiraTool(session, name, args));
}

function parseMiraToolArgs(name: MiraMcpToolName, args: unknown): ToolArgs {
  return z.object(MIRA_MCP_TOOL_SCHEMAS[name]).parse(args ?? {}) as ToolArgs;
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

function toMcpErrorResult(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error)
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
          return toMcpToolResult(executeMiraTool(session, toolName, parseMiraToolArgs(toolName, args)));
        } catch (error) {
          return toMcpErrorResult(error);
        }
      }
    );
  }

  return { server, toolNames: [...MIRA_MCP_TOOL_NAMES] };
}
