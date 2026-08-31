import type Database from "better-sqlite3";
import { addMemory, type AddMemoryInput, type Memory, type UpdateMemoryInput } from "./memoryStore.js";
import { archiveMemory, restoreMemory, updateMemory } from "./memoryLifecycleStore.js";
import { reviewMemoryCandidate, submitMemoryCandidates } from "../distill/candidateService.js";
import { assertNoSensitiveInformation } from "../distill/candidatePolicy.js";
import type { MemoryCandidateResult, SubmitMemoryCandidatesInput } from "../distill/candidateTypes.js";
import { recordCurationEvent } from "./curationAuditStore.js";
export { listCurationEvents } from "./curationAuditStore.js";

type ConfirmedCommand =
  | { operation: "add"; input: AddMemoryInput }
  | { operation: "correct"; input: Omit<UpdateMemoryInput, "actor"> & {actor?: string} }
  | { operation: "archive" | "restore"; projectId: string; memoryId: string; actor?: string; reason?: string };
type ReviewCommand = { operation: "review"; projectId: string; candidateId: string; decision: "accept" | "reject"; actor?: string; reason?: string; supersedesMemoryId?: string };
type ProposeCommand = { operation: "propose"; input: SubmitMemoryCandidatesInput };
export type CurationCommand = ConfirmedCommand | ReviewCommand | ProposeCommand;

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
export function curateMemory(db: Database.Database, command: CurationCommand, authority?: CurationAuthority): Memory | MemoryCandidateResult | MemoryCandidateResult[] {
  assertNoSensitiveInformation(JSON.stringify(command), "Memory curation");
  if (command.operation === "propose") return submitMemoryCandidates(db, command.input);
  const projectId = "input" in command ? command.input.projectId : command.projectId;
  const policy = requireCurationAuthority(db, projectId, authority);
  return db.transaction(() => {
    const result = (() => {
      switch (command.operation) {
        case "add": return addMemory(db, {...command.input, actor: policy.actor});
        case "correct": return updateMemory(db, {...command.input, actor: policy.actor, reason: command.input.reason ?? policy.reason});
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
