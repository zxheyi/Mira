import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { defaultProjectDatabase, repositoryLocation } from "./projectIdentity.js";
import { existsSync, realpathSync } from "node:fs";

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
  const resolved = resolve(rootPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
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

  db.transaction(() => {
    db.prepare(
      `insert into projects (id, name, root_path, created_at, repository_key)
       values (@id, @name, @rootPath, @createdAt, @repositoryKey)`
    ).run({ ...project, repositoryKey: repositoryLocation(input.rootPath).repositoryKey ?? null });
    db.prepare("insert into project_roots (root_path, project_id) values (?, ?)").run(project.rootPath, project.id);
  })();

  return project;
}

export function findProjectByRoot(db: Database.Database, rootPath: string): Project | undefined {
  const hasAliases = Boolean(db.prepare("select 1 from sqlite_master where type = 'table' and name = 'project_roots'").get());
  if (!hasAliases) {
    const legacy = db.prepare("select id, name, root_path, created_at from projects where root_path = ?")
      .get(normalizeRootPath(rootPath)) as ProjectRow | undefined;
    return legacy ? toProject(legacy) : undefined;
  }
  const row = db
    .prepare(`select p.id, p.name, p.root_path, p.created_at from projects p
      where p.root_path = ? or p.id = (select project_id from project_roots where root_path = ?)`)
    .get(normalizeRootPath(rootPath), normalizeRootPath(rootPath)) as ProjectRow | undefined;

  return row ? toProject(row) : undefined;
}

export function ensureProjectForRoot(db: Database.Database, rootPath: string): Project {
  const location = repositoryLocation(rootPath);
  const normalizedRootPath = normalizeRootPath(location.rootPath);
  return db.transaction(() => {
    const byRoot = findProjectByRoot(db, normalizedRootPath);
    const byRepository = location.repositoryKey
      ? db.prepare("select * from projects where repository_key = ?").get(location.repositoryKey) as ProjectRow | undefined
      : undefined;
    if (byRoot && byRepository && byRoot.id !== byRepository.id) {
      throw new Error("Project identity conflict; explicitly bind the root to the intended project");
    }
    let existing = byRoot ?? (byRepository ? toProject(byRepository) : undefined);
    const defaultDb = defaultProjectDatabase(rootPath);
    if (!existing && db.name !== ":memory:" && existsSync(defaultDb) && existsSync(db.name)
      && realpathSync(defaultDb) === realpathSync(db.name)) {
      const projects = listProjects(db);
      if (projects.length === 1 && !existsSync(projects[0].rootPath)) existing = projects[0];
    }
    if (!existing) {
      const created = createProject(db, { name: defaultProjectName(location.primaryRoot), rootPath: location.primaryRoot });
      db.prepare("insert or ignore into project_roots (root_path, project_id) values (?, ?)").run(normalizedRootPath, created.id);
      return created;
    }
    const storedKey = db.prepare("select repository_key from projects where id = ?").pluck().get(existing.id);
    if (storedKey && location.repositoryKey && storedKey !== location.repositoryKey) {
      throw new Error("Project root now belongs to a different repository; explicitly bind the project");
    }
    db.prepare("update projects set repository_key = coalesce(repository_key, ?) where id = ?")
      .run(location.repositoryKey ?? null, existing.id);
    db.prepare("insert or ignore into project_roots (root_path, project_id) values (?, ?)")
      .run(normalizedRootPath, existing.id);
    if (!location.workspaceTaskId) {
      db.prepare("update projects set root_path = ? where id = ?").run(normalizedRootPath, existing.id);
    }
    return findProjectByRoot(db, normalizedRootPath)!;
  }).immediate();
}

export function bindProjectRoot(db: Database.Database, projectId: string, rootPath: string): Project {
  const location = repositoryLocation(rootPath);
  const normalizedRootPath = normalizeRootPath(location.rootPath);
  return db.transaction(() => {
    const existing = db.prepare("select * from projects where id = ?").get(projectId) as ProjectRow | undefined;
    if (!existing) throw new Error(`Project not found: ${projectId}`);
    const owner = findProjectByRoot(db, normalizedRootPath);
    if (owner && owner.id !== projectId) throw new Error("Root is already bound to a different project");
    const repositoryOwner = location.repositoryKey
      ? db.prepare("select id from projects where repository_key = ?").get(location.repositoryKey) as { id: string } | undefined
      : undefined;
    if (repositoryOwner && repositoryOwner.id !== projectId) throw new Error("Repository is already bound to a different project");
    db.prepare("insert or ignore into project_roots (root_path, project_id) values (?, ?)").run(existing.root_path, projectId);
    db.prepare("insert or ignore into project_roots (root_path, project_id) values (?, ?)").run(normalizedRootPath, projectId);
    db.prepare("update projects set root_path = ?, repository_key = ? where id = ?")
      .run(normalizedRootPath, location.repositoryKey ?? null, projectId);
    return findProjectByRoot(db, normalizedRootPath)!;
  }).immediate();
}

export function listProjects(db: Database.Database): Project[] {
  return db
    .prepare("select id, name, root_path, created_at from projects order by created_at asc, rowid asc")
    .all()
    .map((row) => toProject(row as ProjectRow));
}

export function deleteProject(db: Database.Database, projectId: string): void {
  db.prepare("delete from projects where id = ?").run(projectId);
}
