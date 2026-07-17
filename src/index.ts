#!/usr/bin/env node
import { Command } from "commander";
import type Database from "better-sqlite3";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { buildContextBundle } from "./context/contextBundle.js";
import { openDatabase } from "./db/client.js";
import { migrate } from "./db/schema.js";
import { distillThreadMemories } from "./distill/distillThread.js";
import { startDetachedDistillWorker } from "./distill/detachedWorker.js";
import {
  listMemoryCandidates,
  reviewMemoryCandidate
} from "./distill/candidateService.js";
import { CANDIDATE_STATUSES, type CandidateStatus } from "./distill/candidateTypes.js";
import {
  DISTILL_JOB_STATUSES,
  enqueueDistillJob,
  listDistillJobs,
  retryDistillJob,
  type DistillJobStatus
} from "./distill/distillJobStore.js";
import { runNextDistillJob } from "./distill/distillWorker.js";
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
import {
  getIntegrationStatus,
  installAgentIntegration,
  uninstallAgentIntegration,
  type IntegrationAgent,
  type IntegrationAgentTarget,
  type IntegrationRuntime
} from "./integrations/configInstaller.js";
import { runIntegrationHook } from "./integrations/hookRuntime.js";
import { addMemory, clearMemoriesForThread, MEMORY_KINDS, searchMemories, type MemoryKind } from "./memory/memoryStore.js";
import { detectProjectRootWithFallback } from "./projects/projectRoot.js";
import {
  createProject,
  deleteProject,
  ensureProjectForRoot,
  findProjectByRoot,
  listProjects,
  type Project
} from "./projects/projectStore.js";
import { serveMiraMcpStdio } from "./mcp/transport.js";
import { deleteThread, saveThread } from "./threads/threadStore.js";
import {
  clearWorkingMemory,
  listWorkingMemory,
  setWorkingMemory,
  WORKING_MEMORY_KINDS,
  type WorkingMemoryKind
} from "./workingMemory/workingMemoryStore.js";

type GlobalOptions = {
  db?: string;
  projectRoot?: string;
};

type ProjectSession = {
  db: Database.Database;
  dbPath: string;
  projectRoot: string;
  project: Project;
};

const program = new Command();

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
  return resolve(options.db ?? join(projectRoot, ".mira", "mira.sqlite"));
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
  .option("--project-root <path>", "Project root path");

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
  .description("Delete a project record and its local Mira data")
  .requiredOption("--id <id>", "Project id")
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
        saveThread(session.db, {
          id: options.id,
          projectId: session.project.id,
          title: options.title,
          source: options.source,
          rawFormat,
          rawText
        })
      );
    });
  });

thread
  .command("delete")
  .description("Delete a thread and memories distilled from it")
  .requiredOption("--id <id>", "Thread id")
  .action(async (options: { id: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      deleteThread(session.db, session.project.id, options.id);
      printJson({ ok: true });
    });
  });

const memory = program.command("memory").description("Manage long-term memory");

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
          addMemory(session.db, {
            projectId: session.project.id,
            threadId: options.threadId ?? options.thread,
            title: options.title,
            kind,
            content,
            source: options.source,
            confidence,
            importance
          })
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
      printJson(distillThreadMemories(session.db, session.project.id, options.thread));
    });
  });

memory
  .command("clear")
  .description("Clear memories distilled from a thread")
  .requiredOption("--thread <id>", "Thread id")
  .action(async (options: { thread: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      clearMemoriesForThread(session.db, session.project.id, options.thread);
      printJson({ ok: true });
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
          parseLlmMemoryCandidates(rawCandidates)
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
  .action(async (options: { id: string; decision: string; reason?: string }) => {
    const decision = requireReviewDecision(options.decision);
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(reviewMemoryCandidate(session.db, session.project.id, options.id, decision, options.reason));
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
  .description("Run one pending distillation job")
  .option("--once", "Run one job and exit", true)
  .action(async () => {
    const config = providerConfigFromEnv(process.env);
    if (!config) {
      throw new Error("Provider is not configured; set MIRA_LLM_BASE_URL and MIRA_LLM_MODEL");
    }
    await withProject(program.opts<GlobalOptions>(), async (session) => {
      printJson(await runNextDistillJob(
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
      printJson(listWorkingMemory(session.db, session.project.id));
    });
  });

  parent
  .command("clear")
  .description("Clear working memory")
  .option("--kind <kind>", "Working memory kind")
  .action(async (options: { kind?: string }) => {
    const kind = options.kind ? requireWorkingMemoryKind(options.kind) : undefined;

    await withProject(program.opts<GlobalOptions>(), (session) => {
      clearWorkingMemory(session.db, session.project.id, kind);
      printJson({ ok: true });
    });
  });
}

const working = program.command("working").description("Manage working memory");
registerWorkingCommands(working);

const wm = program.command("wm").description("Alias for working memory commands");
registerWorkingCommands(wm);

const context = program.command("context").description("Generate agent context");

context
  .command("bundle")
  .description("Build a Markdown context bundle")
  .option("--query <query>", "Memory search query")
  .option("--memory-limit <number>", "Maximum durable memories", "8")
  .option("--max-characters <number>", "Maximum output characters")
  .action(async (options: { query?: string; memoryLimit: string; maxCharacters?: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      const memoryLimit = numberInRange(options.memoryLimit, 1, 50, "memoryLimit");
      const maxCharacters = options.maxCharacters
        ? numberInRange(options.maxCharacters, 1, 1_000_000, "maxCharacters")
        : undefined;
      process.stdout.write(
        buildContextBundle(session.db, session.project.id, {
          query: options.query,
          memoryLimit,
          maxCharacters
        })
      );
    });
  });


const mcp = program.command("mcp").description("Run the Mira MCP server");

mcp
  .command("serve")
  .description("Start the Mira MCP stdio server")
  .option("--db <path>", "SQLite database path")
  .option("--project-root <path>", "Project root path")
  .action(async (options: GlobalOptions) => {
    const mergedOptions = { ...program.opts<GlobalOptions>(), ...options };
    const projectRoot = await resolveProjectRoot(mergedOptions);
    const dbPath = resolveDbPath(projectRoot, mergedOptions);
    await serveMiraMcpStdio({ projectRoot, dbPath });
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
        onThreadCaptured: providerConfigFromEnv(process.env) ? enqueueHookDistill : undefined
      },
      await readStdinJson()
    );
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
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
        saveThread(session.db, {
          id: imported.id,
          projectId: session.project.id,
          title: imported.title,
          source: imported.source,
          rawFormat: imported.rawFormat,
          rawText: imported.rawText
        })
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
