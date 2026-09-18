import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { createProject } from "../../src/projects/projectStore.js";
import { addMemory } from "../../src/memory/memoryStore.js";
import { archiveMemory } from "../../src/memory/memoryLifecycleStore.js";
import { setWorkingMemory } from "../../src/workingMemory/workingMemoryStore.js";
import type { ContextPacket } from "../../src/context/contextPreparation.js";

const contributionRules = [
  "Work on a topic branch for every repository change.",
  "Open a pull request to merge changes into main.",
  "Keep main as the protected integration branch: changes reach main only through a reviewed PR merge.",
  "Do not commit directly on main or push directly to main."
].join("\n");

async function withEntrypoints(run: (fixture: {
  db: ReturnType<typeof openDatabase>;
  projectId: string;
  contributionId: string;
  portId: string;
  databaseId: string;
  preview: (query: string, maxTokens?: number) => Promise<ContextPacket[]>;
}) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "mira-recall-optimization-"));
  const dbPath = join(root, "mira.sqlite");
  const db = openDatabase(dbPath);
  const client = new Client({ name: "recall-optimization-acceptance", version: "1" }, { capabilities: {} });
  try {
    migrate(db);
    const project = createProject(db, { name: "Mira", rootPath: root });
    const other = createProject(db, { name: "Other", rootPath: join(root, "other") });
    const base = { projectId: project.id, kind: "convention" as const, source: "manual", confidence: 1, importance: 5 };
    const contribution = addMemory(db, { ...base, title: "Mira 仓库贡献流程", content: contributionRules });
    const port = addMemory(db, {
      ...base, kind: "fact", title: "Mira Viewer port",
      content: "Mira Viewer uses a local listener on TCP port 4317 at 127.0.0.1. It binds loopback only."
    });
    const database = addMemory(db, {
      ...base, kind: "fact", title: "Mira database engine",
      content: "Mira uses SQLite, a local database engine. The authoritative database is .mira/mira.sqlite."
    });
    addMemory(db, { ...base, projectId: other.id, title: contribution.title, content: contributionRules, importance: 10 });
    const archived = addMemory(db, {
      ...base, title: "Mira retired contribution policy", content: `${contributionRules}\nRetired policy version.`, importance: 10
    });
    archiveMemory(db, project.id, archived.id, "test", "Replaced by the current contribution rules.");

    const cliPath = join(process.cwd(), "dist/src/index.js");
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [cliPath, "--project-root", root, "--db", dbPath, "mcp", "serve", "--profile", "core"],
      stderr: "pipe"
    }));
    const preview = async (query: string, maxTokens = 2000): Promise<ContextPacket[]> => {
      const cli = JSON.parse(execFileSync(process.execPath, [
        cliPath, "--project-root", root, "--db", dbPath, "context", "prepare", "--preview",
        "--query", query, "--max-tokens", String(maxTokens)
      ], { encoding: "utf8" })) as ContextPacket;
      const response = await client.callTool({
        name: "prepare_context", arguments: { query, maxTokens, preview: true, expectedProjectId: project.id }
      });
      expect(response.isError).not.toBe(true);
      const mcp = JSON.parse((response.content as Array<{ text: string }>)[0].text) as ContextPacket;
      expect(mcp.markdown).toEqual(cli.markdown);
      expect(mcp.scope).toEqual(cli.scope);
      for (const packet of [cli, mcp]) {
        expect(packet.receipt.recorded).toBe(false);
        expect(packet.receipt.tokenUpperBound).toBeLessThanOrEqual(maxTokens);
      }
      return [cli, mcp];
    };
    await run({ db, projectId: project.id, contributionId: contribution.id, portId: port.id, databaseId: database.id, preview });
    expect(db.prepare("select count(*) as n from recall_events").get()).toEqual({ n: 0 });
    expect(db.prepare("select count(*) as n from recall_feedback").get()).toEqual({ n: 0 });
  } finally {
    await client.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("CLI and MCP previews resolve bounded contribution paraphrases without archived or cross-project matches", async () => {
  await withEntrypoints(async ({ contributionId, preview }) => {
    for (const query of [
      "修完缺陷后，可以直接把改动放到主干吗？",
      "开发新功能时，应该在哪条分支上工作？",
      "Can I bypass peer approval when integrating a fix?"
    ]) {
      for (const packet of await preview(query)) {
        expect(packet.receipt.candidateMemoryIds, query).toEqual([contributionId]);
        expect(packet.receipt.injectedMemoryIds, query).toEqual([contributionId]);
        expect(packet.markdown).toContain(contributionRules);
      }
    }
  });
});

test("specific port and database queries do not retrieve contribution rules through common terms", async () => {
  await withEntrypoints(async ({ portId, databaseId, preview }) => {
    for (const [query, expectedId] of [
      ["Mira 默认监听端口是多少？", portId],
      ["What database engine does this project use?", databaseId]
    ]) {
      for (const packet of await preview(query)) {
        expect(packet.receipt.candidateMemoryIds, query).toEqual([expectedId]);
        expect(packet.receipt.injectedMemoryIds, query).toEqual([expectedId]);
      }
    }
  });
});

test("1,000-token previews retain critical working state and the query rule ahead of a longer next step", async () => {
  await withEntrypoints(async ({ db, projectId, contributionId, preview }) => {
    const blocker = setWorkingMemory(db, { projectId, kind: "blocker", content: "Release is blocked until the failing documentation check is repaired." });
    const current = setWorkingMemory(db, { projectId, kind: "current_task", content: "Review the contribution workflow before preparing the patch." });
    const next = setWorkingMemory(db, {
      projectId, kind: "next_step",
      content: "After this review, refresh the source installation guide, verify its English and Chinese examples, inspect every local documentation link, check the sample configuration, record the build result, prepare the release notes, compare the screenshots with the local Viewer, and summarize any outstanding documentation questions for the next session."
    });
    for (const packet of await preview("topic branch reviewed PR main", 1000)) {
      expect(packet.receipt.injectedMemoryIds).toEqual([contributionId]);
      expect(packet.markdown).toContain(contributionRules);
      expect(packet.markdown).toContain(blocker.content);
      expect(packet.markdown).toContain(current.content);
      expect(packet.receipt.selections).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "working_memory", id: blocker.id, selected: true }),
        expect.objectContaining({ type: "working_memory", id: current.id, selected: true }),
        expect.objectContaining({ type: "working_memory", id: next.id, selected: false, reasons: expect.arrayContaining(["budget"]) })
      ]));
    }
  });
});
