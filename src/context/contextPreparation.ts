import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { ensureFreshProjectBriefing, getLatestCompleteProjectBriefing } from "../briefing/projectBriefingStore.js";
import { containsSensitiveInformation } from "../distill/candidatePolicy.js";
import { listTopMemoriesForProject, searchMemories, type Memory } from "../memory/memoryStore.js";
import { listWorkingMemory, normalizeTaskId } from "../workingMemory/workingMemoryStore.js";
import { recordRecallEvent, type RecallReceipt } from "./recallAuditStore.js";

export type PrepareContextOptions = {
  taskId?: string; query?: string; memoryLimit?: number; maxCharacters?: number; maxTokens?: number;
  recordAudit?: boolean;
};
export type ContextPacket = { markdown: string; receipt: RecallReceipt };
const warningKinds = new Set(["failed_attempt", "lesson", "constraint"]);
const workingPriority = ["blocker", "current_task", "current_phase", "next_step", "recent_decision", "preference", "decision", "note"];

function validateInteger(value: number | undefined, name: string, min: number, max: number): void {
  if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
}

function candidates(db: Database.Database, projectId: string, query: string | undefined, limit: number): Memory[] {
  if (!query) return listTopMemoriesForProject(db, projectId, limit);
  const phrase = searchMemories(db, projectId, query, {limit, queryMode: "phrase"});
  const terms = searchMemories(db, projectId, query, {limit, queryMode: "orTerms"});
  const ids = new Set(phrase.map(hit => hit.memory.id));
  return [...phrase, ...terms.filter(hit => !ids.has(hit.memory.id))].map(hit => hit.memory);
}

function renderMemory(memory: Memory): string {
  return [`### ${memory.title}`, `- id: ${memory.id}`, `- kind: ${memory.kind}`,
    ...(memory.source !== "manual" ? [`- source: ${memory.source}`] : []),
    ...(memory.confidence !== 1 ? [`- confidence: ${memory.confidence}`] : []), memory.content].join("\n");
}

/** One public interface owns selection, rendering and the evidence of what was injected. */
export function prepareContext(db: Database.Database, projectId: string, options: PrepareContextOptions = {}): ContextPacket {
  const started = Date.now();
  validateInteger(options.memoryLimit, "memoryLimit", 1, 50);
  validateInteger(options.maxCharacters, "maxCharacters", 1, 1_000_000);
  validateInteger(options.maxTokens, "maxTokens", 25, 250_000);
  const taskId = normalizeTaskId(options.taskId);
  const query = options.query?.trim();
  if (query && query.length > 1000) throw new Error("query must be at most 1000 characters");
  const project = db.prepare("select name from projects where id = ?").get(projectId) as { name: string } | undefined;
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const shared = listWorkingMemory(db, projectId);
  const task = taskId ? listWorkingMemory(db, projectId, taskId) : [];
  const working = [...new Map([...shared, ...task].map(item => [item.kind, item])).values()]
    .sort((a,b) => workingPriority.indexOf(a.kind) - workingPriority.indexOf(b.kind));
  const briefing = options.recordAudit === false || taskId
    ? getLatestCompleteProjectBriefing(db, projectId) : ensureFreshProjectBriefing(db, projectId);
  const pool = candidates(db, projectId, query, Math.min(200, (options.memoryLimit ?? 8) * 4));
  const ordered = [...pool.filter(item => warningKinds.has(item.kind)), ...pool.filter(item => !warningKinds.has(item.kind))];
  const injected: string[] = [];
  const dropped: RecallReceipt["dropped"] = [];
  let markdown = "";
  const fits = (text: string) => (options.maxCharacters === undefined || text.length <= options.maxCharacters)
    && (options.maxTokens === undefined || Buffer.byteLength(text, "utf8") <= options.maxTokens);
  const append = (text: string): boolean => {
    const next = markdown + text + "\n\n";
    if (!fits(next)) return false;
    markdown = next; return true;
  };
  // Only the static heading may be shortened for tiny budgets; entries are atomic.
  for (const character of "# Mira Context Bundle\n\n") {
    if (!fits(markdown + character)) break;
    markdown += character;
  }
  if (taskId) append(`Task ID: ${JSON.stringify(taskId)}`);
  append("## Working Memory");
  for (const item of working) append(`### ${item.kind}\n- updatedAt: ${item.updatedAt}\n${item.content}`);
  if (!working.length) append("No working memory recorded.");
  // The complete Briefing remains available separately; avoid reinjecting its duplicate, unfiltered memories.
  append(`## Project Briefing\nProject: ${project.name}${briefing ? ` · v${briefing.version}${briefing.staleAt ? " (stale)" : ""}` : ""}`);
  let currentSection = "";
  for (const memory of ordered) {
    if (injected.length >= (options.memoryLimit ?? 8)) {
      dropped.push({memoryId: memory.id, reason: "memory_limit"}); continue;
    }
    const section = warningKinds.has(memory.kind) ? "## Warnings" : "## Long-Term Memory";
    const text = `${currentSection === section ? "" : section + "\n\n"}${renderMemory(memory)}`;
    if (append(text)) { injected.push(memory.id); currentSection = section; }
    else dropped.push({memoryId: memory.id, reason: "budget"});
  }
  if (!pool.some(memory => !warningKinds.has(memory.kind))) append("## Long-Term Memory\nNo matching long-term memory.");
  if (dropped.length) append(`Some memories omitted; inspect the recall receipt. (${dropped.length} omitted)`);
  const receipt: RecallReceipt = {
    id: `recall_${randomUUID()}`, projectId, ...(taskId ? {taskId} : {}),
    ...(query ? {query: containsSensitiveInformation(query) ? "[REDACTED]" : query} : {}),
    candidateMemoryIds: pool.map(memory => memory.id), injectedMemoryIds: injected, dropped,
    characterCount: markdown.length, tokenUpperBound: Buffer.byteLength(markdown, "utf8"),
    ...(options.maxCharacters !== undefined ? {maxCharacters: options.maxCharacters} : {}),
    ...(options.maxTokens !== undefined ? {maxTokens: options.maxTokens} : {}),
    outputHash: createHash("sha256").update(markdown).digest("hex"), latencyMs: Date.now() - started,
    recorded: options.recordAudit !== false, createdAt: new Date().toISOString()
  };
  if (receipt.recorded) recordRecallEvent(db, receipt);
  return {markdown, receipt};
}
