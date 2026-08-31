import { test, expect } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { createProject } from "../../src/projects/projectStore.js";
import { saveThread } from "../../src/threads/threadStore.js";
import { authorizeCuration, curateMemory, listCurationEvents } from "../../src/memory/curationService.js";
import { getMemory, getMemoryHistory } from "../../src/memory/memoryLifecycleStore.js";
import { prepareContext } from "../../src/context/contextPreparation.js";

test("automatic callers cannot self-authorize a confirmed write", () => {
  const db = openDatabase(":memory:"); migrate(db);
  const project = createProject(db, {name: "Authority", rootPath: "/authority"});
  try {
    const command = {operation: "add" as const, input: {projectId: project.id, title: "Approved?", content: "Replace the chosen architecture.", kind: "decision" as const, source: "manual", actor: "user", confidence: 1, importance: 10}};
    expect(() => curateMemory(db, command)).toThrow(/authority/i);
    expect(prepareContext(db, project.id).receipt.injectedMemoryIds).toEqual([]);
  } finally { db.close(); }
});

test("confirmed curation audits the host policy and rejects forged or cross-project grants", () => {
  const db = openDatabase(":memory:"); migrate(db);
  const project = createProject(db, {name: "Audit", rootPath: "/audit"});
  const other = createProject(db, {name: "Other", rootPath: "/other"});
  try {
    const authority = authorizeCuration(db, project.id, {actor: "host:reviewer", reason: "Local review approved"});
    const command = {operation: "add" as const, input: {projectId: project.id, title: "Policy", content: "Keep SQLite.", kind: "decision" as const, source: "manual", actor: "forged-user", confidence: 1, importance: 8}};
    expect(() => curateMemory(db, command, {} as never)).toThrow(/authority/i);
    expect(() => curateMemory(db, {...command, input: {...command.input, projectId: other.id}}, authority)).toThrow(/authority/i);
    const memory = curateMemory(db, command, authority);
    expect(listCurationEvents(db, project.id)).toEqual([expect.objectContaining({operation: "add", memoryId: memory.id, actor: "host:reviewer", authorityReason: "Local review approved"})]);
    expect(listCurationEvents(db, other.id)).toEqual([]);
    const thread = saveThread(db, {id: "review-source", projectId: project.id, title: "Source", source: "agent", rawFormat: "markdown", rawText: "Require a review."});
    const [pending] = curateMemory(db, {operation: "propose", input: {projectId: project.id, threadId: thread.id, sourceAgent: "agent", extractionMethod: "agent", candidates: [{title: "Review", kind: "constraint", content: thread.rawText, evidence: thread.rawText, confidence: 1, importance: 1}]}});
    curateMemory(db, {operation: "review", projectId: project.id, candidateId: pending.candidate.id, decision: "reject", actor: "forged-user", reason: "Not agreed"}, authority);
    expect(listCurationEvents(db, project.id)[0]).toMatchObject({operation: "review", candidateId: pending.candidate.id, outcome: "rejected", actor: "host:reviewer", reason: "Not agreed"});
  } finally { db.close(); }
});

test("v9 migration preserves memory and failed audit persistence rolls back a correction", () => {
  const db = openDatabase(":memory:"); migrate(db);
  const project = createProject(db, {name: "Migration", rootPath: "/migration"});
  const authority = authorizeCuration(db, project.id, {actor: "host", reason: "Explicit review"});
  try {
    const first = curateMemory(db, {operation: "add", input: {projectId: project.id, title: "Original", content: "Keep this decision.", kind: "decision", source: "manual", confidence: 1, importance: 8}}, authority);
    db.exec("drop table curation_events; delete from schema_version where version >= 10; insert or ignore into schema_version values (9, '2026-08-01');");
    migrate(db); migrate(db);
    expect(getMemory(db, project.id, first.id)).toMatchObject({status: "active", content: "Keep this decision."});
    expect(listCurationEvents(db, project.id)).toEqual([]);
    db.exec("create trigger fail_audit before insert on curation_events begin select raise(abort, 'audit unavailable'); end;");
    expect(() => curateMemory(db, {operation: "correct", input: {projectId: project.id, memoryId: first.id, content: "Replacement"}}, authority)).toThrow("audit unavailable");
    expect(getMemoryHistory(db, project.id, first.id).memories).toEqual([first]);
    expect(listCurationEvents(db, project.id)).toEqual([]);
  } finally { db.close(); }
});

test.each(["constraint", "architecture", "decision"] as const)("%s candidates require review even with verbatim evidence and confidence 1", (kind) => {
  const db = openDatabase(":memory:"); migrate(db);
  const project = createProject(db, {name: "Review policy", rootPath: "/review-policy"});
  try {
    const content = "All schema changes require a numbered migration.";
    const thread = saveThread(db, {id: "policy-source", projectId: project.id, title: "Policy", source: "codex", rawFormat: "markdown", rawText: content});
    const [result] = curateMemory(db, {operation: "propose", input: {
      projectId: project.id, threadId: thread.id, sourceAgent: "provider", extractionMethod: "provider",
      candidates: [{title: "Migration policy", kind, content, evidence: content, confidence: 1, importance: 0.9}]
    }});
    expect(result).toMatchObject({outcome: "pending_review", reasons: ["high_impact_kind"], candidate: {riskLevel: "high"}});
    expect(prepareContext(db, project.id).receipt.injectedMemoryIds).toEqual([]);
  } finally { db.close(); }
});

test("explicit review approves a paraphrase as a successor with reviewer attribution", () => {
  const db = openDatabase(":memory:"); migrate(db);
  const project = createProject(db, {name: "Curation", rootPath: "/curation"});
  const authority = authorizeCuration(db, project.id, {actor: "user:reviewer", reason: "Checked original source"});
  try {
    const first = curateMemory(db, {operation: "add", input: {projectId: project.id, title: "Storage", content: "Use SQLite.", kind: "decision", source: "manual", confidence: 1, importance: 5, actor: "user"}}, authority);
    const thread = saveThread(db, {id: "source", projectId: project.id, title: "Review", source: "user", rawFormat: "markdown", rawText: "I confirm local SQLite storage is the chosen design."});
    const [proposal] = curateMemory(db, {operation: "propose", input: {projectId: project.id, threadId: thread.id, sourceAgent: "agent", extractionMethod: "agent", candidates: [{title: "Storage", kind: "decision", content: "Local SQLite storage is approved.", evidence: thread.rawText, confidence: 1, importance: 0.5}]}});
    expect(proposal.outcome).toBe("pending_review");
    const accepted = curateMemory(db, {operation: "review", projectId: project.id, candidateId: proposal.candidate.id, decision: "accept", actor: "user:reviewer", reason: "Checked original source", supersedesMemoryId: first.id}, authority);
    expect(accepted.memory?.supersedesMemoryId).toBe(first.id);
    const history = getMemoryHistory(db, project.id, first.id);
    expect(history.memories.map(memory => memory.status)).toEqual(["superseded", "active"]);
    expect(history.events).toContainEqual(expect.objectContaining({actor: "user:reviewer", reason: "Checked original source"}));
    expect(() => curateMemory(db, {operation: "restore", projectId: project.id, memoryId: first.id, actor: "user"}, authority)).toThrow(/superseded/);
  } finally { db.close(); }
});
