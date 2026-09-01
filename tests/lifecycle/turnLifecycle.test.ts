import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { listDomainEvents, listOutboxMessages } from "../../src/events/domainOutboxStore.js";
import { createTurnLifecycle } from "../../src/lifecycle/turnLifecycle.js";
import { listRecallEvents } from "../../src/context/recallAuditStore.js";
import { listMemoriesForProject } from "../../src/memory/memoryStore.js";
import { listMemoryCandidates } from "../../src/distill/candidateService.js";
import { createProject } from "../../src/projects/projectStore.js";
import { getThread } from "../../src/threads/threadStore.js";

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

describe("Turn Lifecycle Port", () => {
  test("makes Before Turn idempotent and binds one audited Context Packet to one Turn", () => {
    db = openDatabase(":memory:");
    migrate(db);
    const project = createProject(db, {name: "Lifecycle", rootPath: "/lifecycle"});
    const lifecycle = createTurnLifecycle({db, projectId: project.id});
    const command = {
      host: "cli" as const,
      transport: "cli" as const,
      hostSessionId: "session-1",
      hostTurnId: "turn-1",
      taskId: "task-1",
      query: "What is the current project state?",
      context: {maxCharacters: 800}
    };

    const first = lifecycle.beforeTurn(command);
    const retry = lifecycle.beforeTurn(command);

    expect(retry).toEqual(first);
    expect(first.session).toMatchObject({projectId: project.id, host: "cli", hostSessionId: "session-1"});
    expect(first.turn).toMatchObject({hostTurnId: "turn-1", status: "started", taskId: "task-1"});
    expect(first.context.markdown).toContain("# Mira Context Bundle");
    expect(first.turn.recallEventId).toBe(first.context.receipt.id);
    expect(listRecallEvents(db, project.id, {taskId: "task-1"})).toHaveLength(1);
    expect(listDomainEvents(db, project.id)).toEqual([
      expect.objectContaining({eventType: "turn_started", aggregateId: first.turn.id,
        payload:expect.objectContaining({sourceHost:"cli",transport:"cli"})})
    ]);

    expect(() => lifecycle.beforeTurn({...command, query: "A different request."}))
      .toThrow(/conflicts with the existing Turn/);
  });

  test("atomically captures After Turn and requests quarantined processing without creating authority", () => {
    db = openDatabase(":memory:");
    migrate(db);
    const project = createProject(db, {name: "Capture", rootPath: "/capture"});
    const lifecycle = createTurnLifecycle({db, projectId: project.id});
    lifecycle.beforeTurn({
      host: "mcp", hostSessionId: "session-2", hostTurnId: "turn-2",
      query: "Record the architecture decision."
    });
    const command = {
      host: "mcp" as const,
      hostSessionId: "session-2",
      hostTurnId: "turn-2",
      query: "Record the architecture decision.",
      response: "The project keeps SQLite as its fact source.",
      outcomeStatus: "succeeded" as const,
      transcript: {
        threadId: "host-thread-2",
        title: "Captured host session",
        rawFormat: "markdown" as const,
        rawText: "# Host session\n\nThe project keeps SQLite as its fact source."
      }
    };

    const completed = lifecycle.afterTurn(command);
    const retry = lifecycle.afterTurn(command);

    expect(completed.duplicate).toBe(false);
    expect(retry).toEqual({...completed, duplicate: true});
    expect(completed.turn).toMatchObject({status: "completed", outcomeStatus: "succeeded"});
    expect(completed.capture).toMatchObject({projectId: project.id, turnId: completed.turn.id});
    expect(completed.capture).toMatchObject({threadId: "host-thread-2", outcome: "imported"});
    expect(getThread(db, project.id, "host-thread-2")?.rawText).toContain("The project keeps SQLite as its fact source.");
    expect(listMemoriesForProject(db, project.id)).toEqual([]);
    expect(listMemoryCandidates(db, project.id)).toEqual([]);
    expect(listDomainEvents(db, project.id).map(event => event.eventType))
      .toEqual(["turn_completed", "turn_started"]);
    expect(listOutboxMessages(db, project.id).map(message => message.topic).sort())
      .toEqual(["capture.distill.requested", "projection.refresh.requested"]);

    expect(() => lifecycle.afterTurn({...command, response: "A conflicting result."}))
      .toThrow(/conflicts with the completed Turn/);
  });

  test("isolates Host and project identity even when external ids match", () => {
    db = openDatabase(":memory:");
    migrate(db);
    const firstProject = createProject(db, {name: "First", rootPath: "/first"});
    const secondProject = createProject(db, {name: "Second", rootPath: "/second"});
    const first = createTurnLifecycle({db, projectId: firstProject.id}).beforeTurn({
      host: "cli", hostSessionId: "same", hostTurnId: "same", query: "First"
    });
    const second = createTurnLifecycle({db, projectId: secondProject.id}).beforeTurn({
      host: "cli", hostSessionId: "same", hostTurnId: "same", query: "Second"
    });
    const otherHost = createTurnLifecycle({db, projectId: firstProject.id}).beforeTurn({
      host: "ui", hostSessionId: "same", hostTurnId: "same", query: "Third"
    });

    expect(new Set([first.session.id, second.session.id, otherHost.session.id]).size).toBe(3);
    expect(new Set([first.turn.id, second.turn.id, otherHost.turn.id]).size).toBe(3);
  });
});
