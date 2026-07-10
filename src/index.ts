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
import { addMemory, searchMemories, type MemoryKind } from "./memory/memoryStore.js";
import { detectProjectRoot } from "./projects/projectRoot.js";
import {
  createProject,
  ensureProjectForRoot,
  findProjectByRoot,
  listProjects,
  type Project
} from "./projects/projectStore.js";
import { serveMiraMcpStdio } from "./mcp/transport.js";
import { saveThread } from "./threads/threadStore.js";
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

  return detectProjectRoot(process.cwd());
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
  run: (db: Database.Database, dbPath: string) => Promise<T> | T
): Promise<T> {
  const projectRoot = await resolveProjectRoot(options);
  const dbPath = resolveDbPath(projectRoot, options);
  const db = openMigratedDatabase(dbPath);

  try {
    return await run(db, dbPath);
  } finally {
    db.close();
  }
}

async function withProject<T>(
  options: GlobalOptions,
  run: (session: ProjectSession) => Promise<T> | T
): Promise<T> {
  return withDatabase(options, async (db, dbPath) => {
    const projectRoot = await resolveProjectRoot(options);
    const project = ensureProjectForRoot(db, projectRoot);
    return run({ db, dbPath, projectRoot, project });
  });
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

const thread = program.command("thread").description("Manage saved threads");

thread
  .command("save")
  .description("Save or update a thread summary")
  .requiredOption("--id <id>", "Thread id")
  .requiredOption("--title <title>", "Thread title")
  .requiredOption("--source <source>", "Thread source")
  .requiredOption("--format <format>", "Raw format")
  .requiredOption("--text <text>", "Raw text or summary")
  .action(async (options: { id: string; title: string; source: string; format: string; text: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(
        saveThread(session.db, {
          id: options.id,
          projectId: session.project.id,
          title: options.title,
          source: options.source,
          rawFormat: options.format,
          rawText: options.text
        })
      );
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
      await withProject(program.opts<GlobalOptions>(), (session) => {
        printJson(
          addMemory(session.db, {
            projectId: session.project.id,
            threadId: options.threadId ?? options.thread,
            title: options.title,
            kind: options.kind,
            content: options.content,
            source: options.source,
            confidence: Number(options.confidence),
            importance: Number(options.importance)
          })
        );
      });
    }
  );

memory
  .command("search")
  .description("Search memories")
  .requiredOption("--query <query>", "Search query")
  .action(async (options: { query: string }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(searchMemories(session.db, session.project.id, options.query));
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

const working = program.command("working").description("Manage working memory");

working
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

working
  .command("list")
  .description("List working memory")
  .action(async () => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      printJson(listWorkingMemory(session.db, session.project.id));
    });
  });

working
  .command("clear")
  .description("Clear working memory")
  .option("--kind <kind>", "Working memory kind")
  .action(async (options: { kind?: WorkingMemoryKind }) => {
    await withProject(program.opts<GlobalOptions>(), (session) => {
      clearWorkingMemory(session.db, session.project.id, options.kind);
      printJson({ ok: true });
    });
  });

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
  .option("--id <id>", "Thread id")
  .option("--title <title>", "Thread title")
  .action(async (options: { source: string; path: string; id?: string; title?: string }) => {
    await withProject(program.opts<GlobalOptions>(), async (session) => {
      const imported = await importAgentSessionFromFile({
        source: options.source,
        inputPath: options.path,
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
  }
  process.exitCode = 1;
}
