#!/usr/bin/env node
import { Command } from "commander";
import type Database from "better-sqlite3";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildContextBundle } from "./context/contextBundle.js";
import { openDatabase } from "./db/client.js";
import { migrate } from "./db/schema.js";
import { distillThreadMemories } from "./distill/distillThread.js";
import {
  applyLlmDistillCandidates,
  buildLlmDistillPromptForThread,
  parseLlmMemoryCandidates
} from "./distill/llmDistill.js";
import { exportProject, type ExportFormat } from "./export/exportProject.js";
import { importAgentSessionFromFile } from "./importers/agentSessionImporter.js";
import { addMemory, clearMemoriesForThread, searchMemories, type MemoryKind } from "./memory/memoryStore.js";
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
    const rawFormat = options.format ?? options.rawFormat;
    if (!rawFormat) {
      throw new Error("Thread raw format is required via --format or --raw-format");
    }

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
      const confidence = numberInRange(options.confidence, 0, 1, "confidence");
      const importance = numberInRange(options.importance, 1, 10, "importance");

      await withProject(program.opts<GlobalOptions>(), (session) => {
        printJson(
          addMemory(session.db, {
            projectId: session.project.id,
            threadId: options.threadId ?? options.thread,
            title: options.title,
            kind: options.kind,
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

function registerWorkingCommands(parent: Command): void {
  parent
  .command("set")
  .description("Set working memory")
  .requiredOption("--kind <kind>", "Working memory kind")
  .requiredOption("--content <content>", "Working memory content")
  .action(async (options: { kind: WorkingMemoryKind; content: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(
        setWorkingMemory(session.db, {
          projectId: session.project.id,
          kind: options.kind,
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
  .action(async (options: { kind?: WorkingMemoryKind }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      clearWorkingMemory(session.db, session.project.id, options.kind);
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
      process.stdout.write(
        buildContextBundle(session.db, session.project.id, {
          query: options.query,
          memoryLimit: Number(options.memoryLimit),
          maxCharacters: options.maxCharacters ? Number(options.maxCharacters) : undefined
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
