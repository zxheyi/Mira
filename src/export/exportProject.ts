import type Database from "better-sqlite3";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { listMemoriesForProject } from "../memory/memoryStore.js";
import { listWorkingMemory } from "../workingMemory/workingMemoryStore.js";

type ProjectRow = {
  id: string;
  name: string;
  root_path: string;
  created_at: string;
};

export type ExportFormat = "json" | "markdown";

export type ExportResult = {
  ok: true;
  files: string[];
};

function projectForId(db: Database.Database, projectId: string): ProjectRow {
  const row = db
    .prepare("select id, name, root_path, created_at from projects where id = ?")
    .get(projectId) as ProjectRow | undefined;

  if (!row) {
    throw new Error(`Project not found: ${projectId}`);
  }

  return row;
}

function renderMarkdown(db: Database.Database, projectId: string): string {
  const project = projectForId(db, projectId);
  const workingMemory = listWorkingMemory(db, projectId);
  const memories = listMemoriesForProject(db, projectId);
  const lines = [
    "# Mira Export",
    "",
    `Project: ${project.name}`,
    `Root: ${project.root_path}`,
    "",
    "## Working Memory"
  ];

  if (workingMemory.length === 0) {
    lines.push("No working memory recorded.", "");
  } else {
    for (const item of workingMemory) {
      lines.push(`### ${item.kind}`, item.content, "");
    }
  }

  lines.push("## Memories");
  if (memories.length === 0) {
    lines.push("No memories recorded.");
  } else {
    for (const memory of memories) {
      lines.push(`### ${memory.title}`);
      lines.push(`- kind: ${memory.kind}`);
      lines.push(`- source: ${memory.source}`);
      lines.push(`- confidence: ${memory.confidence}`);
      lines.push(`- importance: ${memory.importance}`);
      lines.push(memory.content, "");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

function renderJson(db: Database.Database, projectId: string): string {
  const project = projectForId(db, projectId);

  return JSON.stringify(
    {
      project: {
        id: project.id,
        name: project.name,
        rootPath: project.root_path,
        createdAt: project.created_at
      },
      workingMemory: listWorkingMemory(db, projectId),
      memories: listMemoriesForProject(db, projectId)
    },
    null,
    2
  ) + "\n";
}

export async function exportProject(
  db: Database.Database,
  projectId: string,
  format: ExportFormat,
  outDir: string
): Promise<ExportResult> {
  const resolvedOutDir = resolve(outDir);
  await mkdir(resolvedOutDir, { recursive: true });

  if (format === "json") {
    const filePath = join(resolvedOutDir, "mira-export.json");
    await writeFile(filePath, renderJson(db, projectId), "utf8");
    return { ok: true, files: [filePath] };
  }

  const filePath = join(resolvedOutDir, "mira-export.md");
  await writeFile(filePath, renderMarkdown(db, projectId), "utf8");
  return { ok: true, files: [filePath] };
}
