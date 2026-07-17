import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rebuildProjectBriefing } from "../../src/briefing/projectBriefingStore.js";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { submitMemoryCandidates } from "../../src/distill/candidateService.js";
import { archiveMemory, updateMemory } from "../../src/memory/memoryLifecycleStore.js";
import { addMemory } from "../../src/memory/memoryStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { saveThread } from "../../src/threads/threadStore.js";
import { setWorkingMemory } from "../../src/workingMemory/workingMemoryStore.js";
import {
  readVaultSnapshot,
  renderMarkdownVault,
  syncMarkdownVault,
  type VaultFileSystem
} from "../../src/vault/markdownVault.js";

let db: Database.Database | undefined;
afterEach(() => { db?.close(); db = undefined; });

function setup(rootPath: string) {
  db = openDatabase(":memory:");
  migrate(db);
  const project = createProject(db, { name: "Mira", rootPath });
  const thread = saveThread(db, {
    id: "../thread/id", projectId: project.id, title: "Agent session", source: "codex",
    rawFormat: "markdown", rawText: "Decision evidence: SQLite stays authoritative."
  });
  setWorkingMemory(db, { projectId: project.id, kind: "current_task", content: "Publish the Vault." });
  const predecessor = addMemory(db, {
    projectId: project.id, threadId: thread.id, title: "Old source rule", kind: "decision",
    content: "Markdown is authoritative.", source: "manual", confidence: 0.8, importance: 7
  });
  const successor = updateMemory(db, {
    projectId: project.id, memoryId: predecessor.id, title: "Source rule", kind: "decision",
    content: "SQLite stays authoritative.", source: "review", confidence: 1, importance: 10,
    actor: "test", reason: "Correct the source of truth"
  });
  archiveMemory(db, project.id, successor.id, "test", "Exercise lifecycle export");
  const active = addMemory(db, {
    projectId: project.id, threadId: thread.id, title: "Vault format", kind: "architecture",
    content: "Use deterministic Markdown files.", source: "manual", confidence: 0.95, importance: 9
  });
  submitMemoryCandidates(db, {
    projectId: project.id, threadId: thread.id, sourceAgent: "codex", extractionMethod: "agent",
    candidates: [{
      title: "Candidate source rule", kind: "fact", content: "SQLite stays authoritative.",
      evidence: "SQLite stays authoritative.", confidence: 0.4, importance: 0.6
    }]
  });
  rebuildProjectBriefing(db, project.id);
  return { database: db, project, thread, predecessor, successor, active };
}

async function readTree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(directory: string, prefix = "") {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(join(directory, entry.name), relative);
      else result[relative] = await readFile(join(directory, entry.name), "utf8");
    }
  }
  await visit(root);
  return result;
}

describe("Markdown Vault", () => {
  test("renders a deterministic, safe and traceable full-project snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-vault-render-"));
    const { database, project, thread, predecessor, successor, active } = setup(root);

    const first = renderMarkdownVault(readVaultSnapshot(database, project));
    const second = renderMarkdownVault(readVaultSnapshot(database, project));

    expect([...second]).toEqual([...first]);
    const memoryPaths = [active, predecessor, successor]
      .map((memory) => `memories/${memory.id}.md`)
      .sort();
    expect([...first.keys()]).toEqual([
      "index.md", "project-briefing.md", "working-memory.md", ...memoryPaths,
      "threads/%2E%2E%2Fthread%2Fid.md", "reviews/pending-candidates.md"
    ]);
    const predecessorPage = first.get(`memories/${predecessor.id}.md`) ?? "";
    expect(predecessorPage).toContain('status: "superseded"');
    expect(predecessorPage).toContain(`[[memories/${successor.id}|Source rule]]`);
    const successorPage = first.get(`memories/${successor.id}.md`) ?? "";
    expect(successorPage).toContain(`[[memories/${predecessor.id}|Old source rule]]`);
    expect(successorPage).toContain(`[[threads/%2E%2E%2Fthread%2Fid|Agent session]]`);
    expect(first.get("reviews/pending-candidates.md")).toContain("SQLite stays authoritative.");
    expect(first.get("reviews/pending-candidates.md")).toContain("[[threads/%2E%2E%2Fthread%2Fid|Agent session]]");
    expect(first.get("project-briefing.md")).toContain("# Mira Project Briefing");
    expect([...first.values()].every((content) => content.endsWith("\n"))).toBe(true);
    expect([...first.keys()].some((path) => path.includes("../"))).toBe(false);
    expect(thread.id).toBe("../thread/id");
  });

  test("atomically replaces a Vault and produces identical bytes on repeated sync", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-vault-sync-"));
    const { database, project } = setup(root);
    const output = join(root, "vault");
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "obsolete.md"), "old\n");

    const result = await syncMarkdownVault(database, project, output);
    const first = await readTree(output);
    expect(result.outputPath).toBe(output);
    expect(result.fileCount).toBe(Object.keys(first).length);
    expect(first["obsolete.md"]).toBeUndefined();

    await syncMarkdownVault(database, project, output);
    expect(await readTree(output)).toEqual(first);
  });

  test("restores the previous Vault when the final staging swap fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-vault-rollback-"));
    const { database, project } = setup(root);
    const output = join(root, "vault");
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "sentinel.md"), "keep me\n");

    const fileSystem: VaultFileSystem = {
      mkdir, writeFile, rm,
      rename: async (from, to) => {
        if (String(from).includes(".staging-") && String(to) === output) {
          throw new Error("simulated final swap failure");
        }
        await rename(from, to);
      }
    };

    await expect(syncMarkdownVault(database, project, output, { fileSystem }))
      .rejects.toThrow("simulated final swap failure");
    expect(await readTree(output)).toEqual({ "sentinel.md": "keep me\n" });
    expect((await readdir(root)).filter((name) => name.includes(".staging-") || name.includes(".backup-"))).toEqual([]);
  });

  test("rejects output paths that could replace the project or Mira control data", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-vault-protected-"));
    const { database, project } = setup(root);

    await expect(syncMarkdownVault(database, project, root)).rejects.toThrow(/protected path/);
    await expect(syncMarkdownVault(database, project, join(root, ".mira"))).rejects.toThrow(/protected path/);
    await expect(syncMarkdownVault(database, project, join(root, ".git"))).rejects.toThrow(/protected path/);
    await expect(syncMarkdownVault(database, project, join(root, ".."))).rejects.toThrow(/protected path/);
  });

  test("preserves the backup when rollback itself cannot restore the target", async () => {
    const root = await mkdtemp(join(tmpdir(), "mira-vault-backup-"));
    const { database, project } = setup(root);
    const output = join(root, "vault");
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "sentinel.md"), "last good copy\n");

    const fileSystem: VaultFileSystem = {
      mkdir, writeFile,
      rename: async (from, to) => {
        if (String(from).includes(".backup-") && String(to) === output) {
          throw new Error("simulated restore failure");
        }
        await rename(from, to);
      },
      rm: async (path, options) => {
        if (String(path).includes(".backup-")) throw new Error("simulated backup cleanup failure");
        await rm(path, options);
      }
    };

    await expect(syncMarkdownVault(database, project, output, { fileSystem }))
      .rejects.toThrow(/rollback was incomplete; backup:/);
    const backup = (await readdir(root)).find((name) => name.includes(".backup-"));
    expect(backup).toBeDefined();
    expect(await readFile(join(root, backup ?? "", "sentinel.md"), "utf8")).toBe("last good copy\n");
  });
});
