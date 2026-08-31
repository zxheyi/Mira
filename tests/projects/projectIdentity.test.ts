import { afterEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { bindProjectRoot, createProject, ensureProjectForRoot, findProjectByRoot, listProjects } from "../../src/projects/projectStore.js";
import { defaultProjectDatabase, repositoryLocation } from "../../src/projects/projectIdentity.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("a renamed local repository keeps its project identity and historical root alias", () => {
  const temp = mkdtempSync(join(tmpdir(), "mira-identity-")); roots.push(temp);
  const oldRoot = join(temp, "before"); const newRoot = join(temp, "after");
  mkdirSync(join(oldRoot, ".git"), { recursive: true });
  const db = openDatabase(":memory:"); migrate(db);
  try {
    const original = ensureProjectForRoot(db, oldRoot);
    renameSync(oldRoot, newRoot);
    const moved = ensureProjectForRoot(db, newRoot);
    expect(moved.id).toBe(original.id);
    expect(moved.rootPath).toBe(newRoot);
    expect(findProjectByRoot(db, oldRoot)?.id).toBe(original.id);
    expect(listProjects(db)).toHaveLength(1);
  } finally { db.close(); }
});

test("linked worktrees share one project database while independent clones stay separate", () => {
  const temp = mkdtempSync(join(tmpdir(), "mira-worktree-")); roots.push(temp);
  const main = join(temp, "main"); const worktree = join(temp, "task"); const other = join(temp, "other");
  execFileSync("git", ["init", main], { stdio: "ignore" });
  execFileSync("git", ["-C", main, "-c", "user.name=Mira Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "fixture"], { stdio: "ignore" });
  execFileSync("git", ["-C", main, "worktree", "add", "--detach", worktree], { stdio: "ignore" });
  execFileSync("git", ["clone", main, other], { stdio: "ignore" });
  const db = openDatabase(defaultProjectDatabase(main)); migrate(db);
  try {
    const original = ensureProjectForRoot(db, main);
    expect(ensureProjectForRoot(db, worktree).id).toBe(original.id);
    expect(repositoryLocation(worktree).workspaceTaskId).toBeTruthy();
    expect(repositoryLocation(main).repositoryKey).toBe(repositoryLocation(worktree).repositoryKey);
    expect(ensureProjectForRoot(db, other).id).not.toBe(original.id);
    const result = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "src/index.ts", "--project-root", worktree, "init"], {encoding: "utf8"}));
    expect(result.project.id).toBe(original.id);
  } finally { db.close(); }
});

test("legacy moved default databases retain identity, shared databases require explicit binding", () => {
  const temp = mkdtempSync(join(tmpdir(), "mira-legacy-move-")); roots.push(temp);
  const before = join(temp, "before"); const after = join(temp, "after");
  let db = openDatabase(join(before, ".mira", "mira.sqlite")); migrate(db);
  const original = createProject(db, {name: "Existing", rootPath: before});
  db.close(); renameSync(before, after);
  db = openDatabase(join(after, ".mira", "mira.sqlite")); migrate(db);
  try {
    expect(ensureProjectForRoot(db, after).id).toBe(original.id);
    const explicit = createProject(db, {name: "Explicit", rootPath: join(temp, "unrelated")});
    expect(bindProjectRoot(db, explicit.id, join(temp, "relocated")).id).toBe(explicit.id);
    expect(findProjectByRoot(db, join(temp, "relocated"))?.id).toBe(explicit.id);
    expect(() => bindProjectRoot(db, explicit.id, after)).toThrow(/already bound/i);
  } finally { db.close(); }
});
