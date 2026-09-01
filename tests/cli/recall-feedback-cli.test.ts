import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { callMiraTool } from "../../src/mcp/server.js";

test("CLI records the same Recall Feedback and quality report exposed by MCP", () => {
  const root = mkdtempSync(join(tmpdir(), "mira-recall-feedback-cli-"));
  const dbPath = join(root, ".mira", "mira.sqlite");
  const options = {projectRoot:root,dbPath,
    confirmationPolicy:{actor:"test",reason:"Seed confirmed Memory"}};
  const run = (...args:string[]) => JSON.parse(execFileSync(process.execPath,
    ["--import","tsx","src/index.ts","--project-root",root,"--db",dbPath,...args],
    {encoding:"utf8"}));
  try {
    const memory = callMiraTool(options, "add_memory", {
      title:"CLI Recall",kind:"fact",content:"Recall feedback stays local.",source:"manual"
    }) as {id:string};
    const packet = callMiraTool({...options,confirmationPolicy:undefined}, "prepare_context", {
      query:"feedback local"
    }) as {receipt:{id:string}};

    const feedback = run("context","feedback","--recall",packet.receipt.id,"--outcome","useful",
      "--relevant-memory",memory.id,"--reason","The expected Memory was useful.");
    expect(feedback).toMatchObject({recallId:packet.receipt.id,outcome:"useful",
      relevantMemoryIds:[memory.id],actor:"cli"});
    expect(run("context","quality")).toEqual(
      callMiraTool({...options,confirmationPolicy:undefined}, "get_recall_quality_report", {})
    );
  } finally { rmSync(root, {recursive:true,force:true}); }
});
