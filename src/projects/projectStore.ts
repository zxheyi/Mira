import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";

export type Project = {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
};

export type CreateProjectInput = {
  name: string;
  rootPath: string;
};

type ProjectRow = {
  id: string;
  name: string;
  root_path: string;
  created_at: string;
};

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    createdAt: row.created_at
  };
}

function normalizeRootPath(rootPath: string): string {
  return resolve(rootPath);
}

function defaultProjectName(rootPath: string): string {
  return basename(rootPath) || "project";
}

export function createProject(db: Database.Database, input: CreateProjectInput): Project {
  const project: Project = {
    id: `project_${randomUUID()}`,
    name: input.name,
    rootPath: normalizeRootPath(input.rootPath),
    createdAt: new Date().toISOString()
  };

  db.prepare(
    `insert into projects (id, name, root_path, created_at)
     values (@id, @name, @rootPath, @createdAt)`
  ).run(project);

  return project;
}

export function findProjectByRoot(db: Database.Database, rootPath: string): Project | undefined {
  const row = db
    .prepare("select id, name, root_path, created_at from projects where root_path = ?")
    .get(normalizeRootPath(rootPath)) as ProjectRow | undefined;

  return row ? toProject(row) : undefined;
}

export function ensureProjectForRoot(db: Database.Database, rootPath: string): Project {
  const normalizedRootPath = normalizeRootPath(rootPath);
  const existing = findProjectByRoot(db, normalizedRootPath);

  if (existing) {
    return existing;
  }

  return createProject(db, {
    name: defaultProjectName(normalizedRootPath),
    rootPath: normalizedRootPath
  });
}

export function listProjects(db: Database.Database): Project[] {
  return db
    .prepare("select id, name, root_path, created_at from projects order by created_at asc, rowid asc")
    .all()
    .map((row) => toProject(row as ProjectRow));
}
