import { stat } from "node:fs/promises";
import type Database from "better-sqlite3";
import { getLatestCompleteProjectBriefing, type ProjectBriefing } from "../briefing/projectBriefingStore.js";
import { buildContextBundle } from "../context/contextBundle.js";
import { listHistoryImportRuns } from "../history/historyImportStore.js";
import type { HistoryImportRun } from "../history/historyTypes.js";
import { getIntegrationStatus } from "../integrations/configInstaller.js";
import { listAllMemoriesForProject, type Memory } from "../memory/memoryStore.js";
import type { Project } from "../projects/projectStore.js";
import { getThread, listThreadsForProject, type Thread } from "../threads/threadStore.js";
import { listWorkingMemory, type WorkingMemory } from "../workingMemory/workingMemoryStore.js";
import { getResearchCaseSnapshot, listResearchCases } from "../research/researchStore.js";

export type ViewerCounts = {
  threads: number;
  memories: number;
  memoryCandidates: number;
  historyImportRuns: number;
  workingMemory: number;
  researchCases: number;
};

export type ViewerOverview = {
  project: Project;
  database: { path: string; exists: boolean; sizeBytes: number };
  counts: ViewerCounts;
  integrations: Awaited<ReturnType<typeof getIntegrationStatus>>;
  latestImportRun?: HistoryImportRun;
  latestBriefing?: Pick<ProjectBriefing, "id" | "version" | "status" | "createdAt" | "staleAt" | "characterCount" | "estimatedTokens">;
};

export type ViewerThreadListItem = Omit<Thread, "rawText"> & {
  preview: string;
  rawCharacters: number;
};

export type ViewerBriefing = ProjectBriefing | undefined;

export type ViewerMemorySnapshot = {
  memories: Memory[];
  workingMemory: WorkingMemory[];
};

function countProjectRows(db: Database.Database, table: string, projectId: string): number {
  return Number(db.prepare(`select count(*) from ${table} where project_id = ?`).pluck().get(projectId) ?? 0);
}

async function databaseSize(dbPath: string): Promise<{ exists: boolean; sizeBytes: number }> {
  try {
    const info = await stat(dbPath);
    return { exists: true, sizeBytes: info.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, sizeBytes: 0 };
    throw error;
  }
}

function previewText(rawText: string, maxLength = 220): string {
  const compact = rawText.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function toThreadListItem(thread: Thread): ViewerThreadListItem {
  const { rawText, ...rest } = thread;
  return { ...rest, preview: previewText(rawText), rawCharacters: rawText.length };
}

export async function getViewerOverview(options: {
  db: Database.Database;
  project: Project;
  projectRoot: string;
  dbPath: string;
}): Promise<ViewerOverview> {
  const [database, integrations] = await Promise.all([
    databaseSize(options.dbPath),
    getIntegrationStatus(options.projectRoot)
  ]);
  const importRuns = listHistoryImportRuns(options.db, options.project.id, 1);
  const briefing = getLatestCompleteProjectBriefing(options.db, options.project.id);
  return {
    project: options.project,
    database: { path: options.dbPath, ...database },
    counts: {
      threads: countProjectRows(options.db, "threads", options.project.id),
      memories: countProjectRows(options.db, "memories", options.project.id),
      memoryCandidates: countProjectRows(options.db, "memory_candidates", options.project.id),
      historyImportRuns: countProjectRows(options.db, "history_import_runs", options.project.id),
      workingMemory: countProjectRows(options.db, "working_memory", options.project.id),
      researchCases: countProjectRows(options.db, "research_cases", options.project.id)
    },
    integrations,
    latestImportRun: importRuns[0],
    latestBriefing: briefing ? {
      id: briefing.id,
      version: briefing.version,
      status: briefing.status,
      createdAt: briefing.createdAt,
      staleAt: briefing.staleAt,
      characterCount: briefing.characterCount,
      estimatedTokens: briefing.estimatedTokens
    } : undefined
  };
}

export function listViewerThreads(db: Database.Database, projectId: string): ViewerThreadListItem[] {
  return listThreadsForProject(db, projectId).map(toThreadListItem).reverse();
}

export function getViewerThread(
  db: Database.Database,
  projectId: string,
  threadId: string
): Thread | undefined {
  return getThread(db, projectId, threadId);
}

export function listViewerImportRuns(
  db: Database.Database,
  projectId: string,
  limit = 20
): HistoryImportRun[] {
  return listHistoryImportRuns(db, projectId, limit);
}

export function getViewerBriefing(db: Database.Database, projectId: string): ViewerBriefing {
  return getLatestCompleteProjectBriefing(db, projectId);
}

export function getViewerContextBundle(
  db: Database.Database,
  projectId: string,
  options: { maxCharacters?: number } = {}
): string {
  return buildContextBundle(db, projectId, { maxCharacters: options.maxCharacters ?? 4_000, recordAudit: false });
}

export function getViewerMemorySnapshot(db: Database.Database, projectId: string): ViewerMemorySnapshot {
  return {
    memories: listAllMemoriesForProject(db, projectId),
    workingMemory: listWorkingMemory(db, projectId)
  };
}

export function listViewerResearchCases(db: Database.Database, projectId: string) {
  return listResearchCases(db, projectId);
}

export function getViewerResearchCase(db: Database.Database, projectId: string, caseId: string) {
  return getResearchCaseSnapshot(db, projectId, caseId);
}
