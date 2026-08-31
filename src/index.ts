#!/usr/bin/env node
import { Command } from "commander";
import Database from "better-sqlite3";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  ensureFreshProjectBriefing,
  listProjectBriefings,
  rebuildProjectBriefing
} from "./briefing/projectBriefingStore.js";
import { buildContextBundle } from "./context/contextBundle.js";
import { prepareContext } from "./context/contextPreparation.js";
import { listRecallEvents } from "./context/recallAuditStore.js";
import { openDatabase } from "./db/client.js";
import { runDoctor } from "./doctor/doctor.js";
import { migrate } from "./db/schema.js";
import { distillThreadMemories } from "./distill/distillThread.js";
import { startDetachedDistillWorker } from "./distill/detachedWorker.js";
import {
  listMemoryCandidates
} from "./distill/candidateService.js";
import { CANDIDATE_STATUSES, type CandidateStatus } from "./distill/candidateTypes.js";
import {
  DISTILL_JOB_STATUSES,
  enqueueDistillJob,
  listDistillJobs,
  retryDistillJob,
  type DistillJobStatus
} from "./distill/distillJobStore.js";
import { drainDistillJobs, runNextDistillJob } from "./distill/distillWorker.js";
import {
  applyLlmDistillCandidates,
  buildLlmDistillPromptForThread,
  parseLlmMemoryCandidates
} from "./distill/llmDistill.js";
import {
  createOpenAiCompatibleProvider,
  providerConfigFromEnv
} from "./distill/openAiCompatibleProvider.js";
import { exportProject, type ExportFormat } from "./export/exportProject.js";
import { importAgentSessionFromFile } from "./importers/agentSessionImporter.js";
import { importProjectHistory, type HistoryImportFilters } from "./history/historyImportService.js";
import {
  listHistoryImportFailures,
  listHistoryImportRuns,
  sanitizeHistoryImportError
} from "./history/historyImportStore.js";
import { writeHistoryImportReport } from "./history/historyReport.js";
import type { HistoryAgent } from "./history/historyTypes.js";
import {
  getIntegrationStatus,
  installAgentIntegration,
  uninstallAgentIntegration,
  type IntegrationAgent,
  type IntegrationAgentTarget,
  type IntegrationRuntime
} from "./integrations/configInstaller.js";
import { runIntegrationHook } from "./integrations/hookRuntime.js";
import { clearMemoriesForThread, MEMORY_KINDS, searchMemories, type MemoryKind } from "./memory/memoryStore.js";
import { authorizeCuration, curateMemory, listCurationEvents } from "./memory/curationService.js";
import {
  getMemory,
  getMemoryHistory
} from "./memory/memoryLifecycleStore.js";
import { detectProjectRootWithFallback } from "./projects/projectRoot.js";
import { defaultProjectDatabase, repositoryLocation } from "./projects/projectIdentity.js";
import {
  createProject,
  bindProjectRoot,
  deleteProject,
  ensureProjectForRoot,
  findProjectByRoot,
  listProjects,
  type Project
} from "./projects/projectStore.js";
import { serveMiraMcpStdio } from "./mcp/transport.js";
import { deleteThread } from "./threads/threadStore.js";
import { captureSession } from "./threads/sessionCapture.js";
import {
  clearWorkingMemory,
  listWorkingMemory,
  setWorkingMemory,
  WORKING_MEMORY_KINDS,
  type WorkingMemoryKind
} from "./workingMemory/workingMemoryStore.js";
import { syncMarkdownVault } from "./vault/markdownVault.js";
import { startViewerServer } from "./ui/viewerServer.js";

type GlobalOptions = {
  db?: string;
  projectRoot?: string;
  task?: string;
};

type ProjectSession = {
  db: Database.Database;
  dbPath: string;
  projectRoot: string;
  project: Project;
};

const program = new Command();

function cliAuthority(session: ProjectSession) {
  return authorizeCuration(session.db, session.project.id, {actor: "cli", reason: "Explicit local CLI memory operation"});
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value));
}


async function resolveProjectRoot(options: GlobalOptions): Promise<string> {
  if (options.projectRoot) {
    return resolve(options.projectRoot);
  }

  const detection = await detectProjectRootWithFallback(process.cwd());
  if (detection.fellBack) {
    console.error(`No .git root found from ${process.cwd()}; using current directory as project root.`);
  }
  return detection.rootPath;
}

function resolveDbPath(projectRoot: string, options: GlobalOptions): string {
  return resolve(options.db ?? defaultProjectDatabase(projectRoot));
}

function selectedTask(projectRoot: string): string | undefined {
  return program.opts<GlobalOptions>().task ?? repositoryLocation(projectRoot).workspaceTaskId;
}

function openMigratedDatabase(dbPath: string): Database.Database {
  const db = openDatabase(dbPath);
  migrate(db);
  return db;
}

async function withDatabase<T>(
  options: GlobalOptions,
  run: (db: Database.Database, dbPath: string, projectRoot: string) => Promise<T> | T
): Promise<T> {
  const projectRoot = await resolveProjectRoot(options);
  const dbPath = resolveDbPath(projectRoot, options);
  const db = openMigratedDatabase(dbPath);

  try {
    return await run(db, dbPath, projectRoot);
  } finally {
    db.close();
  }
}

async function withProject<T>(
  options: GlobalOptions,
  run: (session: ProjectSession) => Promise<T> | T
): Promise<T> {
  return withDatabase(options, async (db, dbPath, projectRoot) => {
    const project = ensureProjectForRoot(db, projectRoot);
    return run({ db, dbPath, projectRoot, project });
  });
}

async function withHistoryProject<T>(
  options: GlobalOptions,
  dryRun: boolean,
  run: (session: ProjectSession) => Promise<T> | T
): Promise<T> {
  if (!dryRun) return withProject(options, run);

  const projectRoot = await resolveProjectRoot(options);
  const dbPath = resolveDbPath(projectRoot, options);
  try {
    await access(dbPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const db = openDatabase(":memory:");
    try {
      migrate(db);
      const project = ensureProjectForRoot(db, projectRoot);
      return await run({ db, dbPath, projectRoot, project });
    } finally {
      db.close();
    }
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "mira-history-dry-run-"));
  const snapshotPath = join(temporaryRoot, "mira.sqlite");
  let source: Database.Database | undefined;
  try {
    source = new Database(dbPath, { readonly: true, fileMustExist: true });
    await source.backup(snapshotPath);
    source.close();
    source = undefined;

    const db = openMigratedDatabase(snapshotPath);
    try {
      const project = ensureProjectForRoot(db, projectRoot);
      return await run({ db, dbPath, projectRoot, project });
    } finally {
      db.close();
    }
  } finally {
    source?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function requireNonEmpty(value: string | undefined, label: string): string {
  if (value === undefined || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function numberInRange(value: string, min: number, max: number, label: string): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < min || numberValue > max) {
    throw new Error(`${label} must be a number from ${min} to ${max}`);
  }
  return numberValue;
}

function dateStartMs(value: string, label: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid calendar date`);
  }
  return ms;
}

function historyImportFilters(options: {
  since?: string; until?: string; maxFileSize?: string; limit?: string;
}): HistoryImportFilters | undefined {
  const filters: HistoryImportFilters = {};
  if (options.since) filters.sinceMs = dateStartMs(options.since, "--since");
  if (options.until) filters.untilExclusiveMs = dateStartMs(options.until, "--until") + 24 * 60 * 60 * 1000;
  if (filters.sinceMs !== undefined && filters.untilExclusiveMs !== undefined && filters.sinceMs >= filters.untilExclusiveMs) {
    throw new Error("--since must be on or before --until");
  }
  if (options.maxFileSize) {
    filters.maxFileSizeBytes = Math.floor(
      numberInRange(options.maxFileSize, 0.000001, 1_000_000, "--max-file-size") * 1024 * 1024
    );
  }
  if (options.limit) filters.limit = integerInRange(options.limit, 1, 1_000_000, "--limit");
  return Object.keys(filters).length > 0 ? filters : undefined;
}

function requireMemoryKind(kind: string): MemoryKind {
  if (!(MEMORY_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Memory kind is unsupported: ${kind}. Supported kinds: ${MEMORY_KINDS.join(", ")}`);
  }
  return kind as MemoryKind;
}

function requireWorkingMemoryKind(kind: string): WorkingMemoryKind {
  if (!(WORKING_MEMORY_KINDS as readonly string[]).includes(kind)) {
    throw new Error(
      `Working memory kind is unsupported: ${kind}. Supported kinds: ${WORKING_MEMORY_KINDS.join(", ")}`
    );
  }
  return kind as WorkingMemoryKind;
}

function requireHistoryAgents(agent: string): HistoryAgent[] {
  if (agent === "all") return ["codex", "claude-code"];
  if (agent === "codex" || agent === "claude-code") return [agent];
  throw new Error("History agent must be all, codex, or claude-code");
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function integerInRange(value: string, min: number, max: number, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function requireDistillJobStatus(status: string): DistillJobStatus {
  if (!(DISTILL_JOB_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Distill job status is unsupported: ${status}. Supported statuses: ${DISTILL_JOB_STATUSES.join(", ")}`);
  }
  return status as DistillJobStatus;
}

function requireCandidateStatus(status: string): CandidateStatus {
  if (!(CANDIDATE_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Candidate status is unsupported: ${status}. Supported statuses: ${CANDIDATE_STATUSES.join(", ")}`);
  }
  return status as CandidateStatus;
}

function requireReviewDecision(decision: string): "accept" | "reject" {
  if (decision !== "accept" && decision !== "reject") {
    throw new Error("Candidate review decision must be accept or reject");
  }
  return decision;
}

function requireRawFormat(rawFormat: string): "markdown" | "jsonl" {
  if (rawFormat !== "markdown" && rawFormat !== "jsonl") {
    throw new Error("Thread raw format must be markdown or jsonl");
  }
  return rawFormat;
}

function requireIntegrationAgentTarget(agent: string): IntegrationAgentTarget {
  if (agent !== "codex" && agent !== "claude-code" && agent !== "all") {
    throw new Error("Integration agent must be codex, claude-code, or all");
  }
  return agent;
}

function requireIntegrationAgent(agent: string): IntegrationAgent {
  const target = requireIntegrationAgentTarget(agent);
  if (target === "all") {
    throw new Error("Integration hook agent must be codex or claude-code");
  }
  return target;
}

function integrationRuntime(): IntegrationRuntime {
  const currentEntry = fileURLToPath(import.meta.url);
  return {
    nodePath: process.execPath,
    entryPath: currentEntry.endsWith(".ts")
      ? resolve(dirname(currentEntry), "../dist/src/index.js")
      : currentEntry
  };
}

async function enqueueHookDistill(input: {
  projectId: string;
  threadId: string;
  projectRoot: string;
  dbPath: string;
}): Promise<void> {
  const db = openMigratedDatabase(input.dbPath);
  try {
    enqueueDistillJob(db, input.projectId, input.threadId, "hook");
  } finally {
    db.close();
  }

  await resumeHookDistill(input);
}

async function resumeHookDistill(input: {projectRoot: string; dbPath: string}): Promise<void> {
  const runtime = integrationRuntime();
  await startDetachedDistillWorker({
    nodePath: runtime.nodePath,
    entryPath: runtime.entryPath,
    dbPath: input.dbPath,
    projectRoot: input.projectRoot,
    env: process.env
  });
}

async function readStdinJson(): Promise<unknown> {
  const chunks: string[] = [];
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = chunks.join("").trim();
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function commandPathFromArgs(args: string[]): string {
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("-")) {
      if (!arg.includes("=") && args[index + 1] && !args[index + 1].startsWith("-")) {
        index += 1;
      }
      continue;
    }
    positional.push(arg);
  }
  const path = positional.slice(0, 2).join(" ");
  return path || "help";
}

program
  .name("mira")
  .description("Local project memory for coding agents")
  .version("0.1.0")
  .option("--db <path>", "SQLite database path")
  .option("--project-root <path>", "Project root path")
  .option("--task <id>", "Isolate transient working state for this task");

program
  .command("health")
  .description("Check that Mira is installed")
  .action(() => {
    console.log("mira:ok");
  });

program
  .command("init")
  .description("Initialize Mira for the current project")
  .action(async () => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson({ ok: true, dbPath: session.dbPath, project: session.project });
    });
  });

const project = program.command("project").description("Manage Mira projects");

project.command("bind")
  .description("Explicitly bind a moved project root without changing its project ID")
  .requiredOption("--id <id>", "Existing project ID")
  .requiredOption("--root <path>", "New root path")
  .action(async (options: { id: string; root: string }) => {
    await withDatabase(program.opts<GlobalOptions>(), (db) => printJson(bindProjectRoot(db, options.id, options.root)));
  });

project
  .command("add")
  .description("Add or return a project record")
  .requiredOption("--name <name>", "Project name")
  .option("--root <path>", "Project root path")
  .action(async (options: { name: string; root?: string }) => {
    await withDatabase(program.opts<GlobalOptions>(), async (db) => {
      const rootPath = resolve(options.root ?? (await resolveProjectRoot(program.opts<GlobalOptions>())));
      const existing = findProjectByRoot(db, rootPath);
      printJson(existing ?? createProject(db, { name: options.name, rootPath }));
    });
  });

project
  .command("list")
  .description("List project records")
  .action(async () => {
    await withDatabase(program.opts<GlobalOptions>(), (db) => {
      printJson(listProjects(db));
    });
  });

project
  .command("delete")
  .description("Permanently erase a project and all local Mira data for privacy")
  .requiredOption("--id <id>", "Project id")
  .requiredOption("--confirm-hard-delete", "Confirm irreversible privacy deletion")
  .action(async (options: { id: string }) => {
    await withDatabase(program.opts<GlobalOptions>(), (db) => {
      deleteProject(db, options.id);
      printJson({ ok: true });
    });
  });

const thread = program.command("thread").description("Manage saved threads");

thread
  .command("save")
  .description("Save or update a thread summary")
  .requiredOption("--id <id>", "Thread id")
  .requiredOption("--title <title>", "Thread title")
  .requiredOption("--source <source>", "Thread source")
  .option("--format <format>", "Raw format")
  .option("--raw-format <format>", "Alias for --format")
  .option("--text <text>", "Raw text or summary")
  .option("--file <path>", "Read raw text from a file")
  .action(async (options: {
    id: string;
    title: string;
    source: string;
    format?: string;
    rawFormat?: string;
    text?: string;
    file?: string;
  }) => {
    const rawFormatValue = options.format ?? options.rawFormat;
    if (!rawFormatValue) {
      throw new Error("Thread raw format is required via --format or --raw-format");
    }
    const rawFormat = requireRawFormat(rawFormatValue);

    const rawText = requireNonEmpty(
      options.text ?? (options.file ? await readFile(resolve(options.file), "utf8") : undefined),
      "Thread raw text"
    );

    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(
        captureSession(session.db, {
          id: options.id,
          projectId: session.project.id,
          title: options.title,
          source: options.source,
          rawFormat,
          rawText
        }).thread
      );
    });
  });

thread
  .command("delete")
  .description("Permanently erase a thread and all linked memories for privacy")
  .requiredOption("--id <id>", "Thread id")
  .requiredOption("--confirm-hard-delete", "Confirm irreversible privacy deletion")
  .action(async (options: { id: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      deleteThread(session.db, session.project.id, options.id);
      printJson({ ok: true });
    });
  });

const memory = program.command("memory").description("Manage long-term memory");

memory.command("audit").description("List confirmed memory operation authority and outcomes")
  .option("--limit <number>", "Maximum audit events", "50")
  .action(async (options: {limit: string}) => {
    await withProject(program.opts<GlobalOptions>(), session => {
      printJson(listCurationEvents(session.db, session.project.id, numberInRange(options.limit, 1, 100, "limit")));
    });
  });

memory
  .command("add")
  .description("Add a memory manually")
  .requiredOption("--title <title>", "Memory title")
  .requiredOption("--kind <kind>", "Memory kind")
  .requiredOption("--content <content>", "Memory content")
  .requiredOption("--source <source>", "Memory source")
  .option("--thread <id>", "Source thread id")
  .option("--thread-id <id>", "Source thread id")
  .option("--confidence <number>", "Confidence", "1")
  .option("--importance <number>", "Importance", "5")
  .action(
    async (options: {
      title: string;
      kind: MemoryKind;
      content: string;
      source: string;
      thread?: string;
      threadId?: string;
      confidence: string;
      importance: string;
    }) => {
      const content = requireNonEmpty(options.content, "Memory content");
      const kind = requireMemoryKind(options.kind);
      const confidence = numberInRange(options.confidence, 0, 1, "confidence");
      const importance = numberInRange(options.importance, 1, 10, "importance");

      await withProject(program.opts<GlobalOptions>(), (session) => {
        printJson(
          curateMemory(session.db, {operation: "add", input: {
            projectId: session.project.id,
            threadId: options.threadId ?? options.thread,
            title: options.title,
            kind,
            content,
            source: options.source,
            actor: "cli",
            confidence,
            importance
          }}, cliAuthority(session))
        );
      });
    }
  );

memory
  .command("search")
  .description("Search memories")
  .argument("[query]", "Search query")
  .option("--query <query>", "Search query")
  .action(async (query: string | undefined, options: { query?: string }) => {
    const resolvedQuery = options.query ?? query;
    if (!resolvedQuery) {
      throw new Error("Search query is required as an argument or --query");
    }

    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(searchMemories(session.db, session.project.id, resolvedQuery));
    });
  });

memory
  .command("distill")
  .description("Distill memories from a saved thread")
  .requiredOption("--thread <id>", "Thread id")
  .action(async (options: { thread: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(distillThreadMemories(session.db, session.project.id, options.thread, cliAuthority(session)));
    });
  });

memory
  .command("clear")
  .description("Permanently erase all memories linked to a thread for privacy")
  .requiredOption("--thread <id>", "Thread id")
  .requiredOption("--confirm-hard-delete", "Confirm irreversible privacy deletion")
  .action(async (options: { thread: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      clearMemoriesForThread(session.db, session.project.id, options.thread);
      printJson({ ok: true });
    });
  });

memory
  .command("get")
  .description("Get a Memory by id, including inactive history")
  .requiredOption("--id <id>", "Memory id")
  .action(async (options: { id: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      const found = getMemory(session.db, session.project.id, options.id);
      if (!found) throw new Error(`Memory not found: ${options.id}`);
      printJson(found);
    });
  });

memory
  .command("update")
  .description("Create an immutable successor for an active Memory")
  .requiredOption("--id <id>", "Predecessor Memory id")
  .requiredOption("--content <content>", "Successor content")
  .option("--title <title>", "Successor title")
  .option("--kind <kind>", "Successor Memory kind")
  .option("--confidence <number>", "Successor confidence")
  .option("--importance <number>", "Successor importance")
  .option("--source <source>", "Successor source")
  .option("--reason <reason>", "Update reason")
  .action(async (options: {
    id: string; content: string; title?: string; kind?: string; confidence?: string;
    importance?: string; source?: string; reason?: string;
  }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(curateMemory(session.db, {operation: "correct", input: {
        projectId: session.project.id,
        memoryId: options.id,
        content: options.content,
        title: options.title,
        kind: options.kind ? requireMemoryKind(options.kind) : undefined,
        confidence: options.confidence ? numberInRange(options.confidence, 0, 1, "confidence") : undefined,
        importance: options.importance ? numberInRange(options.importance, 1, 10, "importance") : undefined,
        source: options.source,
        actor: "cli",
        reason: options.reason
      }}, cliAuthority(session)));
    });
  });

memory
  .command("archive")
  .description("Archive an active Memory")
  .requiredOption("--id <id>", "Memory id")
  .option("--reason <reason>", "Archive reason")
  .action(async (options: { id: string; reason?: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(curateMemory(session.db, {operation: "archive", projectId: session.project.id, memoryId: options.id, actor: "cli", reason: options.reason}, cliAuthority(session)));
    });
  });

memory
  .command("restore")
  .description("Restore an archived Memory without an active successor")
  .requiredOption("--id <id>", "Memory id")
  .option("--reason <reason>", "Restore reason")
  .action(async (options: { id: string; reason?: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(curateMemory(session.db, {operation: "restore", projectId: session.project.id, memoryId: options.id, actor: "cli", reason: options.reason}, cliAuthority(session)));
    });
  });

memory
  .command("history")
  .description("Read a Memory successor chain and event history")
  .requiredOption("--id <id>", "Memory id")
  .action(async (options: { id: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(getMemoryHistory(session.db, session.project.id, options.id));
    });
  });

memory
  .command("llm-prompt")
  .description("Print a reviewable LLM distill prompt for a saved thread")
  .requiredOption("--thread <id>", "Thread id")
  .action(async (options: { thread: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      process.stdout.write(buildLlmDistillPromptForThread(session.db, session.project.id, options.thread));
    });
  });

memory
  .command("apply-candidates")
  .description("Apply reviewed LLM memory candidates from JSON")
  .requiredOption("--thread <id>", "Thread id")
  .requiredOption("--path <path>", "Candidate JSON file path")
  .action(async (options: { thread: string; path: string }) => {
    await withProject(program.opts<GlobalOptions>(), async (session) => {
      const rawCandidates = await readFile(resolve(options.path), "utf8");
      printJson(
        applyLlmDistillCandidates(
          session.db,
          session.project.id,
          options.thread,
          parseLlmMemoryCandidates(rawCandidates),
          cliAuthority(session)
        )
      );
    });
  });

const memoryCandidate = memory.command("candidate").description("Review trusted memory candidates");

memoryCandidate
  .command("list")
  .description("List memory candidates")
  .option("--status <status>", "pending_review, accepted, or rejected")
  .option("--limit <number>", "Maximum candidates", "50")
  .action(async (options: { status?: string; limit: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(listMemoryCandidates(
        session.db,
        session.project.id,
        options.status ? requireCandidateStatus(options.status) : undefined,
        numberInRange(options.limit, 1, 100, "limit")
      ));
    });
  });

memoryCandidate
  .command("review")
  .description("Accept or reject a pending memory candidate")
  .requiredOption("--id <id>", "Candidate id")
  .requiredOption("--decision <decision>", "accept or reject")
  .option("--reason <reason>", "Review reason")
  .option("--supersedes <id>", "Active Memory replaced by this candidate; valid only with accept")
  .action(async (options: { id: string; decision: string; reason?: string; supersedes?: string }) => {
    const decision = requireReviewDecision(options.decision);
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(curateMemory(session.db, {operation: "review", projectId: session.project.id, candidateId: options.id,
        decision, actor: "cli", reason: options.reason, supersedesMemoryId: options.supersedes}, cliAuthority(session)));
    });
  });

const distill = program.command("distill").description("Manage trusted automatic distillation");
const distillJobs = distill.command("jobs").description("Manage distillation jobs");

distillJobs
  .command("enqueue")
  .description("Enqueue the current version of a saved Thread")
  .requiredOption("--thread <id>", "Thread id")
  .action(async (options: { thread: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(enqueueDistillJob(session.db, session.project.id, options.thread, "cli"));
    });
  });

distillJobs
  .command("list")
  .description("List distillation jobs")
  .option("--status <status>", "pending, running, completed, or failed")
  .option("--limit <number>", "Maximum jobs", "100")
  .action(async (options: { status?: string; limit: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(listDistillJobs(
        session.db,
        session.project.id,
        options.status ? requireDistillJobStatus(options.status) : undefined,
        numberInRange(options.limit, 1, 100, "limit")
      ));
    });
  });

distillJobs
  .command("run")
  .description("Run pending distillation work with expired-lease recovery")
  .option("--once", "Run one job and exit (default)")
  .option("--drain", "Drain pending work and scheduled retries before exiting")
  .action(async (options: {once?: boolean; drain?: boolean}) => {
    if (options.once && options.drain) throw new Error("Choose --once or --drain");
    const config = providerConfigFromEnv(process.env);
    if (!config) {
      throw new Error("Provider is not configured; set MIRA_LLM_BASE_URL and MIRA_LLM_MODEL");
    }
    await withProject(program.opts<GlobalOptions>(), async (session) => {
      printJson(await (options.drain ? drainDistillJobs : runNextDistillJob)(
        session.db,
        session.project.id,
        createOpenAiCompatibleProvider(config),
        config.model
      ));
    });
  });

distillJobs
  .command("retry")
  .description("Retry a failed or interrupted distillation job")
  .requiredOption("--id <id>", "Distillation job id")
  .action(async (options: { id: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(retryDistillJob(session.db, session.project.id, options.id));
    });
  });

function registerWorkingCommands(parent: Command): void {
  parent
  .command("set")
  .description("Set working memory")
  .requiredOption("--kind <kind>", "Working memory kind")
  .requiredOption("--content <content>", "Working memory content")
  .action(async (options: { kind: string; content: string }) => {
    const kind = requireWorkingMemoryKind(options.kind);

    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(
        setWorkingMemory(session.db, {
          projectId: session.project.id,
          taskId: selectedTask(session.projectRoot),
          kind,
          content: options.content
        })
      );
    });
  });

  parent
  .command("list")
  .description("List working memory")
  .action(async () => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(listWorkingMemory(session.db, session.project.id, selectedTask(session.projectRoot)));
    });
  });

  parent
  .command("clear")
  .description("Clear working memory")
  .option("--kind <kind>", "Working memory kind")
  .action(async (options: { kind?: string }) => {
    const kind = options.kind ? requireWorkingMemoryKind(options.kind) : undefined;

    await withProject(program.opts<GlobalOptions>(), (session) => {
      clearWorkingMemory(session.db, session.project.id, kind, selectedTask(session.projectRoot));
      printJson({ ok: true });
    });
  });
}

const working = program.command("working").description("Manage working memory");
registerWorkingCommands(working);

const wm = program.command("wm").description("Alias for working memory commands");
registerWorkingCommands(wm);

const briefing = program.command("briefing").description("Manage derived Project Briefings");

briefing
  .command("show")
  .description("Show the latest fresh or fallback Project Briefing")
  .action(async () => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(ensureFreshProjectBriefing(session.db, session.project.id) ?? null);
    });
  });

briefing
  .command("rebuild")
  .description("Force one deterministic Project Briefing rebuild")
  .action(async () => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(rebuildProjectBriefing(session.db, session.project.id));
    });
  });

briefing
  .command("history")
  .description("List Project Briefing versions newest first")
  .option("--limit <number>", "Maximum Briefing versions", "20")
  .action(async (options: { limit: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(listProjectBriefings(
        session.db,
        session.project.id,
        numberInRange(options.limit, 1, 100, "limit")
      ));
    });
  });

const context = program.command("context").description("Generate agent context");

context.command("prepare")
  .description("Return bounded context and its recall receipt as JSON")
  .option("--query <query>", "Memory search query")
  .option("--memory-limit <number>", "Maximum durable memories", "8")
  .option("--max-characters <number>", "Maximum output characters")
  .option("--max-tokens <number>", "Conservative UTF-8 byte token upper bound")
  .option("--preview", "Do not record recall or refresh Briefing")
  .action(async (options) => {
    await withProject(program.opts<GlobalOptions>(), session => {
      printJson(prepareContext(session.db, session.project.id, {
        taskId: selectedTask(session.projectRoot), query: options.query,
        memoryLimit: numberInRange(options.memoryLimit, 1, 50, "memoryLimit"),
        maxCharacters: options.maxCharacters ? numberInRange(options.maxCharacters, 1, 1_000_000, "maxCharacters") : undefined,
        maxTokens: options.maxTokens ? numberInRange(options.maxTokens, 25, 250_000, "maxTokens") : undefined,
        recordAudit: !options.preview
      }));
    });
  });

context.command("recalls")
  .description("List recent recall receipts for this project/task")
  .option("--limit <number>", "Maximum receipts", "20")
  .action(async (options) => {
    await withProject(program.opts<GlobalOptions>(), session => {
      printJson(listRecallEvents(session.db, session.project.id, {
        taskId: selectedTask(session.projectRoot), limit: numberInRange(options.limit, 1, 100, "limit")
      }));
    });
  });

context
  .command("bundle")
  .description("Build a Markdown context bundle")
  .option("--query <query>", "Memory search query")
  .option("--memory-limit <number>", "Maximum durable memories", "8")
  .option("--max-characters <number>", "Maximum output characters")
  .option("--max-tokens <number>", "Approximate output token budget")
  .action(async (options: {
    query?: string; memoryLimit: string; maxCharacters?: string; maxTokens?: string;
  }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      const memoryLimit = numberInRange(options.memoryLimit, 1, 50, "memoryLimit");
      const maxCharacters = options.maxCharacters
        ? numberInRange(options.maxCharacters, 1, 1_000_000, "maxCharacters")
        : undefined;
      const maxTokens = options.maxTokens
        ? numberInRange(options.maxTokens, 25, 250_000, "maxTokens")
        : undefined;
      process.stdout.write(
        buildContextBundle(session.db, session.project.id, {
          taskId: selectedTask(session.projectRoot),
          query: options.query,
          memoryLimit,
          maxCharacters,
          maxTokens
        })
      );
    });
  });

const vault = program.command("vault").description("Materialize the project memory as Markdown");

vault
  .command("sync")
  .description("Deterministically rebuild the Obsidian-ready Markdown Vault")
  .option("--out <path>", "Output directory, relative to the project root")
  .action(async (options: { out?: string }) => {
    await withProject(program.opts<GlobalOptions>(), async (session) => {
      const outputPath = options.out
        ? resolve(session.projectRoot, options.out)
        : join(session.projectRoot, ".mira", "vault");
      printJson(await syncMarkdownVault(session.db, session.project, outputPath));
    });
  });


const mcp = program.command("mcp").description("Run the Mira MCP server");

mcp
  .command("serve")
  .description("Start the Mira MCP stdio server")
  .option("--confirmation-policy <reason>", "Explicitly delegate formal memory writes to this trusted protocol (disabled by default)")
  .option("--db <path>", "SQLite database path")
  .option("--project-root <path>", "Project root path")
  .action(async (options: GlobalOptions & {confirmationPolicy?: string}) => {
    const mergedOptions = { ...program.opts<GlobalOptions>(), ...options };
    const projectRoot = await resolveProjectRoot(mergedOptions);
    const dbPath = resolveDbPath(projectRoot, mergedOptions);
    await serveMiraMcpStdio({ projectRoot, dbPath, taskId: mergedOptions.task,
      confirmationPolicy: options.confirmationPolicy === undefined ? undefined : {actor: "mcp:protocol", reason: options.confirmationPolicy} });
  });

const integration = program.command("integration").description("Manage automatic coding-agent integration");

integration
  .command("install")
  .description("Install project-local Codex and/or Claude Code hooks and MCP configuration")
  .requiredOption("--agent <agent>", "codex, claude-code, or all")
  .option("--dry-run", "Preview changes without writing files", false)
  .action(async (options: { agent: string; dryRun: boolean }) => {
    const globalOptions = program.opts<GlobalOptions>();
    const projectRoot = await resolveProjectRoot(globalOptions);
    const dbPath = resolveDbPath(projectRoot, globalOptions);
    printJson(
      await installAgentIntegration({
        agent: requireIntegrationAgentTarget(options.agent),
        projectRoot,
        dbPath,
        runtime: integrationRuntime(),
        dryRun: options.dryRun
      })
    );
  });

integration
  .command("status")
  .description("Show project-local Codex and Claude Code integration status")
  .action(async () => {
    const projectRoot = await resolveProjectRoot(program.opts<GlobalOptions>());
    printJson(await getIntegrationStatus(projectRoot));
  });

integration
  .command("uninstall")
  .description("Remove only Mira-managed project integration entries")
  .requiredOption("--agent <agent>", "codex, claude-code, or all")
  .option("--dry-run", "Preview changes without writing files", false)
  .action(async (options: { agent: string; dryRun: boolean }) => {
    const projectRoot = await resolveProjectRoot(program.opts<GlobalOptions>());
    printJson(
      await uninstallAgentIntegration({
        agent: requireIntegrationAgentTarget(options.agent),
        projectRoot,
        runtime: integrationRuntime(),
        dryRun: options.dryRun
      })
    );
  });

integration
  .command("hook")
  .description("Run a Mira lifecycle hook for Codex or Claude Code")
  .requiredOption("--agent <agent>", "codex or claude-code")
  .option("--managed-by <owner>", "Integration owner marker")
  .action(async (options: { agent: string; managedBy?: string }) => {
    const globalOptions = program.opts<GlobalOptions>();
    const projectRoot = await resolveProjectRoot(globalOptions);
    const dbPath = resolveDbPath(projectRoot, globalOptions);
    const result = await runIntegrationHook(
      {
        agent: requireIntegrationAgent(options.agent),
        projectRoot,
        dbPath,
        onThreadCaptured: providerConfigFromEnv(process.env) ? enqueueHookDistill : undefined,
        onSessionStarted: providerConfigFromEnv(process.env) ? resumeHookDistill : undefined
      },
      await readStdinJson()
    );
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
  });

program
  .command("doctor")
  .description("Report Mira database, project, and coding-agent integration status without mutating files")
  .action(async () => {
    const globalOptions = program.opts<GlobalOptions>();
    const projectRoot = await resolveProjectRoot(globalOptions);
    const dbPath = resolveDbPath(projectRoot, globalOptions);
    printJson(await runDoctor({ projectRoot, dbPath }));
  });

program
  .command("ui")
  .description("Start the local Mira memory management viewer")
  .option("--host <host>", "Loopback host to bind", "127.0.0.1")
  .option("--port <port>", "Port to bind", "4317")
  .action(async (options: { host: string; port: string }) => {
    const globalOptions = program.opts<GlobalOptions>();
    const projectRoot = await resolveProjectRoot(globalOptions);
    const dbPath = resolveDbPath(projectRoot, globalOptions);
    const server = await startViewerServer({
      projectRoot,
      dbPath,
      host: options.host,
      port: integerInRange(options.port, 0, 65_535, "UI port")
    });
    printJson({
      url: server.url,
      host: server.host,
      port: server.port,
      projectRoot,
      dbPath
    });
  });

program
  .command("export")
  .description("Export project memory as Markdown or JSON")
  .requiredOption("--format <format>", "Export format: json or markdown")
  .requiredOption("--out <path>", "Output directory")
  .action(async (options: { format: ExportFormat; out: string }) => {
    if (options.format !== "json" && options.format !== "markdown") {
      throw new Error("Export format must be json or markdown");
    }

    await withProject(program.opts<GlobalOptions>(), async (session) => {
      printJson(await exportProject(session.db, session.project.id, options.format, options.out));
    });
  });

const history = program.command("history").description("Scan and import local coding-agent history");

history
  .command("import")
  .description("Import Codex and Claude Code history belonging to the current project")
  .option("--agent <agent>", "History source: all, codex, or claude-code", "all")
  .option("--root-alias <path>", "Explicit historical project root; repeat for multiple aliases", collectOption, [])
  .option("--dry-run", "Scan, parse, and classify without writing Mira data")
  .option("--distill", "Queue provider distillation for imported or updated threads")
  .option("--since <YYYY-MM-DD>", "Only include transcripts modified on or after this date")
  .option("--until <YYYY-MM-DD>", "Only include transcripts modified on or before this date")
  .option("--max-file-size <megabytes>", "Skip transcripts larger than this size in MB")
  .option("--limit <n>", "Import or preview at most this many matched transcripts")
  .option("--report <file>", "Atomically write the complete JSON report")
  .action(async (options: {
    agent: string; rootAlias: string[]; dryRun?: boolean; distill?: boolean;
    since?: string; until?: string; maxFileSize?: string; limit?: string; report?: string;
  }) => {
    await withHistoryProject(program.opts<GlobalOptions>(), Boolean(options.dryRun), async (session) => {
      const report = await importProjectHistory({
        db: session.db,
        project: session.project,
        projectRoot: session.projectRoot,
        agents: requireHistoryAgents(options.agent),
        rootAliases: options.rootAlias,
        dryRun: options.dryRun,
        distill: options.distill,
        filters: historyImportFilters(options)
      });
      let reportWriteFailed = false;
      if (options.report) {
        try {
          await writeHistoryImportReport(report, options.report);
        } catch (error) {
          reportWriteFailed = true;
          console.error(`History report write failed: ${sanitizeHistoryImportError(error)}`);
        }
      }
      printJson(report);
      if (
        reportWriteFailed ||
        report.counts.failed > 0 ||
        report.items.some((item) => item.distillStatus === "failed")
      ) {
        process.exitCode = 2;
      }
    });
  });

history
  .command("runs")
  .description("List history import audit runs for the current project")
  .option("--limit <n>", "Maximum runs to return", "20")
  .action(async (options: { limit: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(listHistoryImportRuns(
        session.db,
        session.project.id,
        integerInRange(options.limit, 1, 100, "History run limit")
      ));
    });
  });

history
  .command("failures")
  .description("List file import and distillation enqueue failures")
  .option("--run <run-id>", "Limit failures to one audit run")
  .option("--limit <n>", "Maximum failures to return", "100")
  .action(async (options: { run?: string; limit: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(listHistoryImportFailures(session.db, session.project.id, {
        runId: options.run,
        limit: integerInRange(options.limit, 1, 500, "History failure limit")
      }));
    });
  });

program
  .command("import")
  .description("Import an agent session into the current project")
  .requiredOption("--source <source>", "Session source: codex, claude-code, or markdown")
  .requiredOption("--path <path>", "Markdown session file path")
  .option("--format <format>", "Session file format: auto, markdown, or jsonl", "auto")
  .option("--id <id>", "Thread id")
  .option("--title <title>", "Thread title")
  .action(async (options: { source: string; path: string; format: string; id?: string; title?: string }) => {
    await withProject(program.opts<GlobalOptions>(), async (session) => {
      const imported = await importAgentSessionFromFile({
        source: options.source,
        inputPath: options.path,
        format: options.format,
        id: options.id,
        title: options.title
      });

      printJson(
        captureSession(session.db, {
          id: imported.id,
          projectId: session.project.id,
          title: imported.title,
          source: imported.source,
          rawFormat: imported.rawFormat,
          rawText: imported.rawText
        }).thread
      );
    });
  });

program.exitOverride();

try {
  await program.parseAsync();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("commander")) {
    console.error(message);
    console.error(`Run 'mira ${commandPathFromArgs(process.argv.slice(2))} --help' for usage.`);
  }
  process.exitCode = 1;
}
