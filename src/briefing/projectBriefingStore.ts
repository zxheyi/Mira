import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { listMemoriesForProject } from "../memory/memoryStore.js";
import { listWorkingMemory } from "../workingMemory/workingMemoryStore.js";
import { listResearchBriefingSummaries } from "../research/researchContext.js";
import {
  renderProjectBriefing,
  type ProjectBriefingRenderInput,
  type RenderedProjectBriefing
} from "./projectBriefingRenderer.js";

export type ProjectBriefingStatus = "complete" | "failed";

export type ProjectBriefing = {
  id: string;
  projectId: string;
  version: number;
  markdown: string;
  sourceMemoryIds: string[];
  sourceThreadIds: string[];
  sourceWorkingMemoryIds: string[];
  generationMethod: "deterministic";
  characterCount: number;
  estimatedTokens: number;
  status: ProjectBriefingStatus;
  staleAt?: string;
  error?: string;
  createdAt: string;
};

type ProjectBriefingRow = {
  id: string; project_id: string; version: number; markdown: string; source_memory_ids: string;
  source_thread_ids: string; source_working_memory_ids: string; generation_method: "deterministic";
  character_count: number; estimated_tokens: number; status: ProjectBriefingStatus;
  stale_at: string | null; error: string | null; created_at: string;
};

export type RebuildProjectBriefingOptions = {
  renderer?: (input: ProjectBriefingRenderInput) => RenderedProjectBriefing;
};

function parseIds(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("Project Briefing source ids must be a JSON string array");
  }
  return parsed;
}

function toProjectBriefing(row: ProjectBriefingRow): ProjectBriefing {
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    markdown: row.markdown,
    sourceMemoryIds: parseIds(row.source_memory_ids),
    sourceThreadIds: parseIds(row.source_thread_ids),
    sourceWorkingMemoryIds: parseIds(row.source_working_memory_ids),
    generationMethod: row.generation_method,
    characterCount: row.character_count,
    estimatedTokens: row.estimated_tokens,
    status: row.status,
    staleAt: row.stale_at ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at
  };
}

function nextVersion(db: Database.Database, projectId: string): number {
  const version = db.prepare(
    "select coalesce(max(version), 0) + 1 from project_briefings where project_id = ?"
  ).pluck().get(projectId) as number;
  return version;
}

function projectName(db: Database.Database, projectId: string): string {
  const name = db.prepare("select name from projects where id = ?").pluck().get(projectId) as string | undefined;
  if (!name) throw new Error(`Project not found: ${projectId}`);
  return name;
}

function insertBriefing(
  db: Database.Database,
  input: Omit<ProjectBriefing, "id" | "version" | "createdAt">
): ProjectBriefing {
  return db.transaction(() => {
    const briefing: ProjectBriefing = {
      id: `briefing_${randomUUID()}`,
      version: nextVersion(db, input.projectId),
      createdAt: new Date().toISOString(),
      ...input
    };
    db.prepare(
      `insert into project_briefings (
        id, project_id, version, markdown, source_memory_ids, source_thread_ids,
        source_working_memory_ids, generation_method, character_count, estimated_tokens,
        status, stale_at, error, created_at
      ) values (
        @id, @projectId, @version, @markdown, @sourceMemoryIds, @sourceThreadIds,
        @sourceWorkingMemoryIds, @generationMethod, @characterCount, @estimatedTokens,
        @status, @staleAt, @error, @createdAt
      )`
    ).run({
      ...briefing,
      sourceMemoryIds: JSON.stringify(briefing.sourceMemoryIds),
      sourceThreadIds: JSON.stringify(briefing.sourceThreadIds),
      sourceWorkingMemoryIds: JSON.stringify(briefing.sourceWorkingMemoryIds),
      staleAt: briefing.staleAt ?? null,
      error: briefing.error ?? null
    });
    return briefing;
  })();
}

export function getLatestCompleteProjectBriefing(
  db: Database.Database,
  projectId: string
): ProjectBriefing | undefined {
  const row = db.prepare(
    `select * from project_briefings
     where project_id = ? and status = 'complete'
     order by version desc limit 1`
  ).get(projectId) as ProjectBriefingRow | undefined;
  return row ? toProjectBriefing(row) : undefined;
}

export function listProjectBriefings(
  db: Database.Database,
  projectId: string,
  limit = 20
): ProjectBriefing[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Project Briefing limit must be between 1 and 100");
  }
  return db.prepare(
    "select * from project_briefings where project_id = ? order by version desc limit ?"
  ).all(projectId, limit).map((row) => toProjectBriefing(row as ProjectBriefingRow));
}

export function rebuildProjectBriefing(
  db: Database.Database,
  projectId: string,
  options: RebuildProjectBriefingOptions = {}
): ProjectBriefing {
  const name = projectName(db, projectId);
  try {
    const rebuild = db.transaction(() => {
      const renderInput: ProjectBriefingRenderInput = {
        projectName: name,
        workingMemory: listWorkingMemory(db, projectId),
        memories: listMemoriesForProject(db, projectId),
        researchCases: listResearchBriefingSummaries(db, projectId)
      };
      const rendered: RenderedProjectBriefing = (options.renderer ?? renderProjectBriefing)(renderInput);
      return insertBriefing(db, {
        projectId,
        ...rendered,
        generationMethod: "deterministic",
        characterCount: rendered.markdown.length,
        estimatedTokens: Math.ceil(rendered.markdown.length / 4),
        status: "complete"
      });
    });
    return rebuild.immediate();
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
    insertBriefing(db, {
      projectId,
      markdown: "",
      sourceMemoryIds: [],
      sourceThreadIds: [],
      sourceWorkingMemoryIds: [],
      generationMethod: "deterministic",
      characterCount: 0,
      estimatedTokens: 0,
      status: "failed",
      error: message
    });
    throw error;
  }
}

export function ensureFreshProjectBriefing(
  db: Database.Database,
  projectId: string,
  options: RebuildProjectBriefingOptions = {}
): ProjectBriefing | undefined {
  const latest = getLatestCompleteProjectBriefing(db, projectId);
  if (latest && !latest.staleAt) return latest;
  try {
    return rebuildProjectBriefing(db, projectId, options);
  } catch {
    return latest;
  }
}
