import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { getIntegrationStatus } from "../integrations/configInstaller.js";
import { findProjectByRoot, type Project } from "../projects/projectStore.js";

export type DoctorTableCounts = {
  projects: number;
  threads: number;
  memories: number;
  memoryCandidates: number;
  historyImportRuns: number;
};

export type DoctorDatabaseReport = {
  exists: boolean;
  schemaVersion?: number;
  project?: Project;
  counts: DoctorTableCounts;
  error?: string;
};

export type DoctorIntegrationLogReport = {
  path: string;
  exists: boolean;
  latestTimestamp?: string;
  latestEntry?: Record<string, unknown>;
};

export type DoctorReport = {
  projectRoot: string;
  dbPath: string;
  database: DoctorDatabaseReport;
  integrations: Awaited<ReturnType<typeof getIntegrationStatus>>;
  integrationLog: DoctorIntegrationLogReport;
  warnings: string[];
};

type SqliteScalar = string | number | bigint | Buffer | null;

function emptyCounts(): DoctorTableCounts {
  return { projects: 0, threads: 0, memories: 0, memoryCandidates: 0, historyImportRuns: 0 };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(table)
  );
}

function scalarNumber(db: Database.Database, sql: string, ...params: SqliteScalar[]): number {
  const value = db.prepare(sql).pluck().get(...params);
  return typeof value === "number" ? value : Number(value ?? 0);
}

function schemaVersion(db: Database.Database): number | undefined {
  if (!tableExists(db, "schema_version")) return undefined;
  const value = db.prepare("select max(version) from schema_version").pluck().get();
  return typeof value === "number" ? value : undefined;
}

function countTable(db: Database.Database, table: string): number {
  return tableExists(db, table) ? scalarNumber(db, `select count(*) from ${table}`) : 0;
}

function countProjectTable(db: Database.Database, table: string, projectId: string | undefined): number {
  if (!projectId || !tableExists(db, table)) return 0;
  return scalarNumber(db, `select count(*) from ${table} where project_id = ?`, projectId);
}

function databaseReport(dbPath: string, projectRoot: string): DoctorDatabaseReport {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const hasProjects = tableExists(db, "projects");
    const project = hasProjects ? findProjectByRoot(db, projectRoot) : undefined;
    return {
      exists: true,
      schemaVersion: schemaVersion(db),
      project,
      counts: {
        projects: countTable(db, "projects"),
        threads: countProjectTable(db, "threads", project?.id),
        memories: countProjectTable(db, "memories", project?.id),
        memoryCandidates: countProjectTable(db, "memory_candidates", project?.id),
        historyImportRuns: countProjectTable(db, "history_import_runs", project?.id)
      }
    };
  } finally {
    db.close();
  }
}

async function integrationLogReport(projectRoot: string): Promise<DoctorIntegrationLogReport> {
  const path = join(projectRoot, ".mira", "integrations.log");
  if (!await pathExists(path)) return { path, exists: false };

  const lines = (await readFile(path, "utf8")).trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]) as Record<string, unknown>;
      return {
        path,
        exists: true,
        latestTimestamp: typeof entry.timestamp === "string" ? entry.timestamp : undefined,
        latestEntry: entry
      };
    } catch {
      // Ignore malformed diagnostic lines; older tools may have written plain text.
    }
  }
  return { path, exists: true };
}

function warningsFor(report: Omit<DoctorReport, "warnings">): string[] {
  const warnings: string[] = [];
  if (!report.database.exists) warnings.push("Mira database does not exist yet");
  if (report.database.exists && !report.database.project) warnings.push("Current project is not registered in Mira database");
  if (!report.integrations.codex.installed) warnings.push("Codex integration is not installed");
  if (!report.integrations.claudeCode.installed) warnings.push("Claude Code integration is not installed");
  return warnings;
}

export async function runDoctor(options: { projectRoot: string; dbPath: string }): Promise<DoctorReport> {
  const projectRoot = resolve(options.projectRoot);
  const dbPath = resolve(options.dbPath);
  const exists = await pathExists(dbPath);
  const database = exists
    ? databaseReport(dbPath, projectRoot)
    : { exists: false, counts: emptyCounts() };
  const report = {
    projectRoot,
    dbPath,
    database,
    integrations: await getIntegrationStatus(projectRoot),
    integrationLog: await integrationLogReport(projectRoot)
  };
  return { ...report, warnings: warningsFor(report) };
}
