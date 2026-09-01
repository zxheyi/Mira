import type Database from "better-sqlite3";
import { ensureFreshProjectBriefing } from "../briefing/projectBriefingStore.js";
import { enqueueDistillJob } from "../distill/distillJobStore.js";
import { verifyEvidence } from "../research/evidenceVerification.js";
import type { OutboxMessage } from "./domainOutboxStore.js";
import type {
  OutboxHandlerContext,
  OutboxHandlers,
  OutboxRunner,
  OutboxRunResult
} from "./outboxRunner.js";

function payloadString(message: OutboxMessage, name: string): string {
  const value = message.payload[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Outbox ${message.topic} requires payload.${name}`);
  }
  return value;
}

function applyOnce(
  db: Database.Database,
  message: OutboxMessage,
  context: OutboxHandlerContext,
  effect: () => Record<string, unknown>
): void {
  if (context.idempotencyKey !== message.id) {
    throw new Error("Outbox idempotency key must equal the Message ID");
  }
  db.transaction(() => {
    const existing = db.prepare("select 1 from outbox_handler_receipts where message_id = ?")
      .get(message.id);
    if (existing) return;
    const result = effect();
    db.prepare(`insert into outbox_handler_receipts (
      message_id, project_id, topic, result, completed_at
    ) values (?, ?, ?, ?, ?)`)
      .run(message.id, message.projectId, message.topic, JSON.stringify(result), new Date().toISOString());
  }).immediate();
}

export function createDefaultOutboxHandlers(options: {db: Database.Database}): OutboxHandlers {
  const {db} = options;
  return {
    "capture.distill.requested": (message, context) => applyOnce(db, message, context, () => {
      const job = enqueueDistillJob(db, message.projectId, payloadString(message, "threadId"), "hook");
      return {distillJobId:job.id};
    }),
    "research.evidence.verify.requested": (message, context) => applyOnce(db, message, context, () => {
      const verification = verifyEvidence(
        db,
        message.projectId,
        payloadString(message, "caseId"),
        payloadString(message, "evidenceId")
      );
      return {verificationId:verification.id,status:verification.status};
    }),
    "projection.refresh.requested": (message, context) => applyOnce(db, message, context, () => {
      const briefing = ensureFreshProjectBriefing(db, message.projectId);
      return {briefingId:briefing?.id ?? null,version:briefing?.version ?? null};
    })
  };
}

export async function drainOutbox(
  runner: OutboxRunner,
  projectId: string,
  handlers: OutboxHandlers,
  limit = 1000
): Promise<{completed:number;retryScheduled:number;failed:number;leaseLost:number;results:OutboxRunResult[]}> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error("Outbox drain limit must be an integer from 1 to 10000");
  }
  const results: OutboxRunResult[] = [];
  for (let index = 0; index < limit; index += 1) {
    const result = await runner.runNext(projectId, handlers);
    if (!result) break;
    results.push(result);
  }
  return {
    completed:results.filter((item) => item.status === "completed").length,
    retryScheduled:results.filter((item) => item.status === "retry_scheduled").length,
    failed:results.filter((item) => item.status === "failed").length,
    leaseLost:results.filter((item) => item.status === "lease_lost").length,
    results
  };
}
