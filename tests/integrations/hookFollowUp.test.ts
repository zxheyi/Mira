import {spawnSync} from "node:child_process";
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, expect, test, vi} from "vitest";
import {openDatabase} from "../../src/db/client.js";
import {migrate} from "../../src/db/schema.js";
import {runHookFollowUp} from "../../src/integrations/hookFollowUp.js";
import {runIntegrationHook, type HookRuntimeOptions} from "../../src/integrations/hookRuntime.js";

const temporaryRoots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const root of temporaryRoots.splice(0)) await rm(root, {recursive: true, force: true});
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "mira-hook-followup-"));
  temporaryRoots.push(root);
  const projectRoot = join(root, "project");
  const claudeConfig = join(root, "claude");
  const transcripts = join(claudeConfig, "projects", "fixture");
  await mkdir(join(projectRoot, ".git"), {recursive: true});
  await mkdir(transcripts, {recursive: true});
  const transcriptPath = join(transcripts, "session.jsonl");
  await writeFile(transcriptPath, JSON.stringify({type: "user", message: {role: "user", content: "Use a topic branch for changes."}}));
  return {projectRoot, dbPath: join(projectRoot, ".mira", "mira.sqlite"), claudeConfig, transcriptPath};
}

function hookInput(input: Awaited<ReturnType<typeof fixture>>) {
  return {session_id: "follow-up", cwd: input.projectRoot, transcript_path: input.transcriptPath, hook_event_name: "Stop"};
}

function hookOptions(input: Awaited<ReturnType<typeof fixture>>): HookRuntimeOptions {
  return {agent: "claude-code", projectRoot: input.projectRoot, dbPath: input.dbPath, allowedTranscriptRoots: [input.claudeConfig]};
}

function followUpOptions(input: Awaited<ReturnType<typeof fixture>>) {
  return {nodePath: process.execPath, entryPath: join(process.cwd(), "dist/src/index.js"),
    projectRoot: input.projectRoot, dbPath: input.dbPath, env: {}};
}

test("the native hook drains local work without Provider configuration and retains a pending model job", async () => {
  const input = await fixture();
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", "--project-root", input.projectRoot,
    "--db", input.dbPath, "integration", "hook", "--agent", "claude-code"], {
    cwd: process.cwd(), encoding: "utf8", timeout: 15_000,
    env: {...process.env, CLAUDE_CONFIG_DIR: input.claudeConfig, MIRA_LLM_BASE_URL: "", MIRA_LLM_MODEL: "", MIRA_LLM_API_KEY: ""},
    input: JSON.stringify(hookInput(input))
  });
  expect(result.status, result.stderr).toBe(0);
  const db = openDatabase(input.dbPath);
  try {
    expect(db.prepare("select status from outbox_messages").all()).toEqual([{status: "completed"}, {status: "completed"}]);
    expect(db.prepare("select status, attempts from distill_jobs").all()).toEqual([{status: "pending", attempts: 0}]);
    expect(db.prepare("select count(*) from project_briefings").pluck().get()).toBe(1);
    expect(db.prepare("select count(*) from memory_candidates").pluck().get()).toBe(0);
    expect(db.prepare("select count(*) from memories").pluck().get()).toBe(0);
  } finally { db.close(); }
});

test("a later native SessionStart drains earlier unconsumed capture work without duplicate jobs", async () => {
  const input = await fixture();
  await runIntegrationHook(hookOptions(input), hookInput(input));
  for (const sessionId of ["recovery-one", "recovery-two"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", "--project-root", input.projectRoot,
      "--db", input.dbPath, "integration", "hook", "--agent", "claude-code"], {
      cwd: process.cwd(), encoding: "utf8", timeout: 15_000,
      env: {...process.env, CLAUDE_CONFIG_DIR: input.claudeConfig, MIRA_LLM_BASE_URL: "", MIRA_LLM_MODEL: "", MIRA_LLM_API_KEY: ""},
      input: JSON.stringify({session_id: sessionId, cwd: input.projectRoot, hook_event_name: "SessionStart"})
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Mira Context Bundle");
  }
  const db = openDatabase(input.dbPath);
  try {
    expect(db.prepare("select status, attempts from outbox_messages").all()).toEqual([
      {status: "completed", attempts: 1}, {status: "completed", attempts: 1}
    ]);
    expect(db.prepare("select status, attempts from distill_jobs").all()).toEqual([{status: "pending", attempts: 0}]);
    expect(db.prepare("select count(*) from outbox_handler_receipts").pluck().get()).toBe(2);
  } finally { db.close(); }
});

test("Provider configuration only controls worker launch, after durable local work has completed", async () => {
  const input = await fixture();
  await runIntegrationHook(hookOptions(input), hookInput(input));
  const startWorker = vi.fn(async () => {
    const db = openDatabase(input.dbPath);
    try {
      expect(db.prepare("select count(*) from outbox_messages where status = 'completed'").pluck().get()).toBe(2);
      expect(db.prepare("select status, attempts from distill_jobs").all()).toEqual([{status: "pending", attempts: 0}]);
    } finally { db.close(); }
  });
  const local = await runHookFollowUp({...followUpOptions(input), startWorker});
  expect(local).toMatchObject({worker: "not_configured", outbox: {completed: 2, failed: 0}});
  expect(startWorker).not.toHaveBeenCalled();
  const resumed = await runHookFollowUp({...followUpOptions(input), startWorker,
    env: {MIRA_LLM_BASE_URL: "https://provider.invalid/v1", MIRA_LLM_MODEL: "fixture"}});
  expect(resumed).toMatchObject({worker: "launched", outbox: {completed: 0, failed: 0}});
  expect(startWorker).toHaveBeenCalledTimes(1);
});

test("a worker launch failure preserves capture and the next unchanged Stop can launch it again", async () => {
  const input = await fixture();
  const startWorker = vi.fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("fixture worker launch failed"))
    .mockResolvedValue(undefined);
  const options = {...hookOptions(input), onCaptureSettled: async () => {
    await runHookFollowUp({...followUpOptions(input), startWorker,
      env: {MIRA_LLM_BASE_URL: "https://provider.invalid/v1", MIRA_LLM_MODEL: "fixture"}});
  }};
  expect(await runIntegrationHook(options, hookInput(input))).toMatchObject({status: "captured"});
  expect(await runIntegrationHook(options, hookInput(input))).toMatchObject({status: "ignored", reason: "transcript-unchanged"});
  expect(startWorker).toHaveBeenCalledTimes(2);
  const db = openDatabase(input.dbPath);
  try {
    expect(db.prepare("select count(*) from threads").pluck().get()).toBe(1);
    expect(db.prepare("select count(*) from capture_records").pluck().get()).toBe(1);
    expect(db.prepare("select status, attempts from distill_jobs").all()).toEqual([{status: "pending", attempts: 0}]);
    expect(db.prepare("select count(*) from memories").pluck().get()).toBe(0);
  } finally { db.close(); }
});

test("an unchanged Stop retries due local enqueue failure without replaying completed projection work", async () => {
  const input = await fixture();
  const setup = openDatabase(input.dbPath);
  migrate(setup);
  setup.exec("create trigger fail_hook_enqueue before insert on distill_jobs begin select raise(ABORT, 'fixture local enqueue failed'); end");
  setup.close();
  vi.useFakeTimers({toFake: ["Date"]});
  const options = {...hookOptions(input), onCaptureSettled: async () => { await runHookFollowUp(followUpOptions(input)); }};
  expect(await runIntegrationHook(options, hookInput(input))).toMatchObject({status: "captured"});
  const db = openDatabase(input.dbPath);
  try {
    expect(db.prepare("select status, attempts from outbox_messages where topic = 'capture.distill.requested'").get())
      .toEqual({status: "pending", attempts: 1});
    expect(db.prepare("select count(*) from distill_jobs").pluck().get()).toBe(0);
    db.exec("drop trigger fail_hook_enqueue");
    vi.setSystemTime(Date.now() + 2_000);
    expect(await runIntegrationHook(options, hookInput(input))).toMatchObject({status: "ignored", reason: "transcript-unchanged"});
    expect(db.prepare("select status, attempts from outbox_messages where topic = 'capture.distill.requested'").get())
      .toEqual({status: "completed", attempts: 2});
    expect(db.prepare("select status, attempts from outbox_messages where topic = 'projection.refresh.requested'").get())
      .toEqual({status: "completed", attempts: 1});
    expect(db.prepare("select status, attempts from distill_jobs").all()).toEqual([{status: "pending", attempts: 0}]);
  } finally { db.close(); }
});
