import type Database from "better-sqlite3";
import { ensureFreshProjectBriefing } from "../briefing/projectBriefingStore.js";
import {
  listTopMemoriesForProject,
  listTopMemoriesForProjectByKinds,
  searchMemories,
  type Memory
} from "../memory/memoryStore.js";
import { listWorkingMemory, type WorkingMemory } from "../workingMemory/workingMemoryStore.js";

export type BuildContextBundleOptions = {
  query?: string;
  memoryLimit?: number;
  maxCharacters?: number;
  maxTokens?: number;
};

function durableMemories(
  db: Database.Database,
  projectId: string,
  options: BuildContextBundleOptions
): Memory[] {
  const limit = options.memoryLimit ?? 8;
  const query = options.query?.trim();

  if (query) {
    const exactResults = searchMemories(db, projectId, query, { limit, queryMode: "phrase" });
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
const WARNING_MEMORY_KINDS = ["failed_attempt", "lesson", "constraint"] as const;

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
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const candidate = [...lines, entry, ""].join("\n").trimEnd() + "\n";
    if (maxCharacters !== undefined && candidate.length > maxCharacters) {
      return entries.length - index;
    }
    lines.push(entry, "");
  }

  return 0;
}

function pushBudgetedLine(lines: string[], line: string, maxCharacters: number | undefined): boolean {
  const candidate = [...lines, line].join("\n").trimEnd() + "\n";
  if (maxCharacters !== undefined && candidate.length > maxCharacters) {
    return false;
  }
  lines.push(line);
  return true;
}

function contextCharacterBudget(options: BuildContextBundleOptions): number | undefined {
  if (options.maxTokens !== undefined) {
    if (!Number.isInteger(options.maxTokens) || options.maxTokens < 25 || options.maxTokens > 250_000) {
      throw new Error("maxTokens must be an integer between 25 and 250000");
    }
  }
  const tokenCharacters = options.maxTokens === undefined ? undefined : options.maxTokens * 4;
  if (options.maxCharacters === undefined) return tokenCharacters;
  if (tokenCharacters === undefined) return options.maxCharacters;
  return Math.min(options.maxCharacters, tokenCharacters);
}

function pushBriefing(
  lines: string[],
  markdown: string,
  staleAt: string | undefined,
  maxCharacters: number | undefined
): boolean {
  const block = [
    "## Project Briefing",
    ...(staleAt ? [`> Warning: latest complete Briefing is stale since ${staleAt}.`] : []),
    markdown.trimEnd(),
    ""
  ];
  const candidate = [...lines, ...block].join("\n").trimEnd() + "\n";
  if (maxCharacters !== undefined && candidate.length > maxCharacters) {
    return false;
  }
  lines.push(...block);
  return true;
}

export function buildContextBundle(
  db: Database.Database,
  projectId: string,
  options: BuildContextBundleOptions = {}
): string {
  const maxCharacters = contextCharacterBudget(options);
  const briefing = ensureFreshProjectBriefing(db, projectId);
  const workingMemory = sortWorkingMemory(listWorkingMemory(db, projectId));
  const memories = durableMemories(db, projectId, options);
  const warningMemories = listTopMemoriesForProjectByKinds(
    db,
    projectId,
    WARNING_MEMORY_KINDS,
    options.memoryLimit ?? 8
  );
  const regularMemories = memories.filter((memory) => !WARNING_KINDS.has(memory.kind));
  const lines: string[] = ["# Mira Context Bundle", ""];

  lines.push("## Working Memory");
  if (workingMemory.length === 0) {
    pushBudgetedLine(lines, "No working memory recorded.", maxCharacters);
  } else {
    const omitted = pushBudgetedEntries(
      lines,
      workingMemory.map((item) => [`### ${item.kind}`, `- updatedAt: ${item.updatedAt}`, item.content].join("\n")),
      maxCharacters
    );
    if (omitted > 0) {
      pushBudgetedLine(lines, `Some working memory entries were omitted due to maxCharacters. (${omitted} omitted)`, maxCharacters);
    }
  }

  const briefingOmitted = briefing
    ? !pushBriefing(lines, briefing.markdown, briefing.staleAt, maxCharacters)
    : false;

  if (warningMemories.length > 0) {
    lines.push("## Warnings");
    const omitted = pushBudgetedEntries(
      lines,
      warningMemories.map((memory) => memoryEntry(memory, { includeCreatedAt: !maxCharacters })),
      maxCharacters
    );
    if (omitted > 0) {
      pushBudgetedLine(lines, `Some warning memories were omitted due to maxCharacters. (${omitted} omitted)`, maxCharacters);
    }
  }

  lines.push("## Long-Term Memory");
  if (regularMemories.length === 0) {
    lines.push("No matching long-term memory.");
  } else {
    const omitted = pushBudgetedEntries(
      lines,
      regularMemories.map((memory) => memoryEntry(memory, { includeCreatedAt: !maxCharacters })),
      maxCharacters
    );
    if (omitted > 0) {
      pushBudgetedLine(
        lines,
        `Some long-term memories were omitted due to maxCharacters. (${omitted} omitted)`,
        maxCharacters
      );
    }
  }

  if (briefingOmitted) {
    pushBudgetedLine(lines, "Project Briefing omitted due to maxCharacters.", maxCharacters);
  }

  const markdown = lines.join("\n").trimEnd() + "\n";
  if (maxCharacters !== undefined && markdown.length > maxCharacters) {
    return markdown.slice(0, maxCharacters);
  }
  return markdown;
}
