import {afterEach, expect, test} from "vitest";
import type Database from "better-sqlite3";
import {openDatabase} from "../../src/db/client.js";
import {migrate} from "../../src/db/schema.js";
import {createProject} from "../../src/projects/projectStore.js";
import {addMemory} from "../../src/memory/memoryStore.js";
import {setWorkingMemory} from "../../src/workingMemory/workingMemoryStore.js";
import {prepareContext} from "../../src/context/contextPreparation.js";
import {listRecallEvents} from "../../src/context/recallAuditStore.js";
import {authorizeResearch, reviewResearchClaim, submitResearchPacket} from "../../src/research/researchService.js";
import {verifyEvidence} from "../../src/research/evidenceVerification.js";

let database: Database.Database | undefined;
afterEach(() => { database?.close(); database = undefined; });

function fixture(name = "Mira") {
  const db = openDatabase(":memory:"); migrate(db); database = db;
  const project = createProject(db, {name, rootPath: "/query-budget"});
  const memoryInput = {projectId: project.id, kind: "convention" as const, source: "manual", confidence: 1, importance: 8};
  return {db, project, memoryInput};
}

function adoptionFixture() {
  const state = fixture();
  const {db, project, memoryInput} = state;
  // Frozen from the September 14 adoption evaluation, without touching the live database.
  const current = setWorkingMemory(db, {projectId: project.id, kind: "current_task", content: "PR #20 已合并且 CI 通过。Codex→Claude Code 原生接续已验证，记录见 PR #21。当前收集长期记忆召回反馈。"});
  const decision = setWorkingMemory(db, {projectId: project.id, kind: "recent_decision", content: "仓库改动走主题分支和审核 PR。只记录用户明确的召回评价；工作状态接续不计入检索质量样本。"});
  const next = setWorkingMemory(db, {projectId: project.id, kind: "next_step", content: "等待用户评价 1000/2000 Token 两次贡献规则召回，再按对应回执记录；映射保存在 artifacts/trust-validation/adoption-20260914/pending-feedback.json。当前 0/20，暂不升级检索。"});
  const memory = addMemory(db, {...memoryInput, title: "Mira 仓库贡献流程", source: "candidate:candidate_a800a00f-a4a3-4459-b7d2-11d7733094a4", content: [
    "- Work on a topic branch for every repository change.",
    "- Open a pull request to merge changes into `main`.",
    "- Keep `main` as the protected integration branch: changes reach `main` only through a reviewed PR merge.",
    "- Do not commit directly on `main` or push directly to `main`."
  ].join("\n")});
  return {...state, current, decision, next, memory};
}

test("1k adoption recall retains the complete matching memory alongside the current task", () => {
  const {db, project, memory, current, next, decision} = adoptionFixture();
  const packet = prepareContext(db, project.id, {query: "Mira 仓库贡献流程", maxTokens: 1000});
  expect(packet.receipt.candidateMemoryIds).toContain(memory.id);
  expect(packet.receipt.injectedMemoryIds).toEqual([memory.id]);
  expect(packet.markdown).toContain(memory.content);
  expect(packet.markdown).toContain(current.content);
  expect(packet.receipt.tokenUpperBound).toBeLessThanOrEqual(1000);
  expect(packet.receipt.selectionManifest?.inputs).toMatchObject({budgetAllocation: "query-memory-reservation-v1", reservedMemoryId: memory.id});
  expect(packet.receipt.selections).toContainEqual(expect.objectContaining({id: decision.id, selected: false, reasons: ["budget", "query_memory_reservation"]}));
  expect(packet.receipt.selections).toContainEqual(expect.objectContaining({id: next.id, selected: true}));
  expect(listRecallEvents(db, project.id)[0]).toEqual(packet.receipt);
});

test("blockers and the current task win when their remaining budget cannot fit a memory", () => {
  const {db, project, memoryInput} = fixture();
  const blocker = setWorkingMemory(db, {projectId: project.id, kind: "blocker", content: "Do not bypass the review gate."});
  const current = setWorkingMemory(db, {projectId: project.id, kind: "current_task", content: "Investigate the deployment failure."});
  const memory = addMemory(db, {...memoryInput, title: "deploy", content: "Deployment policy ".repeat(10)});
  const packet = prepareContext(db, project.id, {query: "deploy", maxTokens: 400, recordAudit: false});
  expect(packet.markdown).toContain(blocker.content);
  expect(packet.markdown).toContain(current.content);
  expect(packet.receipt.injectedMemoryIds).toEqual([]);
  expect(packet.receipt.dropped).toContainEqual({memoryId: memory.id, reason: "budget"});
  expect(packet.receipt.selectionManifest?.inputs.reservedMemoryId).toBeNull();
  expect(packet.receipt.tokenUpperBound).toBeLessThanOrEqual(400);
});

test("reservation skips an oversized top warning and preserves the next warning before regular memory", () => {
  const {db, project, memoryInput} = fixture();
  setWorkingMemory(db, {projectId: project.id, kind: "current_task", content: "Review deployment."});
  const background = setWorkingMemory(db, {projectId: project.id, kind: "note", content: "Background ".repeat(70)});
  const large = addMemory(db, {...memoryInput, title: "deploy oversized", kind: "failed_attempt", content: "Oversized ".repeat(150), importance: 10});
  const small = addMemory(db, {...memoryInput, title: "deploy warning", kind: "lesson", content: "Validate the rollback before deployment.", importance: 5});
  const regular = addMemory(db, {...memoryInput, title: "deploy note", content: "A regular deployment fact.", importance: 9});
  const packet = prepareContext(db, project.id, {query: "deploy", maxTokens: 1000, memoryLimit: 1, recordAudit: false});
  expect(packet.receipt.injectedMemoryIds).toEqual([small.id]);
  expect(packet.receipt.dropped).toContainEqual({memoryId: large.id, reason: "budget"});
  expect(packet.receipt.dropped).toContainEqual({memoryId: regular.id, reason: "memory_limit"});
  expect(packet.receipt.selectionManifest?.inputs.reservedMemoryId).toBe(small.id);
  expect(packet.receipt.selections).toContainEqual(expect.objectContaining({id: background.id, selected: false, reasons: ["budget", "query_memory_reservation"]}));
  expect(packet.markdown).toContain("## Warnings");
  expect(packet.markdown).toContain(small.content);
  expect(packet.markdown).not.toContain(large.content);
});

test("oversized warnings cannot consume a reservation made for a later regular memory", () => {
  const {db, project, memoryInput} = fixture();
  setWorkingMemory(db, {projectId: project.id, kind: "current_task", content: "Check deployment policy."});
  setWorkingMemory(db, {projectId: project.id, kind: "next_step", content: "Background ".repeat(55)});
  const warnings = ["failed_attempt", "lesson"].map(kind => addMemory(db, {...memoryInput,
    title: `deploy ${kind}`, kind: kind as "failed_attempt" | "lesson", content: "Large warning ".repeat(90)
  }));
  const memory = addMemory(db, {...memoryInput, title: "deploy policy", content: "Require a reviewed pull request."});
  const packet = prepareContext(db, project.id, {query: "deploy", maxTokens: 1000, recordAudit: false});
  expect(packet.receipt.selectionManifest?.inputs.reservedMemoryId).toBe(memory.id);
  expect(packet.receipt.injectedMemoryIds).toEqual([memory.id]);
  for (const warning of warnings) expect(packet.receipt.dropped).toContainEqual({memoryId: warning.id, reason: "budget"});
  expect(packet.markdown).not.toContain("## Warnings");
  expect(packet.markdown).toContain(memory.content);
  expect(packet.receipt.tokenUpperBound).toBeLessThanOrEqual(1000);
});

test("critical-only state and a reserved memory account for exact character and UTF-8 overhead", () => {
  const {db, project, memoryInput} = fixture();
  const blocker = setWorkingMemory(db, {projectId: project.id, kind: "blocker", content: "等待审核。"});
  const current = setWorkingMemory(db, {projectId: project.id, kind: "current_task", content: "检查贡献约定。"});
  const memory = addMemory(db, {...memoryInput, title: "贡献", content: "代码改动必须经过审核。"});
  const full = prepareContext(db, project.id, {query: "贡献", recordAudit: false});
  const withoutBriefing = full.markdown.replace(/## Project Briefing\n[^\n]*\n\n/, "");
  const packet = prepareContext(db, project.id, {query: "贡献", recordAudit: false,
    maxCharacters: withoutBriefing.length, maxTokens: Buffer.byteLength(withoutBriefing, "utf8")});
  expect(packet.markdown).toBe(withoutBriefing);
  expect(packet.markdown).toContain(blocker.content);
  expect(packet.markdown).toContain(current.content);
  expect(packet.receipt.injectedMemoryIds).toEqual([memory.id]);
  const manifest = packet.receipt.selectionManifest!;
  for (const metric of ["characters", "tokenUpperBound"] as const) {
    const entries = manifest.selections.filter(item => item.selected).reduce((sum, item) => sum + (item.cost?.[metric] ?? 0), 0);
    expect(manifest.cost[metric]).toBe(entries + manifest.overheadCost[metric]);
    expect(manifest.overheadCost[metric]).toBeGreaterThanOrEqual(0);
  }
});

test.each([
  {maxCharacters: 300, maxTokens: 1000},
  {maxCharacters: 1000, maxTokens: 380}
])("reservation obeys both complete-entry budgets: %j", budget => {
  const {db, project, memoryInput} = fixture();
  setWorkingMemory(db, {projectId: project.id, kind: "current_task", content: "核对预算。"});
  setWorkingMemory(db, {projectId: project.id, kind: "next_step", content: "下一步继续核对完整性。".repeat(10)});
  const memory = addMemory(db, {...memoryInput, title: "预算", content: "预算不能截断任何记忆条目。"});
  const packet = prepareContext(db, project.id, {query: "预算", recordAudit: false, ...budget});
  expect(packet.receipt.injectedMemoryIds).toEqual([memory.id]);
  expect(packet.markdown).toContain(memory.content);
  expect(packet.markdown.length).toBeLessThanOrEqual(budget.maxCharacters);
  expect(Buffer.byteLength(packet.markdown, "utf8")).toBeLessThanOrEqual(budget.maxTokens);
  expect(packet.receipt.selectionManifest?.entryTruncation).toBe("none");
  expect(packet.receipt.selectionManifest?.overheadCost.characters).toBeGreaterThanOrEqual(0);
});

test("briefing metadata cannot consume the budget reserved for a queried memory", () => {
  const {db, project, memoryInput} = fixture("Long project name ".repeat(20));
  const memory = addMemory(db, {...memoryInput, title: "reserve", content: "Reserve relevant memory."});
  const packet = prepareContext(db, project.id, {query: "reserve", maxCharacters: 500, maxTokens: 500});
  expect(packet.receipt.injectedMemoryIds).toEqual([memory.id]);
  expect(packet.receipt.selections).toContainEqual(expect.objectContaining({type: "briefing", selected: false, reasons: ["budget", "query_memory_reservation"]}));
  expect(packet.markdown).not.toContain("## Project Briefing");
  expect(packet.markdown).toContain(memory.content);
});

test("no-query and empty-candidate requests retain working-first selection", () => {
  const {db, project, current, next, decision} = adoptionFixture();
  for (const query of [undefined, "unmatchedxyzw"]) {
    const packet = prepareContext(db, project.id, {query, maxTokens: 1000, recordAudit: false});
    expect(packet.receipt.injectedMemoryIds).toEqual([]);
    for (const item of [current, next, decision]) expect(packet.markdown).toContain(item.content);
    expect(packet.receipt.selectionManifest?.inputs).toMatchObject({budgetAllocation: "working-first-v1", reservedMemoryId: null});
  }
});

test("reservation keeps task overrides and excludes another task's state", () => {
  const {db, project, memoryInput} = fixture();
  const shared = setWorkingMemory(db, {projectId: project.id, kind: "current_task", content: "Shared task."});
  const selected = setWorkingMemory(db, {projectId: project.id, taskId: "selected", kind: "current_task", content: "Selected task."});
  const other = setWorkingMemory(db, {projectId: project.id, taskId: "other", kind: "blocker", content: "Other task blocker."});
  setWorkingMemory(db, {projectId: project.id, kind: "note", content: "Background ".repeat(50)});
  const memory = addMemory(db, {...memoryInput, title: "deploy", content: "Review deployment changes."});
  const packet = prepareContext(db, project.id, {taskId: "selected", query: "deploy", maxTokens: 800, recordAudit: false});
  expect(packet.receipt.injectedMemoryIds).toEqual([memory.id]);
  expect(packet.markdown).toContain(selected.content);
  expect(packet.markdown).not.toContain(shared.content);
  expect(packet.markdown).not.toContain(other.content);
  expect(packet.receipt.selections).toContainEqual(expect.objectContaining({id: shared.id, selected: false, reasons: ["task_override"]}));
  expect(packet.receipt.selections?.some(item => item.id === other.id)).toBe(false);
});

test("explicit research keeps its existing priority ahead of ordinary memory", () => {
  const {db, project, memoryInput} = fixture();
  const memory = addMemory(db, {...memoryInput, title: "report", content: "Report background ".repeat(80)});
  const snapshot = submitResearchPacket(db, project.id, {
    case: {title: "Report", question: "What changed?", asOfDate: "2026-09-01"},
    snapshots: [{key: "S", canonicalUri: "https://example.test/report", sourceTitle: "Report", accessedAt: "2026-09-01", mediaType: "text/plain", content: "Page 1: Revenue grew 10%."}],
    evidence: [{key: "E", snapshotKey: "S", sourceType: "other", sourceUri: "https://example.test/report", sourceTitle: "Report", locator: "Page 1", excerpt: "Revenue grew 10%.", accessedAt: "2026-09-01"}],
    claims: [{key: "C", statement: "Revenue grew 10%.", evidenceStatus: "supported", confidence: 0.9, thesisImpact: "none", invalidationConditions: "Restatement.", links: [{evidenceKey: "E", relation: "supports", rationale: "Direct measurement."}]}]
  });
  verifyEvidence(db, project.id, snapshot.researchCase.id, snapshot.evidence[0].id);
  const authority = authorizeResearch(db, project.id, {scopes: ["research.review"], actor: "reviewer", reason: "Verified the report."});
  reviewResearchClaim(db, project.id, snapshot.claims[0].id, "approve", "Reviewed the evidence.", authority);
  const options = {researchCaseIds: [snapshot.researchCase.id], maxTokens: 1800, recordAudit: false};
  const existing = prepareContext(db, project.id, options);
  const queried = prepareContext(db, project.id, {...options, query: "report"});
  expect(queried.markdown).toEqual(existing.markdown);
  expect(queried.markdown).toContain(snapshot.claims[0].statement);
  expect(queried.receipt.injectedMemoryIds).not.toContain(memory.id);
  expect(queried.receipt.selectionManifest?.inputs).toMatchObject({budgetAllocation: "working-first-v1", reservedMemoryId: null});
});
