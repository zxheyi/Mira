import type Database from "better-sqlite3";
import { listTopMemoriesForProject, searchMemories, type Memory } from "../memory/memoryStore.js";
import { listWorkingMemory, type WorkingMemory } from "../workingMemory/workingMemoryStore.js";

export type BuildContextBundleOptions = {
  query?: string;
  memoryLimit?: number;
  maxCharacters?: number;
};

function durableMemories(
  db: Database.Database,
  projectId: string,
  options: BuildContextBundleOptions
): Memory[] {
  const limit = options.memoryLimit ?? 8;
  const query = options.query?.trim();

  if (query) {
    const exactResults = searchMemories(db, projectId, query, { limit });
    const fallbackResults = exactResults.length > 0
      ? exactResults
      : searchMemories(db, projectId, query, { limit, queryMode: "orTerms" });

    return fallbackResults.map((result) => result.memory);
  }

  return listTopMemoriesForProject(db, projectId, limit);
}

const WORKING_MEMORY_PRIORITY = new Map<string, number>([
  ["blocker", 0],
  ["current_task", 1],
  ["current_phase", 2],
  ["next_step", 3],
  ["recent_decision", 4],
  ["preference", 5],
  ["decision", 6],
  ["note", 7]
]);

const WARNING_KINDS = new Set(["failed_attempt", "lesson", "constraint"]);

function sortWorkingMemory(items: WorkingMemory[]): WorkingMemory[] {
  return [...items].sort(
    (left, right) =>
      (WORKING_MEMORY_PRIORITY.get(left.kind) ?? 99) - (WORKING_MEMORY_PRIORITY.get(right.kind) ?? 99) ||
      left.updatedAt.localeCompare(right.updatedAt)
  );
}

function memoryEntry(memory: Memory, options: { includeCreatedAt: boolean }): string {
  const lines = [`### ${memory.title}`, `- kind: ${memory.kind}`];

  if (options.includeCreatedAt) {
    lines.push(`- createdAt: ${memory.createdAt}`);
  }

  if (memory.source !== "manual") {
    lines.push(`- source: ${memory.source}`);
  }
  if (memory.confidence !== 1) {
    lines.push(`- confidence: ${memory.confidence}`);
  }

  lines.push(memory.content);
  return lines.join("\n");
}

function pushBudgetedEntries(lines: string[], entries: string[], maxCharacters: number | undefined): number {
  let omitted = 0;

  for (const entry of entries) {
    const candidate = [...lines, entry, ""].join("\n").trimEnd() + "\n";
    if (maxCharacters && candidate.length > maxCharacters) {
      omitted += 1;
      continue;
    }
    lines.push(entry, "");
  }

  return omitted;
}

export function buildContextBundle(
  db: Database.Database,
  projectId: string,
  options: BuildContextBundleOptions = {}
): string {
  const workingMemory = sortWorkingMemory(listWorkingMemory(db, projectId));
  const memories = durableMemories(db, projectId, options);
  const warningMemories = memories.filter((memory) => WARNING_KINDS.has(memory.kind));
  const regularMemories = memories.filter((memory) => !WARNING_KINDS.has(memory.kind));
  const lines: string[] = ["# Mira Context Bundle", ""];

  lines.push("## Working Memory");
  if (workingMemory.length === 0) {
    lines.push("No working memory recorded.");
  } else {
    for (const item of workingMemory) {
      lines.push(`### ${item.kind}`, `- updatedAt: ${item.updatedAt}`, item.content, "");
    }
  }

  if (warningMemories.length > 0) {
    lines.push("## Warnings");
    for (const memory of warningMemories) {
      lines.push(memoryEntry(memory, { includeCreatedAt: !options.maxCharacters }), "");
    }
  }

  lines.push("## Long-Term Memory");
  if (regularMemories.length === 0) {
    lines.push("No matching long-term memory.");
  } else {
    const omitted = pushBudgetedEntries(
      lines,
      regularMemories.map((memory) => memoryEntry(memory, { includeCreatedAt: !options.maxCharacters })),
      options.maxCharacters
    );
    if (omitted > 0) {
      lines.push(`Some long-term memories were omitted due to maxCharacters. (${omitted} omitted)`);
    }
  }

  const markdown = lines.join("\n").trimEnd() + "\n";
  if (options.maxCharacters && options.maxCharacters <= 3 && markdown.length > options.maxCharacters) {
    return markdown.slice(0, options.maxCharacters);
  }
  return markdown;
}
