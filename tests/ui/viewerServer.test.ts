import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Script } from "node:vm";
import { request } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { listProjectBriefings, rebuildProjectBriefing } from "../../src/briefing/projectBriefingStore.js";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { createHistoryImportRun, finishHistoryImportRun } from "../../src/history/historyImportStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { saveThread } from "../../src/threads/threadStore.js";
import { startViewerServer, type ViewerServerHandle } from "../../src/ui/viewerServer.js";
import { setWorkingMemory } from "../../src/workingMemory/workingMemoryStore.js";
import { curateMemory } from "../../src/memory/curationService.js";
import { getMemory } from "../../src/memory/memoryLifecycleStore.js";
import { listRecallEvents } from "../../src/context/recallAuditStore.js";

let db: Database.Database | undefined;
let handle: ViewerServerHandle | undefined;
afterEach(async () => {
  await handle?.close();
  handle = undefined;
  db?.close();
  db = undefined;
});

async function setupServer() {
  const root = await mkdtemp(join(tmpdir(), "mira-viewer-server-"));
  await mkdir(join(root, ".git"));
  const dbPath = join(root, ".mira", "mira.sqlite");
  db = openDatabase(dbPath);
  migrate(db);
  const project = createProject(db, { name: "ViewerProject", rootPath: root });
  saveThread(db, {
    id: "thread_viewer_one",
    projectId: project.id,
    title: "Viewer Thread",
    source: "codex",
    rawFormat: "markdown",
    rawText: `# Viewer Thread

This transcript appears in the UI.`
  });
  setWorkingMemory(db, { projectId: project.id, kind: "current_task", content: "Open Mira UI." });
  const run = createHistoryImportRun(db, {
    projectId: project.id,
    agents: ["codex"],
    rootAliases: [],
    options: { distill: false }
  });
  finishHistoryImportRun(db, run.id, {
    scanned: 1,
    imported: 1,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0
  });
  rebuildProjectBriefing(db, project.id);
  handle = await startViewerServer({ projectRoot: root, dbPath, host: "127.0.0.1", port: 0 });
  return { root, dbPath, project, url: handle.url };
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.ok).toBe(true);
  return await response.json() as T;
}

describe("viewer server", () => {
  test("authenticated same-origin corrections use immutable history; previews create no recalls", async () => {
    const {url, project} = await setupServer();
    const memory = curateMemory(db!, {operation: "add", input: {projectId: project.id, title: "Old", content: "Original", kind: "fact", source: "manual", confidence: 1, importance: 5}});
    const session = await json<{csrfToken: string}>(`${url}/api/session`);
    const path = `${url}/api/memory/${memory.id}`;
    const body = JSON.stringify({action: "correct", content: "Approved replacement", reason: "User corrected"});
    expect((await fetch(path, {method: "POST", headers: {"content-type": "application/json"}, body})).status).toBe(403);
    const headers = {"content-type": "application/json", origin: url, "x-mira-csrf": session.csrfToken};
    expect((await fetch(path, {method: "POST", headers: {...headers, origin: "http://untrusted.test"}, body})).status).toBe(403);
    const response = await fetch(path, {method: "POST", headers, body});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({content: "Approved replacement", supersedesMemoryId: memory.id});
    expect(getMemory(db!, project.id, memory.id)?.status).toBe("superseded");
    const before = listProjectBriefings(db!, project.id);
    await json(`${url}/api/overview`);
    await json(`${url}/api/briefing`);
    await json(`${url}/api/context-bundle`);
    expect(listRecallEvents(db!, project.id)).toEqual([]);
    expect(listProjectBriefings(db!, project.id)).toEqual(before);
    expect((await fetch(path, {method:"POST", headers, body: JSON.stringify({action:"archive", projectId:"another-project"})})).status).toBe(400);
    expect((await fetch(path, {method:"POST", headers, body:"x".repeat(66_000)})).status).toBe(413);
    expect((await fetch(path, {method:"POST", headers:{...headers,"content-type":"text/plain"},body})).status).toBe(415);
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(url, {headers:{Host:"untrusted.test"}}, response => { response.resume(); resolve(response.statusCode); });
      req.on("error", reject); req.end();
    });
    expect(hostStatus).toBe(403);
  });

  test("refuses unauthenticated remote binding", async () => {
    const {root, dbPath} = await setupServer();
    await expect(startViewerServer({projectRoot:root, dbPath,host:"0.0.0.0",port:0})).rejects.toThrow(/loopback-only/);
  });
  test("serves the dashboard shell", async () => {
    const { url } = await setupServer();

    const response = await fetch(url);
    const html = await response.text();

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("Mira 本地 Viewer");
    expect(html).toContain("总览");
    expect(html).toContain("会话");
    expect(() => new Script(html.match(/<script>([\s\S]*?)<\/script>/)![1])).not.toThrow();
  });

  test("serves read-only project APIs", async () => {
    const { url } = await setupServer();

    const overview = await json<{ counts: { threads: number }; latestImportRun: { importedCount: number } }>(`${url}/api/overview`);
    const threads = await json<Array<{ id: string; preview: string; rawText?: string }>>(`${url}/api/threads`);
    const detail = await json<{ id: string; rawText: string }>(`${url}/api/threads/thread_viewer_one`);
    const runs = await json<Array<{ importedCount: number }>>(`${url}/api/import-runs`);
    const briefing = await json<{ markdown: string }>(`${url}/api/briefing`);
    const bundle = await json<{ markdown: string }>(`${url}/api/context-bundle`);

    expect(overview.counts.threads).toBe(1);
    expect(overview.latestImportRun.importedCount).toBe(1);
    expect(threads).toEqual([expect.objectContaining({ id: "thread_viewer_one", preview: expect.stringContaining("transcript") })]);
    expect(threads[0].rawText).toBeUndefined();
    expect(detail.rawText).toContain("appears in the UI");
    expect(runs[0].importedCount).toBe(1);
    expect(briefing.markdown).toContain("Open Mira UI");
    expect(bundle.markdown).toContain("# Mira Context Bundle");
  });

  test("returns 404 for unknown routes and missing threads", async () => {
    const { url } = await setupServer();

    expect((await fetch(`${url}/missing`)).status).toBe(404);
    expect((await fetch(`${url}/api/threads/missing`)).status).toBe(404);
  });
});
