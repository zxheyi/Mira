import { expect, test, vi } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { createProject } from "../../src/projects/projectStore.js";
import { getThread, listThreadsForProject } from "../../src/threads/threadStore.js";
import { getCaptureCursor } from "../../src/integrations/captureCursorStore.js";
import { captureSession } from "../../src/threads/sessionCapture.js";

test("capture preview is read-only and repeated ingestion preserves the thread and checkpoint", () => {
  const db = openDatabase(":memory:"); migrate(db);
  const project = createProject(db, {name: "Capture", rootPath: "/capture"});
  const input = {id: "thread_codex_session_1", projectId: project.id, title: "Source", source: "codex", rawFormat: "jsonl" as const, rawText: "User: Keep the original evidence.",
    checkpoint: {agent: "codex" as const, sessionId: "session-1", transcriptPath: "/transcripts/session.jsonl", size: 100, mtimeMs: 1000}};
  try {
    expect(captureSession(db, input, {preview: true}).outcome).toBe("imported");
    expect(listThreadsForProject(db, project.id)).toEqual([]);
    expect(getCaptureCursor(db, project.id, "codex", "session-1")).toBeUndefined();
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    const first = captureSession(db, input);
    const cursor = getCaptureCursor(db, project.id, "codex", "session-1");
    vi.setSystemTime(new Date("2026-08-01T00:01:00Z"));
    expect(captureSession(db, input)).toMatchObject({outcome: "unchanged", thread: first.thread});
    expect(getCaptureCursor(db, project.id, "codex", "session-1")).toEqual(cursor);
    expect(captureSession(db, {...input, rawText: "User: Added evidence.", checkpoint: {...input.checkpoint, size: 130, mtimeMs: 2000}}).outcome).toBe("updated");
    expect(getThread(db, project.id, input.id)?.rawText).toBe("User: Added evidence.");
    expect(getCaptureCursor(db, project.id, "codex", "session-1")?.size).toBe(130);
  } finally { vi.useRealTimers(); db.close(); }
});

test("an older capture cannot overwrite a newer checkpoint for the same transcript", () => {
  const db = openDatabase(":memory:"); migrate(db);
  const project = createProject(db, {name: "Race", rootPath: "/capture-race"});
  const input = {id: "thread_codex_race", projectId: project.id, title: "Race", source: "codex", rawFormat: "jsonl" as const, rawText: "Newer evidence",
    checkpoint: {agent: "codex" as const, sessionId: "race", transcriptPath: "/transcripts/race.jsonl", size: 100, mtimeMs: 2000}};
  try {
    const latest = captureSession(db, input);
    const stale = {...input, rawText: "Older evidence", checkpoint: {...input.checkpoint, mtimeMs: 1000}};
    expect(() => captureSession(db, stale)).toThrow(/stale capture/i);
    expect(() => captureSession(db, stale, {preview: true})).toThrow(/stale capture/i);
    expect(getThread(db, project.id, input.id)).toEqual(latest.thread);
    expect(getCaptureCursor(db, project.id, "codex", "race")?.mtimeMs).toBe(2000);
  } finally { db.close(); }
});

test("failed checkpoint writes and cross-project capture leave prior evidence unchanged", () => {
  const db = openDatabase(":memory:"); migrate(db);
  const project = createProject(db, {name: "Atomic", rootPath: "/capture-atomic"});
  const other = createProject(db, {name: "Other", rootPath: "/capture-other"});
  const input = {id: "thread_codex_atomic", projectId: project.id, title: "Atomic", source: "codex", rawFormat: "jsonl" as const, rawText: "Keep this evidence",
    checkpoint: {agent: "codex" as const, sessionId: "atomic", transcriptPath: "/transcripts/atomic.jsonl", size: 100, mtimeMs: 1000}};
  try {
    const original = captureSession(db, input);
    const cursor = getCaptureCursor(db, project.id, "codex", "atomic");
    expect(() => captureSession(db, {...input, projectId: other.id})).toThrow(/different project/);
    expect(() => captureSession(db, {...input, checkpoint: {...input.checkpoint, sessionId: "wrong-session"}})).toThrow(/identity/);
    db.exec("create trigger fail_capture before insert on integration_cursors begin select raise(abort, 'checkpoint unavailable'); end;");
    expect(() => captureSession(db, {...input, rawText: "Replacement", checkpoint: {...input.checkpoint, mtimeMs: 2000}})).toThrow("checkpoint unavailable");
    expect(getThread(db, project.id, input.id)).toEqual(original.thread);
    expect(getCaptureCursor(db, project.id, "codex", "atomic")).toEqual(cursor);
    expect(listThreadsForProject(db, other.id)).toEqual([]);
  } finally { db.close(); }
});
