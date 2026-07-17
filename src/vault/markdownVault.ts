import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { ensureFreshProjectBriefing, type ProjectBriefing } from "../briefing/projectBriefingStore.js";
import { listAllMemoryCandidatesByStatus } from "../distill/candidateService.js";
import type { MemoryCandidate } from "../distill/candidateTypes.js";
import { listAllMemoriesForProject, type Memory } from "../memory/memoryStore.js";
import type { Project } from "../projects/projectStore.js";
import { listThreadsForProject, type Thread } from "../threads/threadStore.js";
import { listWorkingMemory, type WorkingMemory } from "../workingMemory/workingMemoryStore.js";

export type VaultSnapshot = {
  project: Project;
  briefing?: ProjectBriefing;
  workingMemory: WorkingMemory[];
  memories: Memory[];
  threads: Thread[];
  pendingCandidates: MemoryCandidate[];
};

export type VaultFileSystem = Pick<typeof import("node:fs/promises"), "mkdir" | "writeFile" | "rename" | "rm">;
export type VaultSyncOptions = { fileSystem?: VaultFileSystem };
export type VaultSyncResult = {
  outputPath: string;
  fileCount: number;
  memoryCount: number;
  threadCount: number;
  pendingCandidateCount: number;
};

const defaultFileSystem: VaultFileSystem = { mkdir, writeFile, rename, rm };

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function safeAlias(value: string): string {
  return value.replace(/[\[\]|#^\r\n]/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
}

export function encodeVaultId(id: string): string {
  if (!id) throw new Error("Vault entity id is required");
  return encodeURIComponent(id).replace(/[.!'()*~]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function memoryPath(memory: Memory): string {
  return `memories/${encodeVaultId(memory.id)}`;
}

function threadPath(thread: Thread): string {
  return `threads/${encodeVaultId(thread.id)}`;
}

function wikiLink(path: string, title: string): string {
  return `[[${path}|${safeAlias(title)}]]`;
}

function frontmatter(fields: ReadonlyArray<readonly [string, string | number | null]>): string {
  const lines = fields.map(([key, value]) =>
    `${key}: ${typeof value === "string" ? yamlString(value) : String(value)}`
  );
  return `---\n${lines.join("\n")}\n---\n`;
}

function finalNewline(content: string): string {
  return `${content.trimEnd()}\n`;
}

function renderMemory(
  memory: Memory,
  memories: Map<string, Memory>,
  threads: Map<string, Thread>,
  successors: Map<string, Memory[]>
): string {
  const thread = memory.threadId ? threads.get(memory.threadId) : undefined;
  const next = successors.get(memory.id) ?? [];
  const relations: string[] = [];
  if (thread) relations.push(`- Thread: ${wikiLink(threadPath(thread), thread.title)}`);
  if (memory.supersedesMemoryId) {
    const predecessor = memories.get(memory.supersedesMemoryId);
    relations.push(
      `- Supersedes: ${wikiLink(
        `memories/${encodeVaultId(memory.supersedesMemoryId)}`,
        predecessor?.title ?? memory.supersedesMemoryId
      )}`
    );
  }
  for (const successor of next) {
    relations.push(`- Successor: ${wikiLink(memoryPath(successor), successor.title)}`);
  }

  return finalNewline(
    frontmatter([
      ["id", memory.id], ["type", "memory"], ["title", memory.title], ["kind", memory.kind],
      ["status", memory.status], ["confidence", memory.confidence], ["importance", memory.importance],
      ["source", memory.source], ["thread", memory.threadId ?? null],
      ["supersedes", memory.supersedesMemoryId ?? null], ["created_at", memory.createdAt],
      ["updated_at", memory.updatedAt]
    ]) +
    `\n# ${memory.title}\n\n${memory.content}\n` +
    (relations.length ? `\n## Relations\n\n${relations.join("\n")}\n` : "")
  );
}

function renderThread(thread: Thread, linkedMemories: Memory[]): string {
  const links = linkedMemories.map((memory) =>
    `- ${wikiLink(memoryPath(memory), memory.title)} (${memory.status})`
  );
  return finalNewline(
    frontmatter([
      ["id", thread.id], ["type", "thread"], ["title", thread.title], ["source", thread.source],
      ["raw_format", thread.rawFormat], ["created_at", thread.createdAt], ["updated_at", thread.updatedAt]
    ]) +
    `\n# ${thread.title}\n` +
    (links.length ? `\n## Memories\n\n${links.join("\n")}\n` : "") +
    `\n## Transcript\n\n${thread.rawText}\n`
  );
}

function renderWorkingMemory(snapshot: VaultSnapshot): string {
  const entries = snapshot.workingMemory
    .slice()
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
    .map((entry) => `## ${entry.kind}\n\n${entry.content}\n\n_Source: [working:${entry.id}]_`);
  return finalNewline(
    frontmatter([["type", "working_memory"], ["project", snapshot.project.id]]) +
    `\n# Working Memory\n\n${entries.length ? entries.join("\n\n") : "No working memory."}\n`
  );
}

function renderBriefing(snapshot: VaultSnapshot): string {
  const briefing = snapshot.briefing;
  if (!briefing) {
    return finalNewline(
      frontmatter([["type", "project_briefing"], ["project", snapshot.project.id], ["status", "unavailable"]]) +
      "\n# Project Briefing\n\nNo Project Briefing is available.\n"
    );
  }
  return finalNewline(
    frontmatter([
      ["id", briefing.id], ["type", "project_briefing"], ["project", snapshot.project.id],
      ["version", briefing.version], ["status", briefing.status], ["created_at", briefing.createdAt]
    ]) + `\n${briefing.markdown}\n`
  );
}

function renderCandidates(snapshot: VaultSnapshot, threads: Map<string, Thread>): string {
  const candidates = snapshot.pendingCandidates.map((candidate) => {
    const thread = threads.get(candidate.threadId);
    const source = thread ? wikiLink(threadPath(thread), thread.title) : `[thread:${candidate.threadId}]`;
    const evidence = candidate.evidence.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
    return [
      `## ${candidate.title}`, "", `- ID: \`${candidate.id}\``, `- Kind: \`${candidate.kind}\``,
      `- Confidence: ${candidate.confidence}`, `- Importance: ${candidate.importance}`,
      `- Risk: \`${candidate.riskLevel}\``, `- Source Thread: ${source}`, "", candidate.content,
      "", "### Evidence", "", evidence
    ].join("\n");
  });
  return finalNewline(
    frontmatter([["type", "pending_candidates"], ["project", snapshot.project.id]]) +
    `\n# Pending Memory Candidates\n\n${candidates.length ? candidates.join("\n\n") : "No pending candidates."}\n`
  );
}

function renderIndex(snapshot: VaultSnapshot): string {
  const memories = snapshot.memories.map((memory) =>
    `- ${wikiLink(memoryPath(memory), memory.title)} · ${memory.kind} · ${memory.status}`
  );
  const threads = snapshot.threads.map((thread) => `- ${wikiLink(threadPath(thread), thread.title)}`);
  return finalNewline(
    frontmatter([["type", "vault_index"], ["project", snapshot.project.id], ["title", snapshot.project.name]]) +
    `\n# ${snapshot.project.name} Memory Vault\n\n` +
    "- [[project-briefing|Project Briefing]]\n- [[working-memory|Working Memory]]\n" +
    "- [[reviews/pending-candidates|Pending Candidates]]\n" +
    `\n## Memories\n\n${memories.length ? memories.join("\n") : "No memories."}\n` +
    `\n## Threads\n\n${threads.length ? threads.join("\n") : "No threads."}\n`
  );
}

export function readVaultSnapshot(db: Database.Database, project: Project): VaultSnapshot {
  return db.transaction(() => ({
    project,
    briefing: ensureFreshProjectBriefing(db, project.id),
    workingMemory: listWorkingMemory(db, project.id),
    memories: listAllMemoriesForProject(db, project.id),
    threads: listThreadsForProject(db, project.id).sort((a, b) => a.id.localeCompare(b.id)),
    pendingCandidates: listAllMemoryCandidatesByStatus(db, project.id, "pending_review")
  })).immediate();
}

export function renderMarkdownVault(snapshot: VaultSnapshot): Map<string, string> {
  const files = new Map<string, string>();
  const memories = new Map(snapshot.memories.map((memory) => [memory.id, memory]));
  const threads = new Map(snapshot.threads.map((thread) => [thread.id, thread]));
  const successors = new Map<string, Memory[]>();
  for (const memory of snapshot.memories) {
    if (!memory.supersedesMemoryId) continue;
    const current = successors.get(memory.supersedesMemoryId) ?? [];
    current.push(memory);
    successors.set(memory.supersedesMemoryId, current);
  }

  files.set("index.md", renderIndex(snapshot));
  files.set("project-briefing.md", renderBriefing(snapshot));
  files.set("working-memory.md", renderWorkingMemory(snapshot));
  for (const memory of snapshot.memories) {
    files.set(`${memoryPath(memory)}.md`, renderMemory(memory, memories, threads, successors));
  }
  for (const thread of snapshot.threads) {
    files.set(
      `${threadPath(thread)}.md`,
      renderThread(thread, snapshot.memories.filter((memory) => memory.threadId === thread.id))
    );
  }
  files.set("reviews/pending-candidates.md", renderCandidates(snapshot, threads));
  return files;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function safeOutputFile(stagingPath: string, relativePath: string): string {
  const normalized = normalize(relativePath);
  const parentPrefix = `..${process.platform === "win32" ? "\\" : "/"}`;
  if (isAbsolute(normalized) || normalized === ".." || normalized.startsWith(parentPrefix)) {
    throw new Error(`Vault output path escapes staging directory: ${relativePath}`);
  }
  return join(stagingPath, normalized);
}

function assertSafeVaultTarget(project: Project, target: string): void {
  const projectRoot = resolve(project.rootPath);
  const projectFromTarget = relative(target, projectRoot);
  const targetIsProjectOrAncestor = projectFromTarget === "" || (
    !isAbsolute(projectFromTarget) &&
    projectFromTarget !== ".." &&
    !projectFromTarget.startsWith(`..${sep}`)
  );
  const protectedProjectPaths = [join(projectRoot, ".mira"), join(projectRoot, ".git")];
  if (targetIsProjectOrAncestor || protectedProjectPaths.includes(target)) {
    throw new Error(`Vault output is a protected path and cannot be replaced: ${target}`);
  }
}

export async function syncMarkdownVault(
  db: Database.Database,
  project: Project,
  outputPath: string,
  options: VaultSyncOptions = {}
): Promise<VaultSyncResult> {
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const target = resolve(outputPath);
  assertSafeVaultTarget(project, target);
  const parent = dirname(target);
  const name = basename(target);
  const operationId = randomUUID();
  const staging = join(parent, `.${name}.staging-${operationId}`);
  const backup = join(parent, `.${name}.backup-${operationId}`);
  const snapshot = readVaultSnapshot(db, project);
  const files = renderMarkdownVault(snapshot);

  await fileSystem.mkdir(parent, { recursive: true });
  await fileSystem.mkdir(staging, { recursive: true });
  let previousMoved = false;
  let newInstalled = false;
  try {
    for (const [relativePath, content] of files) {
      const destination = safeOutputFile(staging, relativePath);
      await fileSystem.mkdir(dirname(destination), { recursive: true });
      await fileSystem.writeFile(destination, content, "utf8");
    }

    try {
      await fileSystem.rename(target, backup);
      previousMoved = true;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    await fileSystem.rename(staging, target);
    newInstalled = true;
    if (previousMoved) await fileSystem.rm(backup, { recursive: true, force: true });
  } catch (error) {
    try {
      if (newInstalled) await fileSystem.rm(target, { recursive: true, force: true });
      if (previousMoved) await fileSystem.rename(backup, target);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Vault sync failed and rollback was incomplete; backup: ${backup}`
      );
    }
    throw error;
  } finally {
    await fileSystem.rm(staging, { recursive: true, force: true });
  }

  return {
    outputPath: target,
    fileCount: files.size,
    memoryCount: snapshot.memories.length,
    threadCount: snapshot.threads.length,
    pendingCandidateCount: snapshot.pendingCandidates.length
  };
}
