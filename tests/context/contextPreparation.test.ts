import { test, expect } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { createProject } from "../../src/projects/projectStore.js";
import { addMemory } from "../../src/memory/memoryStore.js";
import { prepareContext } from "../../src/context/contextPreparation.js";
import { listRecallEvents } from "../../src/context/recallAuditStore.js";
import { listProjectBriefings } from "../../src/briefing/projectBriefingStore.js";

test("receipts identify complete injected entries and explain budget omissions", () => {
  const db = openDatabase(":memory:"); migrate(db);
  const project = createProject(db, {name: "Mira", rootPath: "/recall"});
  try {
    const input = { projectId: project.id, kind: "fact" as const, source: "manual", confidence: 1 };
    const large = addMemory(db, {...input, title: "Oversized", content: "large ".repeat(1000), importance: 10});
    const short = addMemory(db, {...input, title: "Short fact", content: "A compact fact.", importance: 5});
    const packet = prepareContext(db, project.id, {maxCharacters: 600, taskId: "a"});
    expect(packet.markdown).toContain(short.content);
    expect(packet.markdown).toContain(short.id);
    expect(packet.markdown).not.toContain(large.content);
    expect(packet.receipt.injectedMemoryIds).toEqual([short.id]);
    expect(packet.receipt.dropped).toContainEqual({memoryId: large.id, reason: "budget"});
    expect(listRecallEvents(db, project.id, {taskId:"a"})[0]).toEqual(packet.receipt);
    expect(listRecallEvents(db, project.id, {taskId:"b"})).toEqual([]);
  } finally { db.close(); }
});

test("preview writes neither audit nor briefing and Chinese context respects both budgets", () => {
  const db = openDatabase(":memory:"); migrate(db);
  const project = createProject(db, {name: "中文", rootPath: "/preview"});
  try {
    addMemory(db, {projectId: project.id, title: "中文记忆", content: "投资证据必须可追溯。", kind: "fact", source: "manual", confidence: 1, importance: 5});
    const preview = prepareContext(db, project.id, {recordAudit: false, maxCharacters: 600, maxTokens: 400});
    expect(preview.markdown).toContain("投资证据必须可追溯");
    expect(preview.receipt.recorded).toBe(false);
    expect(Buffer.byteLength(preview.markdown)).toBeLessThanOrEqual(400);
    expect(preview.markdown.length).toBeLessThanOrEqual(600);
    expect(listRecallEvents(db, project.id)).toEqual([]);
    expect(listProjectBriefings(db, project.id)).toEqual([]);
    const packet = prepareContext(db, project.id, {query: "api_key=supersecret123456789"});
    expect(packet.receipt.query).toBe("[REDACTED]");
    expect(JSON.stringify(listRecallEvents(db, project.id))).not.toContain("supersecret");
  } finally { db.close(); }
});

test("phrase matches do not suppress term fallback candidates", () => {
  const db = openDatabase(":memory:"); migrate(db);
  const project = createProject(db, {name: "Search", rootPath: "/fallback"});
  try {
    const input = {projectId: project.id, kind: "fact" as const, source: "manual", confidence: 1, importance: 5};
    const phrase = addMemory(db, {...input, title: "Phrase", content: "SQLite evidence"});
    const term = addMemory(db, {...input, title: "Fallback", content: "SQLite local storage"});
    const packet = prepareContext(db, project.id, {query: "SQLite evidence"});
    expect(packet.receipt.injectedMemoryIds).toEqual([phrase.id, term.id]);
  } finally { db.close(); }
});
