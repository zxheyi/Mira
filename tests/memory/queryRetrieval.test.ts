import {afterEach, beforeEach, expect, test} from "vitest";
import type Database from "better-sqlite3";
import {openDatabase} from "../../src/db/client.js";
import {migrate} from "../../src/db/schema.js";
import {createProject} from "../../src/projects/projectStore.js";
import {addMemory, searchMemories, type MemoryKind} from "../../src/memory/memoryStore.js";

let db: Database.Database;
let projectId: string;
let contributionId: string;

function remember(title: string, content: string, options: {projectId?: string; kind?: MemoryKind; importance?: number} = {}) {
  return addMemory(db, {projectId: options.projectId ?? projectId, title, content,
    kind: options.kind ?? "fact", importance: options.importance ?? 5, confidence: 1, source: "manual"});
}

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
  projectId = createProject(db, {name: "Mira", rootPath: "/lexical-query"}).id;
  contributionId = remember("Mira contribution flow",
    "Work on a topic branch for every repository change. Open a reviewed pull request to merge changes into main. Never commit or push directly to main.",
    {kind: "constraint", importance: 10}).id;
});
afterEach(() => db.close());

test.each([
  "修完缺陷后，可以直接把改动放到主干吗？",
  "开发新功能时，应该在哪条分支上工作？",
  "Can I bypass peer approval when integrating a fix?"
])("retrieves the contribution rule for a grounded paraphrase: %s", query => {
  remember("A short observation", "A mild afternoon follows a quiet morning.", {importance: 10});
  expect(searchMemories(db, projectId, query).map(item => item.memory.id)).toEqual([contributionId]);
});

test.each([
  ["Mira 默认监听端口是多少？", "Viewer transport", "The viewer listens on TCP port 4317."],
  ["What database engine does this project use?", "Persistence engine", "Project records are stored in a SQLite database."],
  ["Mira 当前版本是多少？", "Release metadata", "The package version is 0.1.0."]
])("requires the queried object rather than a project name or common word: %s", (query, title, content) => {
  expect(searchMemories(db, projectId, query)).toEqual([]);
  const expected = remember(title, content);
  expect(searchMemories(db, projectId, query).map(item => item.memory.id)).toEqual([expected.id]);
});

test.each([
  ["每条 branch 的默认端口是多少？", "Each preview branch listens on TCP port 4510."],
  ["Which database engine serves each branch?", "Each preview branch uses a separate SQLite database."],
  ["每条 branch 的版本是什么？", "Each branch records its package version in the manifest."]
])("does not satisfy a mixed object question through branch alone: %s", (query, content) => {
  expect(searchMemories(db, projectId, query)).toEqual([]);
  const expected = remember("Preview environment", content);
  expect(searchMemories(db, projectId, query).map(item => item.memory.id)).toEqual([expected.id]);
});

test("preserves keyword OR, single project-name lookup, and explicit phrase semantics", () => {
  const mcp = remember("MCP argument validation", "Validate tool arguments.");
  const bundle = remember("Context bundle", "Prepare bounded context.");
  expect(new Set(searchMemories(db, projectId, "MCP bundle").map(item => item.memory.id))).toEqual(new Set([mcp.id, bundle.id]));
  expect(searchMemories(db, projectId, "Mira").map(item => item.memory.id)).toEqual([contributionId]);
  expect(searchMemories(db, projectId, "MCP bundle", {queryMode: "phrase"})).toEqual([]);
  expect(searchMemories(db, projectId, "peer approval", {queryMode: "phrase"})).toEqual([]);
  expect(searchMemories(db, projectId, "topic branch", {queryMode: "phrase"}).map(item => item.memory.id)).toEqual([contributionId]);
});

test("expansion respects word boundaries and does not infer software meanings from unrelated language", () => {
  const preview = remember("Preview", "The preview shows a preview image.");
  const tree = remember("Forest", "树木的主干用于支撑树冠。");
  expect(searchMemories(db, projectId, "preview").map(item => item.memory.id)).toEqual([preview.id]);
  expect(searchMemories(db, projectId, "树木的主干是什么？").map(item => item.memory.id)).toEqual([tree.id]);
  expect(searchMemories(db, projectId, "Does a hummingbird sing?")).toEqual([]);
});

test("expanded matches keep project, kind and active-status boundaries", () => {
  const other = createProject(db, {name: "Other", rootPath: "/other-lexical-query"});
  remember("Other contribution", "Use a topic branch and reviewed pull request.", {projectId: other.id});
  const archived = remember("Old contribution", "A branch needs approval before merge.");
  db.prepare("update memories set status = 'archived' where id = ?").run(archived.id);
  const query = "开发新功能时，应该在哪条分支上工作？";
  expect(searchMemories(db, projectId, query, {kind: "constraint"}).map(item => item.memory.id)).toEqual([contributionId]);
  expect(searchMemories(db, projectId, query, {kind: "fact"})).toEqual([]);
  expect(searchMemories(db, other.id, query).every(item => item.memory.projectId === other.id)).toBe(true);
});

test("CJK compounds do not reintroduce a filtered project name or question filler", () => {
  const chinese = createProject(db, {name: "纳米", rootPath: "/chinese-scope"});
  const scoped = remember("纳米贡献规则", "开发应该通过评审。", {projectId: chinese.id});
  expect(searchMemories(db, chinese.id, "纳米 应该 协议配置")).toEqual([]);
  expect(searchMemories(db, chinese.id, "纳米").map(item => item.memory.id)).toEqual([scoped.id]);
  const actual = remember("协议配置", "通信协议配置保存在工作区。", {projectId: chinese.id});
  expect(searchMemories(db, chinese.id, "纳米 应该 协议配置").map(item => item.memory.id)).toEqual([actual.id]);
});

test("ordinary workflow concepts remain OR alternatives even in a question", () => {
  const branch = remember("Branch labels", "Every branch is named after its task.");
  expect(searchMemories(db, projectId, "Which branch needs approval?").map(item => item.memory.id)).toContain(branch.id);
});

test("explicit Chinese phrase fallback retains recency ordering", () => {
  const older = remember("A older", "项目采用单向数据流架构。");
  const newer = remember("Z newer", "新的模块采用单向数据流架构。");
  db.prepare("update memories set created_at = ? where id = ?").run("2026-01-01T00:00:00.000Z", older.id);
  db.prepare("update memories set created_at = ? where id = ?").run("2026-01-02T00:00:00.000Z", newer.id);
  expect(searchMemories(db, projectId, "单向数据流", {queryMode: "phrase"}).map(item => item.memory.id)).toEqual([newer.id, older.id]);
});

test("single-character Chinese keywords preserve OR matching", () => {
  const width = remember("Minimum width", "窗口宽度不得小于320。");
  const height = remember("Minimum height", "窗口高度不得小于240。");
  expect(searchMemories(db, projectId, "宽").map(item => item.memory.id)).toEqual([width.id]);
  expect(searchMemories(db, projectId, "高").map(item => item.memory.id)).toEqual([height.id]);
  expect(new Set(searchMemories(db, projectId, "宽 高").map(item => item.memory.id))).toEqual(new Set([width.id, height.id]));
});
