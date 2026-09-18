import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect, test, vi} from "vitest";
import {openDatabase} from "../../src/db/client.js";
import {migrate} from "../../src/db/schema.js";
import {runIntegrationHook} from "../../src/integrations/hookRuntime.js";
import {stableThreadId} from "../../src/integrations/threadIdentity.js";
import {normalizeJsonlSession} from "../../src/importers/agentSessionImporter.js";

test.each(["codex", "claude-code"] as const)("%s captures more than fifty thousand characters without truncating the transcript", async agent => {
  const projectRoot = await mkdtemp(join(tmpdir(), "mira-long-transcript-"));
  const dbPath = join(projectRoot, ".mira", "mira.sqlite");
  const transcriptPath = join(projectRoot, "synthetic.jsonl");
  const sessionId = "long-transcript";
  const assistantText = "Historical detail ".repeat(4_000) + "UNTRUNCATED_FINAL_MARKER";
  const onThreadCaptured = vi.fn(async () => undefined);
  try {
    await writeFile(transcriptPath, [
      {role: "user", content: "Preserve the complete source conversation."},
      {role: "assistant", content: assistantText}
    ].map(record => JSON.stringify(record)).join("\n"));
    const result = await runIntegrationHook({agent, projectRoot, dbPath, allowedTranscriptRoots: [projectRoot], onThreadCaptured}, {
      session_id: sessionId, transcript_path: transcriptPath, cwd: projectRoot, hook_event_name: "Stop"
    });
    expect(result).toMatchObject({status: "captured", threadId: stableThreadId(agent, sessionId)});
    const db = openDatabase(dbPath);
    try {
      const stored = db.prepare("select raw_text from threads where id = ?").get(stableThreadId(agent, sessionId)) as {raw_text: string};
      expect(stored.raw_text.length).toBeGreaterThan(50_000);
      expect(stored.raw_text).toContain(assistantText);
      expect(stored.raw_text.endsWith("UNTRUNCATED_FINAL_MARKER")).toBe(true);
      expect(db.prepare("select length(response) as response_length from lifecycle_turns where status = 'completed'").get())
        .toEqual({response_length: 50_000});
      expect(db.prepare("select count(*) as count from capture_records").get()).toEqual({count: 1});
      expect(db.prepare("select count(*) as count from integration_cursors").get()).toEqual({count: 1});
      expect(onThreadCaptured).toHaveBeenCalledTimes(1);
    } finally { db.close(); }
  } finally { await rm(projectRoot, {recursive: true, force: true}); }
});

test("a five-million-character transcript is saved whole and an oversized retry leaves persisted state unchanged", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "mira-transcript-boundary-"));
  const dbPath = join(projectRoot, ".mira", "mira.sqlite");
  const transcriptPath = join(projectRoot, "synthetic-boundary.jsonl");
  const agent = "claude-code" as const;
  const sessionId = "transcript-boundary";
  const threadId = stableThreadId(agent, sessionId);
  const title = `${agent} session ${sessionId}`;
  const normalizationInput = {source: agent, inputPath: transcriptPath, id: threadId, title};
  const encode = (content: string) => JSON.stringify({role: "assistant", content});
  const framingLength = normalizeJsonlSession({...normalizationInput, rawText: encode("x")}).rawText.length - 1;
  const content = "x".repeat(5_000_000 - framingLength - "END".length) + "END";
  const input = {session_id: sessionId, transcript_path: transcriptPath, cwd: projectRoot, hook_event_name: "Stop"};
  const onThreadCaptured = vi.fn(async () => undefined);
  const runtime = {agent, projectRoot, dbPath, allowedTranscriptRoots: [projectRoot], onThreadCaptured};
  const db = openDatabase(dbPath); migrate(db);
  const persistedCounts = () => Object.fromEntries([
    "threads", "lifecycle_turns", "capture_records", "domain_events", "outbox_messages"
  ].map(table => [table, db.prepare(`select count(*) as count from ${table}`).get()]));
  try {
    await writeFile(transcriptPath, encode(content));
    expect(await runIntegrationHook(runtime, input)).toMatchObject({status: "captured", threadId});
    expect(db.prepare("select length(raw_text) as length, substr(raw_text, -3) as suffix from threads where id = ?").get(threadId))
      .toEqual({length: 5_000_000, suffix: "END"});
    const cursor = db.prepare("select * from integration_cursors").get();
    const counts = persistedCounts();

    await writeFile(transcriptPath, encode(content + "x"));
    expect(await runIntegrationHook(runtime, {...input, hook_event_name: "SessionEnd"}))
      .toMatchObject({status: "ignored", reason: "hook-processing-failed"});
    expect(db.prepare("select length(raw_text) as length, substr(raw_text, -3) as suffix from threads where id = ?").get(threadId))
      .toEqual({length: 5_000_000, suffix: "END"});
    expect(db.prepare("select * from integration_cursors").get()).toEqual(cursor);
    expect(persistedCounts()).toEqual(counts);
    expect(onThreadCaptured).toHaveBeenCalledTimes(1);
    const diagnostic = await readFile(join(projectRoot, ".mira", "integrations.log"), "utf8");
    expect(diagnostic).toContain("transcript.rawText");
    expect(diagnostic).toContain("5000000");
  } finally {
    db.close();
    await rm(projectRoot, {recursive: true, force: true});
  }
});
