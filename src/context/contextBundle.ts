import type Database from "better-sqlite3";
import { listMemoriesForProject, searchMemories, type Memory } from "../memory/memoryStore.js";
import { listWorkingMemory } from "../workingMemory/workingMemoryStore.js";

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
    return searchMemories(db, projectId, query)
      .slice(0, limit)
      .map((result) => result.memory);
  }

  return listMemoriesForProject(db, projectId)
    .sort((left, right) => right.importance - left.importance || right.confidence - left.confidence)
    .slice(0, limit);
}

function truncateToBudget(markdown: string, maxCharacters?: number): string {
  if (!maxCharacters || markdown.length <= maxCharacters) {
    return markdown;
  }

  if (maxCharacters <= 3) {
    return markdown.slice(0, maxCharacters);
  }

  return markdown.slice(0, maxCharacters - 3).trimEnd() + "...";
}

export function buildContextBundle(
  db: Database.Database,
  projectId: string,
  options: BuildContextBundleOptions = {}
): string {
  const workingMemory = listWorkingMemory(db, projectId);
  const memories = durableMemories(db, projectId, options);
  const lines: string[] = ["# Mira Context Bundle", ""];

  lines.push("## Working Memory");
  if (workingMemory.length === 0) {
    lines.push("No working memory recorded.");
  } else {
    for (const item of workingMemory) {
      lines.push(`### ${item.kind}`, item.content, "");
    }
  }

  lines.push("## Long-Term Memory");
  if (memories.length === 0) {
    lines.push("No matching long-term memory.");
  } else {
    for (const memory of memories) {
      lines.push(`### ${memory.title}`);
      lines.push(`- kind: ${memory.kind}`);
      lines.push(`- source: ${memory.source}`);
      lines.push(`- confidence: ${memory.confidence}`);
      lines.push(memory.content);
      lines.push("");
    }
  }

  return truncateToBudget(lines.join("\n").trimEnd() + "\n", options.maxCharacters);
}
