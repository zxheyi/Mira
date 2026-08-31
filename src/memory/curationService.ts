import type Database from "better-sqlite3";
import { addMemory, type AddMemoryInput, type Memory, type UpdateMemoryInput } from "./memoryStore.js";
import { archiveMemory, restoreMemory, updateMemory } from "./memoryLifecycleStore.js";
import { reviewMemoryCandidate, submitMemoryCandidates } from "../distill/candidateService.js";
import { assertNoSensitiveInformation } from "../distill/candidatePolicy.js";
import type { MemoryCandidateResult, SubmitMemoryCandidatesInput } from "../distill/candidateTypes.js";

type ConfirmedCommand =
  | { operation: "add"; input: AddMemoryInput }
  | { operation: "correct"; input: UpdateMemoryInput }
  | { operation: "archive" | "restore"; projectId: string; memoryId: string; actor: string; reason?: string };
type ReviewCommand = { operation: "review"; projectId: string; candidateId: string; decision: "accept" | "reject"; actor: string; reason?: string; supersedesMemoryId?: string };
type ProposeCommand = { operation: "propose"; input: SubmitMemoryCandidatesInput };
export type CurationCommand = ConfirmedCommand | ReviewCommand | ProposeCommand;

/** Explicit writes and inferred candidates share validation, but never share approval authority.
 * Callers must obtain user/protocol confirmation for add/correct/lifecycle/review operations.
 * Automatic extractors may only propose. This runtime has no thesis mutation capability.
 */
export function curateMemory(db: Database.Database, command: ConfirmedCommand): Memory;
export function curateMemory(db: Database.Database, command: ReviewCommand): MemoryCandidateResult;
export function curateMemory(db: Database.Database, command: ProposeCommand): MemoryCandidateResult[];
export function curateMemory(db: Database.Database, command: CurationCommand): Memory | MemoryCandidateResult | MemoryCandidateResult[] {
  assertNoSensitiveInformation(JSON.stringify(command), "Memory curation");
  switch (command.operation) {
    case "add": return addMemory(db, command.input);
    case "correct": return updateMemory(db, command.input);
    case "archive": return archiveMemory(db, command.projectId, command.memoryId, command.actor, command.reason);
    case "restore": return restoreMemory(db, command.projectId, command.memoryId, command.actor, command.reason);
    case "propose": return submitMemoryCandidates(db, command.input);
    case "review": return reviewMemoryCandidate(db, command.projectId, command.candidateId, command.decision,
      command.reason, command.supersedesMemoryId, command.actor);
    default: throw new Error("Unsupported memory curation operation");
  }
}
