import { test, expect } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { createProject } from "../../src/projects/projectStore.js";
import { saveThread } from "../../src/threads/threadStore.js";
import { curateMemory } from "../../src/memory/curationService.js";
import { getMemoryHistory } from "../../src/memory/memoryLifecycleStore.js";
import { prepareContext } from "../../src/context/contextPreparation.js";

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
  try {
    const first = curateMemory(db, {operation: "add", input: {projectId: project.id, title: "Storage", content: "Use SQLite.", kind: "decision", source: "manual", confidence: 1, importance: 5, actor: "user"}});
    const thread = saveThread(db, {id: "source", projectId: project.id, title: "Review", source: "user", rawFormat: "markdown", rawText: "I confirm local SQLite storage is the chosen design."});
    const [proposal] = curateMemory(db, {operation: "propose", input: {projectId: project.id, threadId: thread.id, sourceAgent: "agent", extractionMethod: "agent", candidates: [{title: "Storage", kind: "decision", content: "Local SQLite storage is approved.", evidence: thread.rawText, confidence: 1, importance: 0.5}]}});
    expect(proposal.outcome).toBe("pending_review");
    const accepted = curateMemory(db, {operation: "review", projectId: project.id, candidateId: proposal.candidate.id, decision: "accept", actor: "user:reviewer", reason: "Checked original source", supersedesMemoryId: first.id});
    expect(accepted.memory?.supersedesMemoryId).toBe(first.id);
    const history = getMemoryHistory(db, project.id, first.id);
    expect(history.memories.map(memory => memory.status)).toEqual(["superseded", "active"]);
    expect(history.events).toContainEqual(expect.objectContaining({actor: "user:reviewer", reason: "Checked original source"}));
    expect(() => curateMemory(db, {operation: "restore", projectId: project.id, memoryId: first.id, actor: "user"})).toThrow(/superseded/);
  } finally { db.close(); }
});
