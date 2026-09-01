import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { sanitizeDistillError } from "../distill/distillJobStore.js";
import type { OutboxMessage, OutboxTopic } from "./domainOutboxStore.js";

export type OutboxHandlerContext = {idempotencyKey: string};
export type OutboxHandler = (
  message: OutboxMessage,
  context: OutboxHandlerContext
) => void | Promise<void>;
export type OutboxHandlers = Partial<Record<OutboxTopic, OutboxHandler>>;
export type OutboxRunResult = {
  messageId: string;
  topic: OutboxTopic;
  status: "completed" | "retry_scheduled" | "failed" | "lease_lost";
  attempts: number;
};
export type OutboxRunner = {
  runNext(projectId: string, handlers: OutboxHandlers): Promise<OutboxRunResult | undefined>;
};

type ClaimedRow = {
  id:string;project_id:string;event_id:string;topic:OutboxTopic;payload:string;
  attempts:number;max_attempts:number;available_at:string;lease_expires_at:string;
  last_error:string|null;created_at:string;updated_at:string;lease_token:string;
};

function toMessage(row: ClaimedRow): OutboxMessage {
  return {id:row.id,projectId:row.project_id,eventId:row.event_id,topic:row.topic,
    payload:JSON.parse(row.payload) as Record<string, unknown>,status:"running",attempts:row.attempts,
    maxAttempts:row.max_attempts,availableAt:row.available_at,leaseExpiresAt:row.lease_expires_at,
    ...(row.last_error ? {lastError:row.last_error} : {}),createdAt:row.created_at,updatedAt:row.updated_at};
}

export function createOutboxRunner(options: {
  db: Database.Database;
  now?: () => Date;
  leaseMs?: number;
  baseBackoffMs?: number;
}): OutboxRunner {
  const {db} = options;
  const now = options.now ?? (() => new Date());
  const leaseMs = options.leaseMs ?? 60_000;
  const baseBackoffMs = options.baseBackoffMs ?? 1_000;

  function claim(projectId: string): ClaimedRow | undefined {
    return db.transaction(() => {
      const claimedAt = now();
      const claimedAtIso = claimedAt.toISOString();
      db.prepare(`update outbox_messages
        set status = 'pending', lease_expires_at = null, lease_token = null,
            available_at = ?, updated_at = ?
        where project_id = ? and status = 'running' and lease_expires_at <= ?`)
        .run(claimedAtIso, claimedAtIso, projectId, claimedAtIso);
      const due = db.prepare(`select id from outbox_messages
        where project_id = ? and status = 'pending' and attempts < max_attempts and available_at <= ?
        order by available_at asc, created_at asc, id asc limit 1`)
        .get(projectId, claimedAtIso) as {id:string} | undefined;
      if (!due) return undefined;
      const leaseToken = `outbox_lease_${randomUUID()}`;
      const leaseExpiresAt = new Date(claimedAt.getTime() + leaseMs).toISOString();
      const changed = db.prepare(`update outbox_messages
        set status = 'running', attempts = attempts + 1, lease_expires_at = ?, lease_token = ?,
            last_error = null, updated_at = ?
        where project_id = ? and id = ? and status = 'pending'`)
        .run(leaseExpiresAt, leaseToken, claimedAtIso, projectId, due.id);
      if (changed.changes !== 1) return undefined;
      return db.prepare("select * from outbox_messages where project_id = ? and id = ?")
        .get(projectId, due.id) as ClaimedRow;
    }).immediate();
  }

  return {
    async runNext(projectId, handlers) {
      const claimed = claim(projectId);
      if (!claimed) return undefined;
      const message = toMessage(claimed);
      const handler = handlers[message.topic];
      try {
        if (!handler) throw new Error(`No Outbox handler registered for ${message.topic}`);
        await handler(message, {idempotencyKey: message.id});
        const completedAt = now().toISOString();
        const completed = db.prepare(`update outbox_messages
          set status = 'completed', lease_expires_at = null, lease_token = null, last_error = null, updated_at = ?
          where project_id = ? and id = ? and status = 'running' and lease_token = ?`)
          .run(completedAt, projectId, message.id, claimed.lease_token);
        return {messageId:message.id,topic:message.topic,
          status:completed.changes === 1 ? "completed" : "lease_lost",attempts:message.attempts};
      } catch (error) {
        const failedAt = now();
        const exhausted = message.attempts >= message.maxAttempts;
        const availableAt = new Date(failedAt.getTime()
          + baseBackoffMs * Math.pow(2, Math.max(0, message.attempts - 1))).toISOString();
        const failed = db.prepare(`update outbox_messages
          set status = ?, available_at = ?, lease_expires_at = null, lease_token = null,
              last_error = ?, updated_at = ?
          where project_id = ? and id = ? and status = 'running' and lease_token = ?`)
          .run(exhausted ? "failed" : "pending", availableAt, sanitizeDistillError(error),
            failedAt.toISOString(), projectId, message.id, claimed.lease_token);
        return {messageId:message.id,topic:message.topic,
          status:failed.changes !== 1 ? "lease_lost" : exhausted ? "failed" : "retry_scheduled",
          attempts:message.attempts};
      }
    }
  };
}
