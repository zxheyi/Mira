import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { createProject } from "../../src/projects/projectStore.js";
import {
  appendDomainEvent,
  enqueueOutboxMessage,
  listOutboxMessages
} from "../../src/events/domainOutboxStore.js";
import { createOutboxRunner } from "../../src/events/outboxRunner.js";

let db: Database.Database | undefined;
afterEach(() => { db?.close(); db = undefined; });

function fixture(maxAttempts = 3) {
  db = openDatabase(":memory:");
  migrate(db);
  const project = createProject(db, {name: "Outbox", rootPath: "/outbox"});
  const event = appendDomainEvent(db, {
    projectId: project.id, aggregateType: "turn", aggregateId: "turn-1",
    eventType: "turn_completed", payload: {captureRecordId: "capture-1"},
    createdAt: "2026-09-01T00:00:00.000Z"
  });
  const message = enqueueOutboxMessage(db, {
    projectId: project.id, eventId: event.id, topic: "projection.refresh.requested",
    payload: {reason: "turn_completed"}, maxAttempts,
    createdAt: "2026-09-01T00:00:00.000Z",
    availableAt: "2026-09-01T00:00:00.000Z"
  });
  return {project, message};
}

describe("Outbox Runner", () => {
  test("leases and completes one message while passing its ID as the idempotency key", async () => {
    const {project, message} = fixture();
    const seen: string[] = [];
    const runner = createOutboxRunner({db: db!});
    const result = await runner.runNext(project.id, {
      "projection.refresh.requested": async (_message, context) => { seen.push(context.idempotencyKey); }
    });
    expect(result).toMatchObject({messageId: message.id, status: "completed", attempts: 1});
    expect(seen).toEqual([message.id]);
    expect(await runner.runNext(project.id, {})).toBeUndefined();
    expect(listOutboxMessages(db!, project.id)[0]).toMatchObject({status: "completed", attempts: 1});
  });

  test("sanitizes failures, backs off, and stops at the finite retry budget", async () => {
    const {project, message} = fixture(2);
    let nowMs = Date.parse("2026-09-01T00:00:00.000Z");
    const runner = createOutboxRunner({db: db!, now: () => new Date(nowMs), baseBackoffMs: 1000});
    const fail = async () => { throw new Error("api_key=privatevalue123456"); };

    expect(await runner.runNext(project.id, {"projection.refresh.requested": fail}))
      .toMatchObject({messageId: message.id, status: "retry_scheduled", attempts: 1});
    expect(listOutboxMessages(db!, project.id)[0]).toMatchObject({
      status: "pending", attempts: 1, lastError: expect.not.stringContaining("privatevalue123456")
    });
    expect(await runner.runNext(project.id, {"projection.refresh.requested": fail})).toBeUndefined();

    nowMs += 1000;
    expect(await runner.runNext(project.id, {"projection.refresh.requested": fail}))
      .toMatchObject({messageId: message.id, status: "failed", attempts: 2});
    expect(listOutboxMessages(db!, project.id)[0]).toMatchObject({status: "failed", attempts: 2});
  });

  test("recovers an expired lease and prevents the old worker from completing the new attempt", async () => {
    const {project, message} = fixture();
    let nowMs = Date.parse("2026-09-01T00:00:00.000Z");
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const firstRunner = createOutboxRunner({db: db!, now: () => new Date(nowMs), leaseMs: 1000});
    const first = firstRunner.runNext(project.id, {
      "projection.refresh.requested": async () => { await blocked; }
    });

    nowMs += 1001;
    const secondRunner = createOutboxRunner({db: db!, now: () => new Date(nowMs), leaseMs: 1000});
    expect(await secondRunner.runNext(project.id, {
      "projection.refresh.requested": async () => undefined
    })).toMatchObject({messageId: message.id, status: "completed", attempts: 2});

    release();
    expect(await first).toMatchObject({messageId: message.id, status: "lease_lost", attempts: 1});
    expect(listOutboxMessages(db!, project.id)[0]).toMatchObject({status: "completed", attempts: 2});
  });
});
