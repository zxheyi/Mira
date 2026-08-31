import { mkdtemp, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { ensureProjectForRoot } from "../../src/projects/projectStore.js";
import { deleteThread, getThread, listThreadsForProject } from "../../src/threads/threadStore.js";
import { getCaptureCursor } from "../../src/integrations/captureCursorStore.js";
import { runIntegrationHook } from "../../src/integrations/hookRuntime.js";
import { importProjectHistory } from "../../src/history/historyImportService.js";
import { stableThreadId } from "../../src/integrations/threadIdentity.js";
import { prepareContext } from "../../src/context/contextPreparation.js";

test.each(["codex", "claude-code"] as const)("%s Hook and history share capture identity without rewriting unchanged evidence", async (agent) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "mira-capture-adapters-")));
  const path = join(root, "source.jsonl");
  const records = agent === "codex" ? [
    {type: "session_meta", payload: {id: "shared", cwd: root}},
    {type: "response_item", payload: {type: "message", role: "user", content: [{type: "input_text", text: "Keep this evidence."}]}}
  ] : [{sessionId: "shared", cwd: root, type: "user", message: {role: "user", content: "Keep this evidence."}}];
  await writeFile(path, records.map(record => JSON.stringify(record)).join("\n"));
  const dbPath = join(root, ".mira", "mira.sqlite");
  const db = openDatabase(dbPath); migrate(db);
  const project = ensureProjectForRoot(db, root);
  const runtime = {agent, projectRoot: root, dbPath, allowedTranscriptRoots: [root]};
  const input = {session_id: "shared", cwd: root, transcript_path: path, hook_event_name: "Stop"};
  try {
    expect((await runIntegrationHook(runtime, input)).status).toBe("captured");
    const first = getThread(db, project.id, stableThreadId(agent, "shared"));
    const checkpoint = getCaptureCursor(db, project.id, agent, "shared");
    const metadata = await stat(path);
    const report = await importProjectHistory({db, project, projectRoot: root, agents: [agent],
      scan: async () => [{agent, sessionId: "shared", cwd: root, filePath: path, size: metadata.size, mtimeMs: metadata.mtimeMs}]});
    expect(report.items[0]).toMatchObject({outcome: "unchanged", threadId: first?.id});
    expect((await runIntegrationHook(runtime, input))).toMatchObject({status: "ignored", reason: "transcript-unchanged"});
    expect(listThreadsForProject(db, project.id)).toEqual([first]);
    expect(getCaptureCursor(db, project.id, agent, "shared")).toEqual(checkpoint);
    expect(prepareContext(db, project.id, {recordAudit: false}).receipt.injectedMemoryIds).toEqual([]);
    deleteThread(db, project.id, first!.id);
    expect((await runIntegrationHook(runtime, input)).status).toBe("captured");
    expect(listThreadsForProject(db, project.id)).toHaveLength(1);
  } finally { db.close(); }
});
