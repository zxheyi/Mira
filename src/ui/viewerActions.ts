import type Database from "better-sqlite3";
import { z } from "zod";
import { authorizeCuration, curateMemory } from "../memory/curationService.js";
import { retryDistillJob } from "../distill/distillJobStore.js";

const reason = z.string().trim().min(1).max(1000).optional();
const memoryAction = z.discriminatedUnion("action", [
  z.object({action: z.literal("correct"), content: z.string().trim().min(1).max(50_000), title: z.string().trim().min(1).max(500).optional(), reason}).strict(),
  z.object({action: z.literal("archive"), reason}).strict(),
  z.object({action: z.literal("restore"), reason}).strict()
]);
const reviewAction = z.object({decision: z.enum(["accept", "reject"]), reason,
  supersedesMemoryId: z.string().trim().min(1).max(500).optional()}).strict();

export function applyViewerAction(db: Database.Database, projectId: string, resource: string, id: string, body: unknown): unknown {
  if (resource === "memory") {
    const input = memoryAction.parse(body);
    const authority = authorizeCuration(db, projectId, {actor: "ui:user", reason: "Explicit local management UI action"});
    if (input.action === "correct") return curateMemory(db, {operation: "correct", input: {
      projectId, memoryId: id, content: input.content, title: input.title, actor: "ui:user", reason: input.reason
    }}, authority);
    return curateMemory(db, {operation: input.action, projectId, memoryId: id, actor: "ui:user", reason: input.reason}, authority);
  }
  if (resource === "candidates") {
    const input = reviewAction.parse(body);
    return curateMemory(db, {operation: "review", projectId, candidateId: id, actor: "ui:user", ...input},
      authorizeCuration(db, projectId, {actor: "ui:user", reason: "Explicit local management UI review"}));
  }
  if (resource === "jobs") {
    z.object({action: z.literal("retry")}).strict().parse(body);
    return retryDistillJob(db, projectId, id);
  }
  throw new Error("Unsupported viewer action");
}
