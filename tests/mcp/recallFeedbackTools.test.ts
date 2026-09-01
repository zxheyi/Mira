import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { callMiraTool, MIRA_MCP_TOOL_NAMES } from "../../src/mcp/server.js";

test("MCP records confirmed Recall Feedback and exposes a read-only quality report", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "mira-recall-feedback-mcp-"));
  const trusted = {projectRoot,dbPath:join(projectRoot,".mira","mira.sqlite"),
    confirmationPolicy:{actor:"mcp:user",reason:"User explicitly evaluated recalled Memory"}};
  const untrusted = {...trusted,confirmationPolicy:undefined};
  const memory = callMiraTool(trusted, "add_memory", {
    title:"Storage",kind:"decision",content:"Use SQLite.",source:"manual"
  }) as {id:string};
  const packet = callMiraTool(untrusted, "prepare_context", {query:"SQLite"}) as {
    receipt:{id:string;injectedMemoryIds:string[]}
  };
  expect(packet.receipt.injectedMemoryIds).toEqual([memory.id]);
  const input = {recallId:packet.receipt.id,outcome:"incorrect",correctedMemoryIds:[memory.id],
    reason:"The user corrected the selected database."};

  expect(MIRA_MCP_TOOL_NAMES).toEqual(expect.arrayContaining([
    "record_recall_feedback", "get_recall_quality_report"
  ]));
  expect(() => callMiraTool(untrusted, "record_recall_feedback", input)).toThrow(/authority/i);
  expect(() => callMiraTool(untrusted, "record_recall_feedback", {
    ...input,confirmationPolicy:trusted.confirmationPolicy
  })).toThrow(/Invalid MCP arguments/);
  expect(callMiraTool(trusted, "record_recall_feedback", input)).toMatchObject({
    recallId:packet.receipt.id,outcome:"incorrect",correctedMemoryIds:[memory.id],actor:"mcp:user"
  });
  const successor = callMiraTool(trusted, "update_memory", {
    memoryId:memory.id,content:"Use SQLite with WAL.",recallId:packet.receipt.id
  }) as {id:string;supersedesMemoryId:string};
  expect(successor).toMatchObject({supersedesMemoryId:memory.id});
  expect(callMiraTool(untrusted, "get_recall_quality_report", {})).toMatchObject({
    recallCount:1,labeledRecallCount:1,correctedMemoryIds:[memory.id],
    confirmedCorrectionMemoryIds:[memory.id],
    recommendation:{status:"insufficient_data"}
  });
});
