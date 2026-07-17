import { appendFile, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { runIntegrationHook } from "../../src/integrations/hookRuntime.js";
import { ensureProjectForRoot } from "../../src/projects/projectStore.js";
import { listThreadsForProject } from "../../src/threads/threadStore.js";
import { setWorkingMemory } from "../../src/workingMemory/workingMemoryStore.js";

async function setup() {
  const projectRoot = await mkdtemp(join(tmpdir(), "mira-hook-project-"));
  const transcriptRoot = await mkdtemp(join(tmpdir(), "mira-hook-transcripts-"));
  const dbPath = join(projectRoot, ".mira", "mira.sqlite");
  return { projectRoot, transcriptRoot, dbPath };
}

function jsonl(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

describe("integration hook runtime", () => {
  test("notifies optional distill integration only after a successful changed capture", async () => {
    const options = await setup();
    const transcriptPath = join(options.transcriptRoot, "distill.jsonl");
    await writeFile(transcriptPath, jsonl([{ role: "user", content: "Extract trusted memory." }]), "utf8");
    const onThreadCaptured = vi.fn(async () => undefined);
    const runtime = {
      agent: "codex" as const,
      projectRoot: options.projectRoot,
      dbPath: options.dbPath,
      allowedTranscriptRoots: [options.transcriptRoot],
      onThreadCaptured
    };
    const input = {
      session_id: "distill-session", transcript_path: transcriptPath,
      cwd: options.projectRoot, hook_event_name: "Stop"
    };

    const captured = await runIntegrationHook(runtime, input);
    const unchanged = await runIntegrationHook(runtime, input);

    expect(captured.status).toBe("captured");
    expect(unchanged).toMatchObject({ status: "ignored", reason: "transcript-unchanged" });
    expect(onThreadCaptured).toHaveBeenCalledTimes(1);
    expect(onThreadCaptured).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "thread_codex_distill_session",
      projectRoot: options.projectRoot,
      dbPath: options.dbPath
    }));
  });

  test("keeps capture successful when optional distill notification fails", async () => {
    const options = await setup();
    const transcriptPath = join(options.transcriptRoot, "distill-failure.jsonl");
    await writeFile(transcriptPath, jsonl([{ role: "user", content: "Capture must survive." }]), "utf8");

    const result = await runIntegrationHook({
      agent: "codex", projectRoot: options.projectRoot, dbPath: options.dbPath,
      allowedTranscriptRoots: [options.transcriptRoot],
      onThreadCaptured: async () => { throw new Error("queue unavailable"); }
    }, {
      session_id: "distill-failure", transcript_path: transcriptPath,
      cwd: options.projectRoot, hook_event_name: "Stop"
    });

    expect(result.status).toBe("captured");
    expect(await readFile(join(options.projectRoot, ".mira", "integrations.log"), "utf8"))
      .toContain("distill-enqueue-failed");
  });

  test("injects a budgeted Context Bundle at Codex and Claude Code session start", async () => {
    const options = await setup();
    const db = openDatabase(options.dbPath);
    migrate(db);
    const project = ensureProjectForRoot(db, options.projectRoot);
    setWorkingMemory(db, {
      projectId: project.id,
      kind: "current_task",
      content: "Finish automatic agent integration."
    });
    db.close();

    for (const agent of ["codex", "claude-code"] as const) {
      const result = await runIntegrationHook(
        {
          agent,
          projectRoot: options.projectRoot,
          dbPath: options.dbPath,
          allowedTranscriptRoots: [options.transcriptRoot],
          contextMaxCharacters: 600
        },
        {
          session_id: `session-${agent}`,
          transcript_path: null,
          cwd: options.projectRoot,
          hook_event_name: "SessionStart",
          source: "startup"
        }
      );

      expect(result).toMatchObject({ status: "context" });
      expect(result.stdout).toContain("# Mira Context Bundle");
      expect(result.stdout).toContain("Finish automatic agent integration.");
      expect(result.stdout.length).toBeLessThanOrEqual(600);
    }
  });

  test("captures a real-shaped Codex transcript into one stable thread across Stop events", async () => {
    const options = await setup();
    const transcriptPath = join(options.transcriptRoot, "rollout-session-codex.jsonl");
    await writeFile(
      transcriptPath,
      jsonl([
        {
          timestamp: "2026-07-17T10:00:00Z",
          type: "session_meta",
          payload: { session_id: "session-codex", cwd: options.projectRoot }
        },
        {
          timestamp: "2026-07-17T10:01:00Z",
          type: "response_item",
          payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Add automatic capture." }] }
        }
      ]),
      "utf8"
    );

    const first = await runIntegrationHook(
      {
        agent: "codex",
        projectRoot: options.projectRoot,
        dbPath: options.dbPath,
        allowedTranscriptRoots: [options.transcriptRoot]
      },
      {
        session_id: "session-codex",
        transcript_path: transcriptPath,
        cwd: options.projectRoot,
        hook_event_name: "Stop"
      }
    );
    await appendFile(
      transcriptPath,
      `\n${JSON.stringify({
        timestamp: "2026-07-17T10:02:00Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "Automatic capture is implemented." }
      })}`,
      "utf8"
    );
    const second = await runIntegrationHook(
      {
        agent: "codex",
        projectRoot: options.projectRoot,
        dbPath: options.dbPath,
        allowedTranscriptRoots: [options.transcriptRoot]
      },
      {
        session_id: "session-codex",
        transcript_path: transcriptPath,
        cwd: options.projectRoot,
        hook_event_name: "Stop"
      }
    );
    const unchanged = await runIntegrationHook(
      {
        agent: "codex",
        projectRoot: options.projectRoot,
        dbPath: options.dbPath,
        allowedTranscriptRoots: [options.transcriptRoot]
      },
      {
        session_id: "session-codex",
        transcript_path: transcriptPath,
        cwd: options.projectRoot,
        hook_event_name: "Stop"
      }
    );

    const db = openDatabase(options.dbPath);
    migrate(db);
    const project = ensureProjectForRoot(db, options.projectRoot);
    const threads = listThreadsForProject(db, project.id);
    db.close();

    expect(first).toMatchObject({ status: "captured", threadId: "thread_codex_session_codex" });
    expect(second).toMatchObject({ status: "captured", threadId: "thread_codex_session_codex" });
    expect(unchanged).toMatchObject({ status: "ignored", reason: "transcript-unchanged", stdout: "" });
    expect(threads).toHaveLength(1);
    expect(threads[0]?.rawFormat).toBe("jsonl");
    expect(threads[0]?.rawText).toContain("Add automatic capture.");
    expect(threads[0]?.rawText).toContain("Automatic capture is implemented.");
  });

  test("captures Claude Code Stop and SessionEnd into one stable thread", async () => {
    const options = await setup();
    const transcriptPath = join(options.transcriptRoot, "session-claude.jsonl");
    await writeFile(
      transcriptPath,
      jsonl([
        {
          type: "user",
          sessionId: "session-claude",
          cwd: options.projectRoot,
          timestamp: "2026-07-17T10:00:00Z",
          message: { role: "user", content: "Load Mira context." }
        },
        {
          type: "assistant",
          sessionId: "session-claude",
          cwd: options.projectRoot,
          timestamp: "2026-07-17T10:01:00Z",
          message: { role: "assistant", content: [{ type: "text", text: "Mira context loaded." }] }
        }
      ]),
      "utf8"
    );
    const baseInput = {
      session_id: "session-claude",
      transcript_path: transcriptPath,
      cwd: options.projectRoot
    };

    const stopped = await runIntegrationHook(
      {
        agent: "claude-code",
        projectRoot: options.projectRoot,
        dbPath: options.dbPath,
        allowedTranscriptRoots: [options.transcriptRoot]
      },
      { ...baseInput, hook_event_name: "Stop" }
    );
    const ended = await runIntegrationHook(
      {
        agent: "claude-code",
        projectRoot: options.projectRoot,
        dbPath: options.dbPath,
        allowedTranscriptRoots: [options.transcriptRoot]
      },
      { ...baseInput, hook_event_name: "SessionEnd", reason: "other" }
    );

    const db = openDatabase(options.dbPath);
    migrate(db);
    const project = ensureProjectForRoot(db, options.projectRoot);
    const threads = listThreadsForProject(db, project.id);
    db.close();

    expect(stopped).toMatchObject({ status: "captured", threadId: "thread_claude_code_session_claude" });
    expect(ended).toMatchObject({ status: "ignored", reason: "transcript-unchanged", stdout: "" });
    expect(threads).toHaveLength(1);
    expect(threads[0]?.rawText).toContain("Mira context loaded.");
  });

  test("ignores events outside the bound project", async () => {
    const options = await setup();
    const result = await runIntegrationHook(
      {
        agent: "codex",
        projectRoot: options.projectRoot,
        dbPath: options.dbPath,
        allowedTranscriptRoots: [options.transcriptRoot]
      },
      {
        session_id: "foreign",
        transcript_path: null,
        cwd: "/another/project",
        hook_event_name: "SessionStart"
      }
    );

    expect(result).toMatchObject({ status: "ignored", reason: "cwd-outside-project", stdout: "" });
  });

  test("keeps missing and disallowed transcripts non-blocking and logs metadata without transcript text", async () => {
    const options = await setup();
    const outsideRoot = await mkdtemp(join(tmpdir(), "mira-hook-outside-"));
    const outsidePath = join(outsideRoot, "secret.jsonl");
    await writeFile(outsidePath, jsonl([{ role: "user", content: "SECRET_TRANSCRIPT_BODY" }]), "utf8");
    const missingPath = join(options.transcriptRoot, "missing.jsonl");

    const disallowed = await runIntegrationHook(
      {
        agent: "codex",
        projectRoot: options.projectRoot,
        dbPath: options.dbPath,
        allowedTranscriptRoots: [options.transcriptRoot]
      },
      {
        session_id: "disallowed",
        transcript_path: outsidePath,
        cwd: options.projectRoot,
        hook_event_name: "Stop"
      }
    );
    const missing = await runIntegrationHook(
      {
        agent: "codex",
        projectRoot: options.projectRoot,
        dbPath: options.dbPath,
        allowedTranscriptRoots: [options.transcriptRoot]
      },
      {
        session_id: "missing",
        transcript_path: missingPath,
        cwd: options.projectRoot,
        hook_event_name: "Stop"
      }
    );

    const log = await readFile(join(options.projectRoot, ".mira", "integrations.log"), "utf8");
    expect(disallowed).toMatchObject({ status: "ignored", reason: "transcript-path-not-allowed", stdout: "" });
    expect(missing).toMatchObject({ status: "ignored", reason: "transcript-unavailable", stdout: "" });
    expect(log).toContain("transcript-path-not-allowed");
    expect(log).toContain("transcript-unavailable");
    expect(log).not.toContain("SECRET_TRANSCRIPT_BODY");
  });

  test("does not advance the cursor after a failed import and retries when the transcript is repaired", async () => {
    const options = await setup();
    const transcriptPath = join(options.transcriptRoot, "retry.jsonl");
    await writeFile(transcriptPath, "not-json", "utf8");
    const input = {
      session_id: "retry-session",
      transcript_path: transcriptPath,
      cwd: options.projectRoot,
      hook_event_name: "Stop"
    };
    const runtime = {
      agent: "codex" as const,
      projectRoot: options.projectRoot,
      dbPath: options.dbPath,
      allowedTranscriptRoots: [options.transcriptRoot]
    };

    const failed = await runIntegrationHook(runtime, input);
    await writeFile(transcriptPath, jsonl([{ role: "user", content: "Retry succeeded." }]), "utf8");
    const retried = await runIntegrationHook(runtime, input);

    expect(failed).toMatchObject({ status: "ignored", reason: "hook-processing-failed", stdout: "" });
    expect(retried).toMatchObject({ status: "captured", threadId: "thread_codex_retry_session" });
  });
});
