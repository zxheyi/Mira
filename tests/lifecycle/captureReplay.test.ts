import { createHash } from "node:crypto";
import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { listDomainEvents, listOutboxMessages } from "../../src/events/domainOutboxStore.js";
import { getCaptureCursor } from "../../src/integrations/captureCursorStore.js";
import { stableThreadId } from "../../src/integrations/threadIdentity.js";
import type { AfterTurnCommand } from "../../src/lifecycle/hostAdapterRegistry.js";
import { createTurnLifecycle } from "../../src/lifecycle/turnLifecycle.js";
import { createProject } from "../../src/projects/projectStore.js";
import { captureSession } from "../../src/threads/sessionCapture.js";
import { deleteThread, getThread } from "../../src/threads/threadStore.js";

let db: Database.Database;
afterEach(() => db?.close());

function fixture() {
  db = openDatabase(":memory:");
  migrate(db);
  const project = createProject(db, {name: "Capture replay", rootPath: "/capture-replay"});
  const lifecycle = createTurnLifecycle({db, projectId: project.id});
  const command: AfterTurnCommand & {transcript: NonNullable<AfterTurnCommand["transcript"]>} = {
    host: "codex", transport: "native", hostSessionId: "session", hostTurnId: "snapshot-one",
    query: "Capture this session.", response: "First answer.", outcomeStatus: "succeeded",
    transcript: {
      threadId: stableThreadId("codex", "session"), title: "Host session", rawFormat: "markdown",
      rawText: "# Session\n\nFirst answer.",
      checkpoint: {agent: "codex", sessionId: "session", transcriptPath: "/capture-replay/session.jsonl", size: 100, mtimeMs: 1000}
    }
  };
  const cursor = () => getCaptureCursor(db, project.id, "codex", "session");
  const thread = () => getThread(db, project.id, command.transcript.threadId);
  const observed = (size: number, mtimeMs: number) => ({...command, transcript: {...command.transcript,
    checkpoint: {...command.transcript.checkpoint!, size, mtimeMs}}});
  const counts = () => ({events: listDomainEvents(db, project.id).length, outbox: listOutboxMessages(db, project.id).length});
  return {project, lifecycle, command, cursor, thread, observed, counts};
}

function legacyHash(command: AfterTurnCommand): string {
  return createHash("sha256").update(JSON.stringify(command)).digest("hex");
}

describe("completed capture replay", () => {
  test("advances an observation checkpoint without rewriting evidence or re-enqueueing work", () => {
    const f = fixture();
    const first = f.lifecycle.afterTurn(f.command);
    const original = f.thread();
    const counts = f.counts();

    expect(f.lifecycle.afterTurn(f.observed(160, 2000))).toEqual({...first, duplicate: true});
    expect(f.thread()).toEqual(original);
    expect(f.cursor()).toMatchObject({size: 160, mtimeMs: 2000});
    expect(f.counts()).toEqual(counts);
  });

  test("an older observation remains idempotent without moving the cursor backwards", () => {
    const f = fixture();
    const first = f.lifecycle.afterTurn(f.command);
    f.lifecycle.afterTurn(f.observed(160, 2000));
    const cursor = f.cursor();

    expect(f.lifecycle.afterTurn(f.command)).toEqual({...first, duplicate: true});
    expect(f.lifecycle.afterTurn(f.observed(120, 2000)).duplicate).toBe(true);
    expect(f.cursor()).toEqual(cursor);
    expect(f.counts()).toEqual({events: 2, outbox: 2});
  });

  test.each([
    ["query", (c: AfterTurnCommand) => ({...c, query: "Different request."})],
    ["response", (c: AfterTurnCommand) => ({...c, response: "Different answer."})],
    ["outcome", (c: AfterTurnCommand) => ({...c, outcomeStatus: "failed" as const})],
    ["body", (c: AfterTurnCommand) => ({...c, transcript: {...c.transcript!, rawText: "Different evidence."}})],
    ["thread identity", (c: AfterTurnCommand) => ({...c, transcript: {...c.transcript!, threadId: "different-thread"}})],
    ["title", (c: AfterTurnCommand) => ({...c, transcript: {...c.transcript!, title: "Different title"}})],
    ["format", (c: AfterTurnCommand) => ({...c, transcript: {...c.transcript!, rawFormat: "jsonl" as const}})],
    ["transport", (c: AfterTurnCommand) => ({...c, transport: "mcp" as const})],
    ["checkpoint identity", (c: AfterTurnCommand) => ({...c, transcript: {...c.transcript!, checkpoint: {...c.transcript!.checkpoint!, transcriptPath: "/other.jsonl"}}})]
  ])("rejects a real %s conflict even when checkpoint metadata changes", (_name, change) => {
    const f = fixture();
    f.lifecycle.afterTurn(f.command);
    const original = {thread: f.thread(), cursor: f.cursor(), counts: f.counts()};
    expect(() => f.lifecycle.afterTurn(change(f.observed(160, 2000)))).toThrow(/conflicts/);
    expect({thread: f.thread(), cursor: f.cursor(), counts: f.counts()}).toEqual(original);
  });

  test.each([2000, 4000])("replaying an old snapshot with observation time %s preserves a later full capture", (mtimeMs) => {
    const f = fixture();
    const first = f.lifecycle.afterTurn(f.command);
    f.lifecycle.afterTurn({...f.observed(300, 3000), hostTurnId: "snapshot-two", response: "Second answer.",
      transcript: {...f.observed(300, 3000).transcript, rawText: f.command.transcript.rawText + "\n\nSecond answer."}});
    const original = {thread: f.thread(), cursor: f.cursor(), counts: f.counts()};

    expect(f.lifecycle.afterTurn(f.observed(200, mtimeMs))).toEqual({...first, duplicate: true});
    expect({thread: f.thread(), cursor: f.cursor(), counts: f.counts()}).toEqual(original);
  });

  test("repairs a deleted Thread once even when only file observations changed", () => {
    const f = fixture();
    const first = f.lifecycle.afterTurn(f.command);
    deleteThread(db, f.project.id, f.command.transcript.threadId);

    const repaired = f.lifecycle.afterTurn(f.observed(160, 2000));
    expect(repaired).toMatchObject({duplicate: false, capture: {id: first.capture.id, threadId: first.capture.threadId}});
    expect(f.thread()?.rawText).toBe(f.command.transcript.rawText);
    expect(f.cursor()).toMatchObject({size: 160, mtimeMs: 2000});
    expect(f.lifecycle.afterTurn(f.observed(180, 3000))).toEqual({...repaired, duplicate: true});
    expect(listDomainEvents(db, f.project.id).filter(event => event.eventType === "capture_repaired")).toHaveLength(1);
    expect(f.counts()).toEqual({events: 3, outbox: 4});
  });

  test("repair reattaches to a newer existing Thread without overwriting its evidence", () => {
    const f = fixture();
    const first = f.lifecycle.afterTurn(f.command);
    deleteThread(db, f.project.id, f.command.transcript.threadId);
    f.lifecycle.afterTurn({...f.observed(300, 3000), hostTurnId: "snapshot-two", response: "Second answer.",
      transcript: {...f.observed(300, 3000).transcript, rawText: f.command.transcript.rawText + "\n\nSecond answer."}});
    const original = {thread: f.thread(), cursor: f.cursor()};

    expect(f.lifecycle.afterTurn(f.observed(200, 2000))).toMatchObject({duplicate: false, capture: {id: first.capture.id}});
    expect({thread: f.thread(), cursor: f.cursor()}).toEqual(original);
    expect(f.lifecycle.afterTurn(f.command).duplicate).toBe(true);
  });

  test("repair never recreates stale evidence after a newer snapshot was deleted", () => {
    const f = fixture();
    f.lifecycle.afterTurn(f.command);
    f.lifecycle.afterTurn({...f.observed(300, 3000), hostTurnId: "snapshot-two", response: "Second answer.",
      transcript: {...f.observed(300, 3000).transcript, rawText: f.command.transcript.rawText + "\n\nSecond answer."}});
    deleteThread(db, f.project.id, f.command.transcript.threadId);
    const original = {cursor: f.cursor(), counts: f.counts()};
    expect(() => f.lifecycle.afterTurn(f.command)).toThrow(/Stale capture checkpoint/);
    expect(f.thread()).toBeUndefined();
    expect({cursor: f.cursor(), counts: f.counts()}).toEqual(original);
  });

  test("normal capture still rejects stale time and smaller size at the same timestamp", () => {
    const f = fixture();
    f.lifecycle.afterTurn(f.command);
    const input = {id: f.command.transcript.threadId, projectId: f.project.id, title: f.command.transcript.title,
      source: f.command.host, rawFormat: f.command.transcript.rawFormat, rawText: "Changed body."};
    expect(() => captureSession(db, {...input, checkpoint: f.observed(200, 500).transcript.checkpoint})).toThrow(/Stale/);
    expect(() => captureSession(db, {...input, checkpoint: f.observed(50, 1000).transcript.checkpoint})).toThrow(/Stale/);
    expect(f.thread()?.rawText).toBe(f.command.transcript.rawText);
  });

  test.each([false, true])("legacy full hashes accept metadata changes with original checkpoint proof (deleted=%s)", (deleted) => {
    const f = fixture();
    const first = f.lifecycle.afterTurn(f.command);
    db.prepare("update lifecycle_turns set after_input_hash=? where id=?").run(legacyHash(f.command), first.turn.id);
    if (deleted) deleteThread(db, f.project.id, f.command.transcript.threadId);

    expect(f.lifecycle.afterTurn(f.observed(160, 2000))).toMatchObject({duplicate: !deleted});
    expect(f.lifecycle.afterTurn(f.observed(180, 3000)).duplicate).toBe(true);
    expect(f.cursor()).toMatchObject({size: 180, mtimeMs: 3000});
    expect(f.thread()?.rawText).toBe(f.command.transcript.rawText);
  });

  test("legacy byte-identical callbacks remain repairable without the original cursor", () => {
    const f = fixture();
    const first = f.lifecycle.afterTurn(f.command);
    db.prepare("update lifecycle_turns set after_input_hash=? where id=?").run(legacyHash(f.command), first.turn.id);
    deleteThread(db, f.project.id, f.command.transcript.threadId);
    db.prepare("delete from integration_cursors where project_id=?").run(f.project.id);
    expect(f.lifecycle.afterTurn(f.command)).toMatchObject({duplicate: false, capture: {id: first.capture.id}});
    expect(f.thread()?.rawText).toBe(f.command.transcript.rawText);
  });

  test("legacy proof does not accept a changed title or guess a lost checkpoint", () => {
    const f = fixture();
    const first = f.lifecycle.afterTurn(f.command);
    db.prepare("update lifecycle_turns set after_input_hash=? where id=?").run(legacyHash(f.command), first.turn.id);
    expect(() => f.lifecycle.afterTurn({...f.observed(160, 2000), transcript: {...f.observed(160, 2000).transcript, title: "Changed title"}})).toThrow(/conflicts/);
    f.lifecycle.afterTurn({...f.observed(300, 3000), hostTurnId: "snapshot-two", response: "Second answer.",
      transcript: {...f.observed(300, 3000).transcript, rawText: f.command.transcript.rawText + "\n\nSecond answer."}});
    const original = {thread: f.thread(), cursor: f.cursor(), counts: f.counts()};
    expect(() => f.lifecycle.afterTurn(f.observed(160, 2000))).toThrow(/conflicts/);
    expect({thread: f.thread(), cursor: f.cursor(), counts: f.counts()}).toEqual(original);
    expect(f.lifecycle.afterTurn(f.command).duplicate).toBe(true);
    expect({thread: f.thread(), cursor: f.cursor(), counts: f.counts()}).toEqual(original);
  });

  test("an old replay cannot move a newer capture cursor back to an earlier transcript path", () => {
    const f = fixture();
    f.lifecycle.afterTurn(f.command);
    captureSession(db, {id: f.command.transcript.threadId, projectId: f.project.id, title: f.command.transcript.title,
      source: f.command.host, rawFormat: f.command.transcript.rawFormat, rawText: f.command.transcript.rawText,
      checkpoint: {...f.command.transcript.checkpoint!, transcriptPath: "/capture-replay/relocated.jsonl", size: 300, mtimeMs: 3000}});
    const original = {thread: f.thread(), cursor: f.cursor(), counts: f.counts()};

    expect(f.lifecycle.afterTurn(f.observed(500, 5000)).duplicate).toBe(true);
    expect({thread: f.thread(), cursor: f.cursor(), counts: f.counts()}).toEqual(original);
  });

  test("deletion repair cannot restore an obsolete transcript path", () => {
    const f = fixture();
    f.lifecycle.afterTurn(f.command);
    captureSession(db, {id: f.command.transcript.threadId, projectId: f.project.id, title: f.command.transcript.title,
      source: f.command.host, rawFormat: f.command.transcript.rawFormat, rawText: "Newer evidence at a new path.",
      checkpoint: {...f.command.transcript.checkpoint!, transcriptPath: "/capture-replay/relocated.jsonl", size: 300, mtimeMs: 3000}});
    deleteThread(db, f.project.id, f.command.transcript.threadId);
    const original = {cursor: f.cursor(), counts: f.counts()};

    expect(() => f.lifecycle.afterTurn(f.observed(500, 5000))).toThrow(/Stale capture checkpoint/);
    expect(f.thread()).toBeUndefined();
    expect({cursor: f.cursor(), counts: f.counts()}).toEqual(original);
  });

  test("generated lifecycle transcripts keep later turns during replay and deletion repair", () => {
    const f = fixture();
    const {transcript: _transcript, ...command} = f.command;
    const first = f.lifecycle.afterTurn(command);
    f.lifecycle.afterTurn({...command, hostTurnId: "turn-two", query: "Follow-up", response: "Second answer."});
    const current = getThread(db, f.project.id, first.capture.threadId!);
    expect(f.lifecycle.afterTurn(command)).toEqual({...first, duplicate: true});
    expect(getThread(db, f.project.id, first.capture.threadId!)).toEqual(current);
    deleteThread(db, f.project.id, first.capture.threadId!);
    expect(f.lifecycle.afterTurn(command).duplicate).toBe(false);
    expect(getThread(db, f.project.id, first.capture.threadId!)?.rawText).toBe(current?.rawText);
    expect(f.lifecycle.afterTurn(command).duplicate).toBe(true);
    expect(f.counts()).toEqual({events: 5, outbox: 6});
  });

  test("replay repair preserves Thread ownership when the old id belongs to another project", () => {
    const f = fixture();
    const first = f.lifecycle.afterTurn(f.command);
    deleteThread(db, f.project.id, f.command.transcript.threadId);
    const other = createProject(db, {name: "Other", rootPath: "/capture-replay-other"});
    captureSession(db, {id: f.command.transcript.threadId, projectId: other.id, title: "Other project's evidence",
      source: "codex", rawFormat: "markdown", rawText: "Private evidence."});
    const original = {thread: getThread(db, other.id, f.command.transcript.threadId), cursor: f.cursor(), counts: f.counts()};

    expect(() => f.lifecycle.afterTurn(f.observed(160, 2000))).toThrow(/different project/);
    expect({thread: getThread(db, other.id, f.command.transcript.threadId), cursor: f.cursor(), counts: f.counts()}).toEqual(original);
    expect(db.prepare("select thread_id from capture_records where id=?").get(first.capture.id)).toEqual({thread_id: null});
  });
});
