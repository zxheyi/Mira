import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ensureFreshProjectBriefing,
  rebuildProjectBriefing
} from "../briefing/projectBriefingStore.js";
import { buildContextBundle } from "../context/contextBundle.js";
import { prepareContext } from "../context/contextPreparation.js";
import { listRecallEvents } from "../context/recallAuditStore.js";
import { openDatabase } from "../db/client.js";
import { migrate } from "../db/schema.js";
import {
  listMemoryCandidates,
  reviewMemoryCandidate,
  submitMemoryCandidates
} from "../distill/candidateService.js";
import { CANDIDATE_STATUSES, type MemoryCandidateInput } from "../distill/candidateTypes.js";
import { addMemory, MEMORY_KINDS, searchMemories, type MemoryKind } from "../memory/memoryStore.js";
import { archiveMemory, getMemory, getMemoryHistory, updateMemory } from "../memory/memoryLifecycleStore.js";
import { ensureProjectForRoot } from "../projects/projectStore.js";
import { repositoryLocation } from "../projects/projectIdentity.js";
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
] as const;

export type MiraMcpToolName = (typeof MIRA_MCP_TOOL_NAMES)[number];

export const MIRA_MCP_TOOL_DESCRIPTIONS = {
  get_context_bundle: "Use at session start to return one concise Markdown string, not JSON, containing working memory, the latest Project Briefing metadata, and query-relevant memories with an audited receipt.",
  prepare_context: "Prepare bounded context and return { markdown, receipt } with candidate, injected and omitted memory IDs. Preview mode records neither recall nor Briefing writes.",
  list_recall_events: "Inspect recent context injection receipts for the bound project and optional task; receipt means injected, not proven useful.",
  get_project_briefing: "Read or deterministically refresh the bound project's latest derived Briefing; returns { briefing } with Markdown, version, provenance ids, stale state, and size estimates.",
  rebuild_project_briefing: "Force one deterministic rebuild of the bound project's derived Briefing; returns { briefing } while preserving every earlier complete or failed version for audit.",
  search_memory: "Use for targeted historical lookups; defaults to keyword OR matching, supports explicit phrase mode and optional limit, and returns SearchResult[] as { memory: { title, kind, source, confidence, ... }, score }.",
  set_working_memory: "Set or replace one working-memory entry; returns the saved WorkingMemory object for the chosen kind.",
  list_working_memory: "List current working-memory entries with no arguments; returns WorkingMemory[] ordered for resuming active task state.",
  clear_working_memory: "Clear stale working memory for one kind or all kinds; returns { ok: true } after deletion.",
  add_memory: "Write a stable long-term memory; returns the Memory object and de-duplicates by projectId, kind, threadId, and content hash.",
  save_thread: "Save an agent-generated session summary; rawFormat must be markdown or jsonl, and the tool returns the Thread object.",
  submit_memory_candidates: "Submit evidence-backed memory candidates after important work; Mira validates provenance and either auto-accepts trusted low-risk items or queues them for review.",
  list_memory_candidates: "List memory candidates for the bound project, optionally filtered by review status; use this to inspect items awaiting human or Agent confirmation.",
  review_memory_candidate: "Accept or reject one pending memory candidate; only acceptance may provide supersedesMemoryId to create a traceable successor of an active predecessor.",
  get_memory: "Read one Memory by id including inactive lifecycle state, provenance, predecessor link, and timestamps for audit or update preparation.",
  update_memory: "Create an immutable active successor and atomically supersede its active predecessor; returns the new Memory without overwriting history.",
  archive_memory: "Archive one active Memory so it leaves default search and Context Bundle results while remaining available in auditable history.",
  get_memory_history: "Return the complete ordered predecessor-successor chain plus lifecycle events when auditing how a project Memory evolved."
} satisfies Record<MiraMcpToolName, string>;

export type MiraMcpOptions = {
  projectRoot: string;
  dbPath: string;
  db?: Database.Database;
  taskId?: string;
};

type ToolArgs = Record<string, unknown>;

export const MIRA_MCP_TOOL_SCHEMAS = {
  prepare_context: {
    taskId: z.string().trim().min(1).max(500).optional(),
    query: z.string().trim().min(1).max(1_000).optional(),
    memoryLimit: z.number().int().min(1).max(50).optional(),
    maxCharacters: z.number().int().min(1).max(1_000_000).optional(),
    maxTokens: z.number().int().min(25).max(250_000).optional(),
    preview: z.boolean().optional()
  },
  list_recall_events: {
    taskId: z.string().trim().min(1).max(500).optional(),
    limit: z.number().int().min(1).max(100).optional()
  },
  get_context_bundle: {
    taskId: z.string().trim().min(1).max(500).optional(),
    query: z.string().trim().min(1).max(1_000).optional(),
    memoryLimit: z.number().int().min(1).max(50).optional(),
    maxCharacters: z.number().int().min(100).max(1_000_000).optional(),
    maxTokens: z.number().int().min(25).max(250_000).optional()
  },
  get_project_briefing: {},
  rebuild_project_briefing: {},
  search_memory: {
    query: z.string().trim().min(1).max(1_000),
    kind: z.enum(MEMORY_KINDS).optional(),
    queryMode: z.enum(["orTerms", "phrase"]).optional(),
    limit: z.number().int().min(1).max(50).optional()
  },
  set_working_memory: {
    taskId: z.string().trim().min(1).max(500).optional(),
    kind: z.enum(WORKING_MEMORY_KINDS),
    content: z.string().trim().min(1).max(100_000)
  },
  list_working_memory: { taskId: z.string().trim().min(1).max(500).optional() },
  clear_working_memory: {
    taskId: z.string().trim().min(1).max(500).optional(),
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
  },
  submit_memory_candidates: {
    threadId: z.string().trim().min(1).max(500),
    sourceAgent: z.string().trim().min(1).max(100),
    sourceModel: z.string().trim().min(1).max(200).optional(),
    candidates: z.array(z.object({
      title: z.string().trim().min(1).max(200),
      kind: z.enum(MEMORY_KINDS),
      content: z.string().trim().min(1).max(10_000),
      evidence: z.string().trim().min(1).max(4_000),
      confidence: z.number().min(0).max(1),
      importance: z.number().min(0).max(1)
    }).strict()).min(1).max(50)
  },
  list_memory_candidates: {
    status: z.enum(CANDIDATE_STATUSES).optional(),
    limit: z.number().int().min(1).max(100).optional()
  },
  review_memory_candidate: {
    candidateId: z.string().trim().min(1).max(500),
    decision: z.enum(["accept", "reject"]),
    reason: z.string().trim().min(1).max(1_000).optional(),
    supersedesMemoryId: z.string().trim().min(1).max(500).optional()
  },
  get_memory: {
    memoryId: z.string().trim().min(1).max(500)
  },
  update_memory: {
    memoryId: z.string().trim().min(1).max(500),
    content: z.string().trim().min(1).max(50_000),
    title: z.string().trim().min(1).max(500).optional(),
    kind: z.enum(MEMORY_KINDS).optional(),
    confidence: z.number().min(0).max(1).optional(),
    importance: z.number().int().min(1).max(10).optional(),
    source: z.string().trim().min(1).max(500).optional(),
    reason: z.string().trim().min(1).max(1_000).optional()
  },
  archive_memory: {
    memoryId: z.string().trim().min(1).max(500),
    reason: z.string().trim().min(1).max(1_000).optional()
  },
  get_memory_history: {
    memoryId: z.string().trim().min(1).max(500)
  }
} satisfies Record<MiraMcpToolName, Record<string, z.ZodType>>;


type ToolSession = {
  taskId?: string;
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

function searchQueryModeArg(args: ToolArgs): "orTerms" | "phrase" {
  return optionalStringArg(args, "queryMode") === "phrase" ? "phrase" : "orTerms";
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
    return run({ db, projectId: project.id, taskId: options.taskId ?? repositoryLocation(options.projectRoot).workspaceTaskId });
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
  const taskId = optionalStringArg(args, "taskId") ?? session.taskId;
    switch (name) {
      case "prepare_context":
        return prepareContext(db, projectId, {
          taskId, query: optionalStringArg(args, "query"),
          memoryLimit: numberArg(args, "memoryLimit", 8),
          maxCharacters: typeof args.maxCharacters === "number" ? args.maxCharacters : undefined,
          maxTokens: typeof args.maxTokens === "number" ? args.maxTokens : undefined,
          recordAudit: args.preview !== true
        });
      case "list_recall_events":
        return listRecallEvents(db, projectId, {taskId, limit: numberArg(args, "limit", 20)});
      case "get_context_bundle":
        return buildContextBundle(db, projectId, {
          taskId,
          query: optionalStringArg(args, "query"),
          memoryLimit: numberArg(args, "memoryLimit", 8),
          maxCharacters: typeof args.maxCharacters === "number" ? args.maxCharacters : undefined,
          maxTokens: typeof args.maxTokens === "number" ? args.maxTokens : undefined
        });
      case "get_project_briefing":
        return { briefing: ensureFreshProjectBriefing(db, projectId) };
      case "rebuild_project_briefing":
        return { briefing: rebuildProjectBriefing(db, projectId) };
      case "search_memory":
        return searchMemories(db, projectId, stringArg(args, "query"), {
          kind: optionalMemoryKindArg(args, "kind"),
          queryMode: searchQueryModeArg(args),
          limit: numberArg(args, "limit", 50)
        });
      case "set_working_memory":
        return setWorkingMemory(db, {
          projectId,
          taskId,
          kind: workingMemoryKindArg(args, "kind"),
          content: stringArg(args, "content")
        });
      case "list_working_memory":
        return listWorkingMemory(db, projectId, taskId);
      case "clear_working_memory":
        clearWorkingMemory(db, projectId, optionalWorkingMemoryKindArg(args, "kind"), taskId);
        return { ok: true };
      case "add_memory":
        return addMemory(db, {
          projectId,
          threadId: optionalStringArg(args, "threadId"),
          title: stringArg(args, "title"),
          kind: memoryKindArg(args, "kind"),
          content: stringArg(args, "content"),
          source: stringArg(args, "source"),
          actor: "mcp",
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
      case "submit_memory_candidates":
        return {
          results: submitMemoryCandidates(db, {
            projectId,
            threadId: stringArg(args, "threadId"),
            sourceAgent: stringArg(args, "sourceAgent"),
            sourceModel: optionalStringArg(args, "sourceModel"),
            extractionMethod: "agent",
            candidates: args.candidates as MemoryCandidateInput[]
          })
        };
      case "list_memory_candidates":
        return {
          candidates: listMemoryCandidates(
            db,
            projectId,
            optionalStringArg(args, "status") as (typeof CANDIDATE_STATUSES)[number] | undefined,
            numberArg(args, "limit", 50)
          )
        };
      case "review_memory_candidate":
        return reviewMemoryCandidate(
          db,
          projectId,
          stringArg(args, "candidateId"),
          stringArg(args, "decision") as "accept" | "reject",
          optionalStringArg(args, "reason"),
          optionalStringArg(args, "supersedesMemoryId")
        );
      case "get_memory": {
        const memory = getMemory(db, projectId, stringArg(args, "memoryId"));
        if (!memory) throw new Error(`Memory not found: ${stringArg(args, "memoryId")}`);
        return memory;
      }
      case "update_memory":
        return updateMemory(db, {
          projectId,
          memoryId: stringArg(args, "memoryId"),
          content: stringArg(args, "content"),
          title: optionalStringArg(args, "title"),
          kind: optionalMemoryKindArg(args, "kind"),
          confidence: typeof args.confidence === "number" ? args.confidence : undefined,
          importance: typeof args.importance === "number" ? args.importance : undefined,
          source: optionalStringArg(args, "source"),
          actor: "mcp",
          reason: optionalStringArg(args, "reason")
        });
      case "archive_memory":
        return archiveMemory(
          db, projectId, stringArg(args, "memoryId"), "mcp", optionalStringArg(args, "reason")
        );
      case "get_memory_history":
        return getMemoryHistory(db, projectId, stringArg(args, "memoryId"));
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
  const session = { db, projectId: project.id, taskId: options.taskId ?? repositoryLocation(options.projectRoot).workspaceTaskId };
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
