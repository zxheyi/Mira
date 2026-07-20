import { appendFile, mkdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { buildContextBundle } from "../context/contextBundle.js";
import { openDatabase } from "../db/client.js";
import { migrate } from "../db/schema.js";
import { importAgentSessionFromFile } from "../importers/agentSessionImporter.js";
import { ensureProjectForRoot } from "../projects/projectStore.js";
import { saveThread } from "../threads/threadStore.js";
import { getCaptureCursor, saveCaptureCursor } from "./captureCursorStore.js";
import type { IntegrationAgent } from "./configInstaller.js";
import { stableThreadId } from "./threadIdentity.js";

const hookInputSchema = z.object({
  session_id: z.string().trim().min(1).max(500),
  transcript_path: z.string().trim().min(1).nullable().optional(),
  cwd: z.string().trim().min(1),
  hook_event_name: z.string().trim().min(1).max(100),
  source: z.string().optional(),
  reason: z.string().optional()
}).passthrough();

type HookInput = z.infer<typeof hookInputSchema>;

export type HookRuntimeOptions = {
  agent: IntegrationAgent;
  projectRoot: string;
  dbPath: string;
  allowedTranscriptRoots?: string[];
  contextMaxCharacters?: number;
  onThreadCaptured?: (input: {
    projectId: string;
    threadId: string;
    projectRoot: string;
    dbPath: string;
  }) => void | Promise<void>;
};

export type HookRunResult =
  | { status: "context"; stdout: string }
  | { status: "captured"; stdout: ""; threadId: string }
  | { status: "ignored"; stdout: ""; reason: string };

function isWithin(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function defaultTranscriptRoots(agent: IntegrationAgent): string[] {
  if (agent === "codex") {
    const codexHome = process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : join(homedir(), ".codex");
    return [join(codexHome, "sessions"), join(codexHome, "archived_sessions")];
  }

  const claudeHome = process.env.CLAUDE_CONFIG_DIR
    ? resolve(process.env.CLAUDE_CONFIG_DIR)
    : join(homedir(), ".claude");
  return [join(claudeHome, "projects")];
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return resolve(path);
    }
    throw error;
  }
}

async function isAllowedTranscript(
  transcriptPath: string,
  allowedRoots: string[]
): Promise<"allowed" | "missing" | "disallowed"> {
  let transcriptRealPath: string;
  try {
    transcriptRealPath = await realpath(transcriptPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "missing";
    }
    throw error;
  }

  const roots = await Promise.all(allowedRoots.map(canonicalPath));
  return roots.some((root) => isWithin(root, transcriptRealPath)) ? "allowed" : "disallowed";
}

function isCaptureEvent(agent: IntegrationAgent, event: string): boolean {
  return agent === "codex"
    ? event === "Stop"
    : event === "Stop" || event === "SessionEnd";
}

async function appendDiagnostic(
  options: HookRuntimeOptions,
  input: Partial<HookInput>,
  reason: string,
  error?: unknown
): Promise<void> {
  try {
    const logPath = join(resolve(options.projectRoot), ".mira", "integrations.log");
    await mkdir(join(resolve(options.projectRoot), ".mira"), { recursive: true });
    const entry = {
      timestamp: new Date().toISOString(),
      agent: options.agent,
      event: input.hook_event_name,
      sessionId: input.session_id,
      transcriptFile: input.transcript_path ? basename(input.transcript_path) : undefined,
      reason,
      error: error instanceof Error ? error.message : error === undefined ? undefined : String(error)
    };
    await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Hook diagnostics must never block the host Agent.
  }
}

async function contextResult(options: HookRuntimeOptions): Promise<HookRunResult> {
  const db = openDatabase(options.dbPath);
  try {
    migrate(db);
    const project = ensureProjectForRoot(db, options.projectRoot);
    return {
      status: "context",
      stdout: buildContextBundle(db, project.id, {
        maxCharacters: options.contextMaxCharacters ?? 4_000
      })
    };
  } finally {
    db.close();
  }
}

async function captureTranscript(options: HookRuntimeOptions, input: HookInput): Promise<HookRunResult> {
  if (!input.transcript_path || extname(input.transcript_path).toLowerCase() !== ".jsonl") {
    await appendDiagnostic(options, input, "transcript-unavailable");
    return { status: "ignored", stdout: "", reason: "transcript-unavailable" };
  }

  const pathStatus = await isAllowedTranscript(
    input.transcript_path,
    options.allowedTranscriptRoots ?? defaultTranscriptRoots(options.agent)
  );
  if (pathStatus !== "allowed") {
    const reason = pathStatus === "missing" ? "transcript-unavailable" : "transcript-path-not-allowed";
    await appendDiagnostic(options, input, reason);
    return { status: "ignored", stdout: "", reason };
  }

  const threadId = stableThreadId(options.agent, input.session_id);
  const transcriptPath = await realpath(input.transcript_path);
  const transcriptStat = await stat(transcriptPath);
  const db = openDatabase(options.dbPath);
  let capturedProjectId: string;
  try {
    migrate(db);
    const project = ensureProjectForRoot(db, options.projectRoot);
    capturedProjectId = project.id;
    const cursor = getCaptureCursor(db, project.id, options.agent, input.session_id);
    if (
      cursor?.transcriptPath === transcriptPath &&
      cursor.size === transcriptStat.size &&
      cursor.mtimeMs === transcriptStat.mtimeMs
    ) {
      return { status: "ignored", stdout: "", reason: "transcript-unchanged" };
    }

    const normalized = await importAgentSessionFromFile({
      source: options.agent,
      inputPath: transcriptPath,
      format: "jsonl",
      id: threadId,
      title: `${options.agent} session ${input.session_id}`
    });
    db.transaction(() => {
      saveThread(db, {
        id: normalized.id,
        projectId: project.id,
        title: normalized.title,
        source: normalized.source,
        rawFormat: normalized.rawFormat,
        rawText: normalized.rawText
      });
      saveCaptureCursor(db, {
        projectId: project.id,
        agent: options.agent,
        sessionId: input.session_id,
        transcriptPath,
        size: transcriptStat.size,
        mtimeMs: transcriptStat.mtimeMs
      });
    })();
  } finally {
    db.close();
  }

  if (options.onThreadCaptured) {
    try {
      await options.onThreadCaptured({
        projectId: capturedProjectId,
        threadId,
        projectRoot: options.projectRoot,
        dbPath: options.dbPath
      });
    } catch (error) {
      await appendDiagnostic(options, input, "distill-enqueue-failed", error);
    }
  }

  return { status: "captured", stdout: "", threadId };
}

export async function runIntegrationHook(
  options: HookRuntimeOptions,
  rawInput: unknown
): Promise<HookRunResult> {
  const parsed = hookInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    await appendDiagnostic(options, {}, "invalid-hook-input", parsed.error);
    return { status: "ignored", stdout: "", reason: "invalid-hook-input" };
  }
  const input = parsed.data;

  if (!isWithin(options.projectRoot, input.cwd)) {
    await appendDiagnostic(options, input, "cwd-outside-project");
    return { status: "ignored", stdout: "", reason: "cwd-outside-project" };
  }

  try {
    if (input.hook_event_name === "SessionStart") {
      return await contextResult(options);
    }
    if (isCaptureEvent(options.agent, input.hook_event_name)) {
      return await captureTranscript(options, input);
    }
    return { status: "ignored", stdout: "", reason: "unsupported-event" };
  } catch (error) {
    await appendDiagnostic(options, input, "hook-processing-failed", error);
    return { status: "ignored", stdout: "", reason: "hook-processing-failed" };
  }
}
