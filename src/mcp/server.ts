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
} from "../distill/candidateService.js";
import { CANDIDATE_STATUSES, type MemoryCandidateInput } from "../distill/candidateTypes.js";
import { MEMORY_KINDS, searchMemories, type MemoryKind } from "../memory/memoryStore.js";
import { getMemory, getMemoryHistory } from "../memory/memoryLifecycleStore.js";
import { authorizeCuration, curateMemory, type CurationAuthority, type ConfirmationPolicy } from "../memory/curationService.js";
import { ensureProjectForRoot } from "../projects/projectStore.js";
import { repositoryLocation } from "../projects/projectIdentity.js";
import { createHostAdapterRegistry, MIRA_HOSTS } from "../lifecycle/hostAdapterRegistry.js";
import { createTurnLifecycle } from "../lifecycle/turnLifecycle.js";
import type { ThreadRawFormat } from "../threads/threadStore.js";
import { captureSession } from "../threads/sessionCapture.js";
import {
  clearWorkingMemory,
  listWorkingMemory,
  setWorkingMemory,
  WORKING_MEMORY_KINDS,
  type WorkingMemoryKind
} from "../workingMemory/workingMemoryStore.js";
import {
  authorizeResearch,
  getResearchCaseSnapshot,
  listResearchCases,
  markResearchEvidenceStale,
  reviewResearchClaim,
  reviseResearchClaim,
  submitResearchPacket,
  type ResearchAuthority,
  type ReviseResearchClaimInput,
  type SubmitResearchPacketInput
} from "../research/researchService.js";
import {
  CLAIM_EVIDENCE_RELATIONS,
  CLAIM_EVIDENCE_STATUSES,
  CONTRADICTION_DISPOSITIONS,
  RESEARCH_SOURCE_TYPES,
  THESIS_IMPACTS
} from "../research/researchTypes.js";
import { renderResearchCaseMarkdown } from "../research/researchExport.js";
import { prepareResearchContext } from "../research/researchContext.js";
import { verifyEvidence } from "../research/evidenceVerification.js";

export const MIRA_MCP_TOOL_NAMES = [
  "list_host_adapters",
  "before_turn",
  "after_turn",
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
  "get_memory_history",
  "submit_research_packet",
  "list_research_cases",
  "get_research_case",
  "prepare_research_context",
  "revise_research_claim",
  "verify_research_evidence",
  "mark_research_evidence_stale",
  "review_research_claim",
  "export_research_case"
] as const;

export type MiraMcpToolName = (typeof MIRA_MCP_TOOL_NAMES)[number];

export const MIRA_MCP_TOOL_DESCRIPTIONS = {
  list_host_adapters: "List every Host adapter accepted by the unified Turn Lifecycle Port, including phase support and native granularity.",
  before_turn: "Normalize one Host request, persist its stable Session and Turn, and return one audited Context Packet before execution.",
  after_turn: "Normalize and atomically capture one completed Host Turn, then enqueue candidate distillation and projection work without granting review authority.",
  get_context_bundle: "Use at session start to return one concise Markdown string, not JSON, containing working memory, the latest Project Briefing metadata, and query-relevant memories with an audited receipt.",
  prepare_context: "Prepare bounded context and return { markdown, receipt } with candidate, injected and omitted memory IDs. Preview mode records neither recall nor Briefing writes.",
  list_recall_events: "Inspect recent context injection receipts for the bound project and optional task; receipt means injected, not proven useful.",
  get_project_briefing: "Read or deterministically refresh the bound project's latest derived Briefing; returns { briefing } with Markdown, version, provenance ids, stale state, and size estimates.",
  rebuild_project_briefing: "Force one deterministic rebuild of the bound project's derived Briefing; returns { briefing } while preserving every earlier complete or failed version for audit.",
  search_memory: "Use for targeted historical lookups; defaults to keyword OR matching, supports explicit phrase mode and optional limit, and returns SearchResult[] as { memory: { title, kind, source, confidence, ... }, score }.",
  set_working_memory: "Set or replace one working-memory entry; returns the saved WorkingMemory object for the chosen kind.",
  list_working_memory: "List current working-memory entries with no arguments; returns WorkingMemory[] ordered for resuming active task state.",
  clear_working_memory: "Clear stale working memory for one kind or all kinds; returns { ok: true } after deletion.",
  add_memory: "Requires host confirmation policy (disabled by default). Write a protocol-confirmed memory; automatic inference uses submit_memory_candidates. Returns Memory, de-duplicated by projectId, kind, threadId and content hash.",
  save_thread: "Save an agent-generated session summary; rawFormat must be markdown or jsonl, and the tool returns the Thread object.",
  submit_memory_candidates: "Submit inferred candidates after important work; exact provenance, verbatim content, low risk and confidence gates allow automatic memory acceptance, otherwise require review. Never updates thesis state.",
  list_memory_candidates: "List memory candidates for the bound project, optionally filtered by review status; use this to inspect items awaiting human or Agent confirmation.",
  review_memory_candidate: "Requires host confirmation policy (disabled by default). Accept or reject a pending candidate; acceptance may provide supersedesMemoryId for a traceable successor. Without authority, leave it for local CLI/UI review.",
  get_memory: "Read one Memory by id including inactive lifecycle state, provenance, predecessor link, and timestamps for audit or update preparation.",
  update_memory: "Requires host confirmation policy (disabled by default). Create an immutable active successor and atomically supersede its active predecessor; returns Memory without overwriting history.",
  archive_memory: "Requires host confirmation policy (disabled by default). Archive an active Memory so it leaves search and Context Bundle results while remaining in auditable history.",
  get_memory_history: "Return the complete ordered predecessor-successor chain plus lifecycle events when auditing how a project Memory evolved.",
  submit_research_packet: "Submit one validated draft Research Case with bounded Evidence Items, Claims and explicit links; this never creates Memory or mutates thesis state.",
  list_research_cases: "List project-scoped Research Cases with stable ids, titles, questions, as-of dates and workflow status so a connected caller can select a case without guessing.",
  get_research_case: "Read one complete project-scoped Research Case snapshot with Source Snapshot metadata, Evidence Verification receipts, Claims, links and append-only review events.",
  prepare_research_context: "Return a read-only evidence-gated Research Context containing only active approved Claims backed by current verified supporting Evidence; draft or stale research remains excluded.",
  revise_research_claim: "Requires host confirmation policy. Create an immutable active successor with explicit Evidence links and supersede the predecessor.",
  verify_research_evidence: "Run deterministic integrity, source binding, locator, excerpt, publication and freshness checks against the bound Source Snapshot.",
  mark_research_evidence_stale: "Requires host confirmation policy. Mark current Evidence stale and atomically reopen every linked active Claim for review.",
  review_research_claim: "Requires host confirmation policy. Approve only through the current-support Evidence gate, or reject/request changes with a reason.",
  export_research_case: "Render a deterministic Markdown audit view with Source Snapshot metadata and Evidence Verification receipts, without exposing snapshot content or changing Memory or thesis state."
} satisfies Record<MiraMcpToolName, string>;

export type MiraMcpOptions = {
  /** Trusted host configuration, never a tool argument. Absent means proposal/draft-only governed writes. */
  confirmationPolicy?: ConfirmationPolicy;
  projectRoot: string;
  dbPath: string;
  db?: Database.Database;
  taskId?: string;
};

type ToolArgs = Record<string, unknown>;

export const MIRA_MCP_TOOL_SCHEMAS = {
  list_host_adapters: {},
  before_turn: {
    host: z.enum(MIRA_HOSTS),
    sessionId: z.string().trim().min(1).max(500),
    turnId: z.string().trim().min(1).max(500),
    query: z.string().trim().min(1).max(50_000),
    taskId: z.string().trim().min(1).max(500).optional(),
    context: z.object({
      memoryLimit: z.number().int().min(1).max(50).optional(),
      maxCharacters: z.number().int().min(1).max(1_000_000).optional(),
      maxTokens: z.number().int().min(25).max(250_000).optional()
    }).strict().optional()
  },
  after_turn: {
    host: z.enum(MIRA_HOSTS),
    sessionId: z.string().trim().min(1).max(500),
    turnId: z.string().trim().min(1).max(500),
    query: z.string().trim().min(1).max(50_000),
    response: z.string().trim().min(1).max(50_000),
    status: z.enum(["succeeded", "failed", "cancelled"]),
    taskId: z.string().trim().min(1).max(500).optional()
  },
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
  },
  submit_research_packet: {
    case: z.object({
      title: z.string().trim().min(1).max(500),
      question: z.string().trim().min(1).max(2000),
      asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    }).strict(),
    snapshots: z.array(z.object({
      key: z.string().trim().min(1).max(100),
      canonicalUri: z.url().max(4000),
      sourceTitle: z.string().trim().min(1).max(1000),
      publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      accessedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      mediaType: z.string().trim().min(1).max(200),
      content: z.string().min(1).max(5_000_000)
    }).strict()).min(1).max(100),
    evidence: z.array(z.object({
      key: z.string().trim().min(1).max(100),
      snapshotKey: z.string().trim().min(1).max(100),
      sourceType: z.enum(RESEARCH_SOURCE_TYPES),
      sourceUri: z.url().max(4000),
      sourceTitle: z.string().trim().min(1).max(1000),
      locator: z.string().trim().min(1).max(1000),
      excerpt: z.string().trim().min(1).max(8000),
      publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      accessedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      validThrough: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    }).strict()).min(1).max(100),
    claims: z.array(z.object({
      key: z.string().trim().min(1).max(100),
      statement: z.string().trim().min(1).max(4000),
      evidenceStatus: z.enum(CLAIM_EVIDENCE_STATUSES),
      confidence: z.number().min(0).max(1),
      thesisImpact: z.enum(THESIS_IMPACTS),
      invalidationConditions: z.string().trim().min(1).max(4000),
      links: z.array(z.object({
        evidenceKey: z.string().trim().min(1).max(100),
        relation: z.enum(CLAIM_EVIDENCE_RELATIONS),
        rationale: z.string().trim().min(1).max(2000)
      }).strict()).min(1).max(100)
    }).strict()).min(1).max(100)
  },
  list_research_cases: {},
  get_research_case: {
    caseId: z.string().trim().min(1).max(200)
  },
  prepare_research_context: {
    caseId: z.string().trim().min(1).max(200)
  },
  revise_research_claim: {
    claimId: z.string().trim().min(1).max(200),
    statement: z.string().trim().min(1).max(4000),
    evidenceStatus: z.enum(CLAIM_EVIDENCE_STATUSES),
    confidence: z.number().min(0).max(1),
    thesisImpact: z.enum(THESIS_IMPACTS),
    invalidationConditions: z.string().trim().min(1).max(4000),
    links: z.array(z.object({
      evidenceId: z.string().trim().min(1).max(200),
      relation: z.enum(CLAIM_EVIDENCE_RELATIONS),
      rationale: z.string().trim().min(1).max(2000)
    }).strict()).min(1).max(100),
    reason: z.string().trim().min(1).max(2000)
  },
  verify_research_evidence: {
    caseId: z.string().trim().min(1).max(200),
    evidenceId: z.string().trim().min(1).max(200)
  },
  mark_research_evidence_stale: {
    evidenceId: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(2000)
  },
  review_research_claim: {
    claimId: z.string().trim().min(1).max(200),
    decision: z.enum(["approve", "reject", "request_changes"]),
    reason: z.string().trim().min(1).max(2000),
    contradictionDispositions: z.array(z.object({
      evidenceId: z.string().trim().min(1).max(200),
      disposition: z.enum(CONTRADICTION_DISPOSITIONS),
      rationale: z.string().trim().min(1).max(2000)
    }).strict()).max(100).optional()
  },
  export_research_case: {
    caseId: z.string().trim().min(1).max(200)
  }
} satisfies Record<MiraMcpToolName, Record<string, z.ZodType>>;


type ToolSession = {
  curationAuthority?: CurationAuthority;
  researchAuthority?: ResearchAuthority;
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
    return run({
      db,
      projectId: project.id,
      taskId: options.taskId ?? repositoryLocation(options.projectRoot).workspaceTaskId,
      curationAuthority: options.confirmationPolicy && authorizeCuration(db, project.id, options.confirmationPolicy),
      researchAuthority: options.confirmationPolicy && authorizeResearch(db, project.id, options.confirmationPolicy)
    });
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
      case "list_host_adapters":
        return createHostAdapterRegistry().list();
      case "before_turn": {
        const command = createHostAdapterRegistry().normalizeBeforeTurn(stringArg(args, "host"), {
          sessionId: stringArg(args, "sessionId"),
          turnId: stringArg(args, "turnId"),
          query: stringArg(args, "query"),
          ...(taskId ? {taskId} : {}),
          ...(args.context ? {context: args.context} : {})
        }, "mcp");
        return createTurnLifecycle({db, projectId}).beforeTurn(command);
      }
      case "after_turn": {
        const command = createHostAdapterRegistry().normalizeAfterTurn(stringArg(args, "host"), {
          sessionId: stringArg(args, "sessionId"),
          turnId: stringArg(args, "turnId"),
          query: stringArg(args, "query"),
          response: stringArg(args, "response"),
          status: stringArg(args, "status"),
          ...(taskId ? {taskId} : {})
        }, "mcp");
        return createTurnLifecycle({db, projectId}).afterTurn(command);
      }
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
        return curateMemory(db, {operation: "add", input: {
          projectId,
          threadId: optionalStringArg(args, "threadId"),
          title: stringArg(args, "title"),
          kind: memoryKindArg(args, "kind"),
          content: stringArg(args, "content"),
          source: stringArg(args, "source"),
          actor: "mcp",
          confidence: numberArg(args, "confidence", 1),
          importance: numberArg(args, "importance", 5)
        }}, session.curationAuthority);
      case "save_thread":
        return captureSession(db, {
          id: optionalStringArg(args, "id") ?? `thread_${randomUUID()}`,
          projectId,
          title: stringArg(args, "title"),
          source: stringArg(args, "source"),
          rawFormat: rawFormatArg(args, "rawFormat"),
          rawText: stringArg(args, "rawText")
        }).thread;
      case "submit_memory_candidates":
        return {
          results: curateMemory(db, {operation: "propose", input: {
            projectId,
            threadId: stringArg(args, "threadId"),
            sourceAgent: stringArg(args, "sourceAgent"),
            sourceModel: optionalStringArg(args, "sourceModel"),
            extractionMethod: "agent",
            candidates: args.candidates as MemoryCandidateInput[]
          }})
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
        return curateMemory(db, {operation: "review", projectId, actor: "mcp",
          candidateId: stringArg(args, "candidateId"), decision: stringArg(args, "decision") as "accept" | "reject",
          reason: optionalStringArg(args, "reason"), supersedesMemoryId: optionalStringArg(args, "supersedesMemoryId")}, session.curationAuthority);
      case "get_memory": {
        const memory = getMemory(db, projectId, stringArg(args, "memoryId"));
        if (!memory) throw new Error(`Memory not found: ${stringArg(args, "memoryId")}`);
        return memory;
      }
      case "update_memory":
        return curateMemory(db, {operation: "correct", input: {
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
        }}, session.curationAuthority);
      case "archive_memory":
        return curateMemory(db, {operation: "archive", projectId, memoryId: stringArg(args, "memoryId"), actor: "mcp", reason: optionalStringArg(args, "reason")}, session.curationAuthority);
      case "get_memory_history":
        return getMemoryHistory(db, projectId, stringArg(args, "memoryId"));
      case "submit_research_packet":
        return submitResearchPacket(db, projectId, args as SubmitResearchPacketInput, "mcp");
      case "list_research_cases":
        return listResearchCases(db, projectId);
      case "get_research_case":
        return getResearchCaseSnapshot(db, projectId, stringArg(args, "caseId"));
      case "prepare_research_context":
        return prepareResearchContext(db, projectId, stringArg(args, "caseId"));
      case "revise_research_claim":
        return reviseResearchClaim(db, projectId, stringArg(args, "claimId"), {
          statement: stringArg(args, "statement"),
          evidenceStatus: stringArg(args, "evidenceStatus"),
          confidence: numberArg(args, "confidence", 0),
          thesisImpact: stringArg(args, "thesisImpact"),
          invalidationConditions: stringArg(args, "invalidationConditions"),
          links: args.links
        } as ReviseResearchClaimInput, stringArg(args, "reason"), session.researchAuthority);
      case "verify_research_evidence":
        return verifyEvidence(
          db,
          projectId,
          stringArg(args, "caseId"),
          stringArg(args, "evidenceId")
        );
      case "mark_research_evidence_stale":
        return markResearchEvidenceStale(
          db,
          projectId,
          stringArg(args, "evidenceId"),
          stringArg(args, "reason"),
          session.researchAuthority
        );
      case "review_research_claim":
        return reviewResearchClaim(
          db,
          projectId,
          stringArg(args, "claimId"),
          stringArg(args, "decision") as "approve" | "reject" | "request_changes",
          stringArg(args, "reason"),
          session.researchAuthority,
          (args.contradictionDispositions as never[] | undefined) ?? []
        );
      case "export_research_case":
        return renderResearchCaseMarkdown(
          getResearchCaseSnapshot(db, projectId, stringArg(args, "caseId"))
        );
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
  const session = {
    db,
    projectId: project.id,
    taskId: options.taskId ?? repositoryLocation(options.projectRoot).workspaceTaskId,
    curationAuthority: options.confirmationPolicy && authorizeCuration(db, project.id, options.confirmationPolicy),
    researchAuthority: options.confirmationPolicy && authorizeResearch(db, project.id, options.confirmationPolicy)
  };
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
