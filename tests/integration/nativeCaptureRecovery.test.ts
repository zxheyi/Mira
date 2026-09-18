import {expect, test} from "vitest";
import {appendFile, mkdtemp, mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {openDatabase} from "../../src/db/client.js";
import {migrate} from "../../src/db/schema.js";
import {ensureProjectForRoot} from "../../src/projects/projectStore.js";

const cli = join(process.cwd(), "dist/src/index.js");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "mira-native-recovery-"));
  const claude = join(root, "claude");
  const transcript = join(claude, "projects", "native.jsonl");
  await mkdir(join(claude, "projects"), {recursive:true});
  const dbPath = join(root, "mira.sqlite");
  const db = openDatabase(dbPath); migrate(db); ensureProjectForRoot(db, root);
  const env: Record<string,string> = {CLAUDE_CONFIG_DIR:claude};
  for (const [key,value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "CLAUDE_CONFIG_DIR" && !key.startsWith("MIRA_LLM_")) env[key] = value;
  }
  const hook = (event: string) => execFileSync(process.execPath, [cli,"--project-root",root,"--db",dbPath,"integration","hook","--agent","claude-code"], {
    env, encoding:"utf8", input:JSON.stringify({session_id:"native-recovery",transcript_path:transcript,cwd:root,hook_event_name:event})
  });
  return {root,transcript,dbPath,db,env,hook};
}

test("real native hooks preserve long transcripts and metadata-only replay drains local work without a model", async () => {
  const f = await fixture();
  try {
    const longBody = "Full transcript evidence. ".repeat(3000)+"END_OF_FULL_TRANSCRIPT";
    await writeFile(f.transcript, [
      {role:"user",content:longBody},
      {role:"assistant",content:"Captured the full session."}
    ].map(value => JSON.stringify(value)).join("\n")+"\n");
    expect(f.hook("Stop")).toBe("");
    const stored = f.db.prepare("select raw_text from threads").get() as {raw_text:string};
    expect(stored.raw_text).toContain(longBody);
    expect(f.db.prepare("select count(*) n from outbox_messages where status='completed'").get()).toEqual({n:2});
    expect(f.db.prepare("select count(*) n from distill_jobs where status='pending' and attempts=0").get()).toEqual({n:1});

    // The host can append progress records after Stop without adding a message.
    await appendFile(f.transcript, JSON.stringify({type:"progress",data:{status:"session ended"}})+"\n");
    expect(f.hook("SessionEnd")).toBe("");
    expect(f.db.prepare("select count(*) n from lifecycle_turns").get()).toEqual({n:1});
    expect(f.db.prepare("select count(*) n from capture_records").get()).toEqual({n:1});
    expect(f.db.prepare("select count(*) n from outbox_messages").get()).toEqual({n:2});
    expect(f.db.prepare("select count(*) n from distill_jobs").get()).toEqual({n:1});
    expect(f.db.prepare("select size from integration_cursors").get()).toEqual({size:(await stat(f.transcript)).size});
    const diagnostics = await readFile(join(f.root,".mira","integrations.log"),"utf8").catch(error => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    expect(diagnostics).not.toContain("hook-processing-failed");
  } finally { f.db.close(); await rm(f.root,{recursive:true,force:true}); }
});

test("real MCP session capture is recovered into local jobs and a fresh briefing by the next native SessionStart", async () => {
  const f = await fixture();
  const client = new Client({name:"capture-recovery-acceptance",version:"1"},{capabilities:{}});
  try {
    await client.connect(new StdioClientTransport({command:process.execPath,args:[cli,"--project-root",f.root,"--db",f.dbPath,"mcp","serve","--profile","core"],env:f.env,stderr:"pipe"}));
    const query = "Historical source ".repeat(2000)+"FULL_QUERY_TAIL";
    const answer = "Historical answer ".repeat(2000)+"FULL_ANSWER_TAIL";
    const response = await client.callTool({name:"after_turn",arguments:{host:"cli",
      sessionId:"mcp-history",turnId:"capture-1",query,response:answer,status:"succeeded"
    }});
    expect(response.isError,JSON.stringify(response)).not.toBe(true);
    const stored = f.db.prepare("select raw_text from threads").get() as {raw_text:string};
    expect(stored.raw_text.length).toBeGreaterThan(50_000);
    expect(stored.raw_text).toContain(query);
    expect(stored.raw_text).toContain(answer);
    expect(f.db.prepare("select count(*) n from outbox_messages where status='pending'").get()).toEqual({n:2});
    expect(f.hook("SessionStart")).toContain("# Mira Context Bundle");
    expect(f.db.prepare("select count(*) n from outbox_messages where status='pending'").get()).toEqual({n:0});
    expect(f.db.prepare("select count(*) n from outbox_messages where status='completed'").get()).toEqual({n:2});
    expect(f.db.prepare("select count(*) n from distill_jobs where status='pending' and attempts=0").get()).toEqual({n:1});
    expect(f.db.prepare("select stale_at from project_briefings order by version desc limit 1").get()).toEqual({stale_at:null});
    expect(f.hook("SessionStart")).toContain("# Mira Context Bundle");
    expect(f.db.prepare("select count(*) n from distill_jobs").get()).toEqual({n:1});
  } finally { await client.close(); f.db.close(); await rm(f.root,{recursive:true,force:true}); }
});
