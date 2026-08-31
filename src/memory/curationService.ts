import type Database from "better-sqlite3";
import { z } from "zod";
import { addMemory, listMemoriesForProject, MEMORY_KINDS, type AddMemoryInput, type Memory, type UpdateMemoryInput } from "./memoryStore.js";
import { archiveMemory, getMemory, restoreMemory, updateMemory } from "./memoryLifecycleStore.js";
import { getThread } from "../threads/threadStore.js";
import { reviewMemoryCandidate, submitMemoryCandidates } from "../distill/candidateService.js";
import { assertNoSensitiveInformation, normalizeCandidateTitle } from "../distill/candidatePolicy.js";
import type { MemoryCandidateResult, SubmitMemoryCandidatesInput } from "../distill/candidateTypes.js";
import { recordCurationEvent } from "./curationAuditStore.js";
export { listCurationEvents } from "./curationAuditStore.js";

type ConfirmedCommand =
  | { operation: "add"; input: AddMemoryInput }
  | { operation: "correct"; input: Omit<UpdateMemoryInput, "actor"> & {actor?: string} }
  | { operation: "archive" | "restore"; projectId: string; memoryId: string; actor?: string; reason?: string };
type ReviewCommand = { operation: "review"; projectId: string; candidateId: string; decision: "accept" | "reject"; actor?: string; reason?: string; supersedesMemoryId?: string };
type ProposeCommand = { operation: "propose"; input: SubmitMemoryCandidatesInput };
export type BatchMemory = Pick<AddMemoryInput, "title" | "kind" | "content" | "confidence" | "importance">;
export type ReplaceThreadCommand = {
  operation: "replace_thread"; projectId: string; threadId: string;
  method: "deterministic" | "reviewed-file"; memories: BatchMemory[];
};
export type CurationCommand = ConfirmedCommand | ReviewCommand | ProposeCommand | ReplaceThreadCommand;

declare const authorityBrand: unique symbol;
export type CurationAuthority = { readonly [authorityBrand]: true };
export type ConfirmationPolicy = { actor: string; reason: string };
const authorities = new WeakMap<CurationAuthority, ConfirmationPolicy & {db: Database.Database; projectId: string}>();

/** Trusted application configuration only. Never construct authority from model/tool arguments.
 * This is an in-process capability, not authentication against code with filesystem/SQLite access.
 */
export function authorizeCuration(db: Database.Database, projectId: string, policy: ConfirmationPolicy): CurationAuthority {
  const actor = policy.actor.trim();
  const reason = policy.reason.trim();
  if (!actor || actor.length > 200 || !reason || reason.length > 1000) throw new Error("Curation authority requires an actor and reason within audit limits");
  assertNoSensitiveInformation(`${actor}\n${reason}`, "Curation authority");
  const authority = Object.freeze({}) as CurationAuthority;
  authorities.set(authority, {db, projectId, actor, reason});
  return authority;
}

export function requireCurationAuthority(db: Database.Database, projectId: string, authority?: CurationAuthority): ConfirmationPolicy {
  const policy = authority && authorities.get(authority);
  if (!policy || policy.db !== db || policy.projectId !== projectId) {
    throw new Error("Confirmed curation requires host-granted project authority; submit candidates or use the local review CLI/UI");
  }
  return policy;
}

/** Explicit writes and inferred candidates share validation, but never share approval authority.
 * Callers must obtain user/protocol confirmation for add/correct/lifecycle/review operations.
 * Automatic extractors may only propose. This runtime has no thesis mutation capability.
 */
export function curateMemory(db: Database.Database, command: ConfirmedCommand, authority?: CurationAuthority): Memory;
export function curateMemory(db: Database.Database, command: ReviewCommand, authority?: CurationAuthority): MemoryCandidateResult;
export function curateMemory(db: Database.Database, command: ProposeCommand): MemoryCandidateResult[];
export function curateMemory(db: Database.Database, command: ReplaceThreadCommand, authority?: CurationAuthority): Memory[];
export function curateMemory(db: Database.Database, command: CurationCommand, authority?: CurationAuthority): Memory | MemoryCandidateResult | MemoryCandidateResult[] | Memory[] {
  assertNoSensitiveInformation(JSON.stringify(command), "Memory curation");
  if (command.operation === "propose") return submitMemoryCandidates(db, command.input);
  if (command.operation === "replace_thread") return replaceThreadMemories(db, command, authority);
  const projectId = "input" in command ? command.input.projectId : command.projectId;
  const policy = requireCurationAuthority(db, projectId, authority);
  return db.transaction(() => {
    const result = (() => {
      switch (command.operation) {
        case "add": return addMemory(db, {...command.input, actor: policy.actor});
        case "correct": return updateMemory(db, {...command.input, source: command.input.source ?? "manual", actor: policy.actor, reason: command.input.reason ?? policy.reason});
        case "archive": return archiveMemory(db, command.projectId, command.memoryId, policy.actor, command.reason ?? policy.reason);
        case "restore": return restoreMemory(db, command.projectId, command.memoryId, policy.actor, command.reason ?? policy.reason);
        case "review": return reviewMemoryCandidate(db, command.projectId, command.candidateId, command.decision,
          command.reason ?? policy.reason, command.supersedesMemoryId, policy.actor);
        default: throw new Error("Unsupported memory curation operation");
      }
    })();
    const reason = "input" in command ? ("reason" in command.input ? command.input.reason : undefined) : command.reason;
    recordCurationEvent(db, {
      projectId, operation: command.operation, actor: policy.actor, authorityReason: policy.reason, reason,
      memoryId: "candidate" in result ? result.memory?.id : result.id,
      candidateId: "candidate" in result ? result.candidate.id : undefined,
      outcome: "candidate" in result ? result.outcome : result.status
    });
    return result;
  })();
}

const batchMemorySchema = z.object({
  title: z.string().trim().min(1).max(500), kind: z.enum(MEMORY_KINDS),
  content: z.string().trim().min(1).max(50_000),
  confidence: z.number().min(0).max(1), importance: z.number().min(1).max(10)
}).strict();

function replaceThreadMemories(db: Database.Database, command: ReplaceThreadCommand, authority?: CurationAuthority): Memory[] {
  const {projectId, threadId} = command;
  const policy = requireCurationAuthority(db, projectId, authority);
  if (command.method !== "deterministic" && command.method !== "reviewed-file") throw new Error("Unsupported batch extraction method");
  const inputs = z.array(batchMemorySchema).parse(command.memories);
  const identity = (memory: BatchMemory) => `${memory.kind}\u0000${memory.content}`;
  const titleKey = (memory: BatchMemory) => `${memory.kind}\u0000${normalizeCandidateTitle(memory.title)}`;
  const desired = new Set(inputs.map(identity));
  const titles = new Map<string, string>();
  for (const input of inputs) {
    const previous = titles.get(titleKey(input));
    if (previous && previous !== input.content) throw new Error("Ambiguous batch title; provide distinct titles or explicitly correct a memory");
    titles.set(titleKey(input), input.content);
  }
  return db.transaction(() => {
    if (!getThread(db, projectId, threadId)) throw new Error(`Thread not found: ${threadId}`);
    // Empty extraction is not permission to erase a previously reviewed batch.
    if (inputs.length === 0) return [];
    const managedSources = [`distill:${threadId}`, `llm-distill:${threadId}`];
    const source = managedSources[command.method === "deterministic" ? 0 : 1];
    const managed = listMemoriesForProject(db, projectId)
      .filter(memory => memory.threadId === threadId && managedSources.includes(memory.source));
    const stale = managed.filter(memory => !desired.has(identity(memory)));
    const reason = "Replaced by an explicitly reviewed thread batch";
    const results: Memory[] = [];
    const seen = new Set<string>();
    for (const input of inputs) {
      if (seen.has(identity(input))) continue;
      seen.add(identity(input));
      const existing = managed.find(memory => identity(memory) === identity(input));
      const predecessors = stale.filter(memory => titleKey(memory) === titleKey(input));
      if (!existing && predecessors.length > 1) throw new Error("Ambiguous batch predecessor; explicitly correct a memory");
      const predecessor = !existing ? predecessors[0] : undefined;
      results.push(predecessor
        ? curateMemory(db, {operation: "correct", input: {projectId, memoryId: predecessor.id, ...input, source, reason}}, authority)
        : curateMemory(db, {operation: "add", input: {projectId, threadId, ...input, source}}, authority));
    }
    for (const memory of stale) {
      if (getMemory(db, projectId, memory.id)?.status === "active") {
        curateMemory(db, {operation: "archive", projectId, memoryId: memory.id, actor: policy.actor, reason}, authority);
      }
    }
    return results;
  })();
}
