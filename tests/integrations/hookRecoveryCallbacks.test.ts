import {afterEach, expect, test, vi} from "vitest";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runIntegrationHook} from "../../src/integrations/hookRuntime.js";
import {openDatabase} from "../../src/db/client.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, {recursive:true, force:true}))); });

async function fixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), "mira-hook-recovery-")); roots.push(projectRoot);
  const transcriptPath = join(projectRoot, "session.jsonl");
  await writeFile(transcriptPath, JSON.stringify({role:"user",content:"Keep the persisted capture when local follow-up fails."})+"\n");
  return {runtime:{agent:"claude-code" as const,projectRoot,dbPath:join(projectRoot,"mira.sqlite"),allowedTranscriptRoots:[projectRoot]},
    input:{session_id:"recovery",transcript_path:transcriptPath,cwd:projectRoot,hook_event_name:"Stop"}};
}

test("unchanged capture retries failed follow-up without repeating capture notifications or durable events", async () => {
  const {runtime,input} = await fixture();
  const changed = vi.fn(async () => {});
  const settled = vi.fn(async () => { if (settled.mock.calls.length === 1) throw new Error("local queue unavailable"); });
  const options = {...runtime,onThreadCaptured:changed,onCaptureSettled:settled};
  expect(await runIntegrationHook(options,input)).toMatchObject({status:"captured"});
  expect(await runIntegrationHook(options,{...input,hook_event_name:"SessionEnd"})).toMatchObject({status:"ignored",reason:"transcript-unchanged"});
  expect(changed).toHaveBeenCalledTimes(1);
  expect(settled).toHaveBeenCalledTimes(2);
  expect(settled).toHaveBeenLastCalledWith(expect.objectContaining({threadId:"thread_claude_code_recovery",projectRoot:runtime.projectRoot,dbPath:runtime.dbPath}));
  expect(await readFile(join(runtime.projectRoot,".mira","integrations.log"),"utf8")).toContain("capture-followup-failed");
  const db = openDatabase(runtime.dbPath);
  try {
    expect(db.prepare("select count(*) n from threads").get()).toEqual({n:1});
    expect(db.prepare("select count(*) n from capture_records").get()).toEqual({n:1});
    expect(db.prepare("select count(*) n from outbox_messages").get()).toEqual({n:2});
  } finally {db.close();}
});

test("rejected capture cannot trigger local follow-up", async () => {
  const {runtime,input} = await fixture();
  const settled = vi.fn(async () => {});
  const result = await runIntegrationHook({...runtime,allowedTranscriptRoots:[join(runtime.projectRoot,"elsewhere")],onCaptureSettled:settled},input);
  expect(result).toMatchObject({status:"ignored",reason:"transcript-path-not-allowed"});
  expect(settled).not.toHaveBeenCalled();
});
