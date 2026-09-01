import { expect, test } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { addMemory } from "../../src/memory/memoryStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { recordRecallEvent, type RecallReceipt } from "../../src/context/recallAuditStore.js";
import { authorizeRecallFeedback, recordRecallFeedback } from "../../src/context/recallFeedbackStore.js";

test("feedback authority and Memory labels cannot cross projects or contradict a receipt", () => {
  const db = openDatabase(":memory:"); migrate(db);
  const project = createProject(db, {name:"One",rootPath:"/feedback-one"});
  const other = createProject(db, {name:"Two",rootPath:"/feedback-two"});
  try {
    const memory = addMemory(db, {projectId:project.id,title:"Injected",kind:"fact",
      content:"Project one.",source:"manual",confidence:1,importance:5});
    const otherMemory = addMemory(db, {projectId:other.id,title:"Other",kind:"fact",
      content:"Project two.",source:"manual",confidence:1,importance:5});
    const receipt: RecallReceipt = {id:"recall_validation",projectId:project.id,
      candidateMemoryIds:[memory.id],injectedMemoryIds:[memory.id],dropped:[],characterCount:1,
      tokenUpperBound:1,outputHash:"c".repeat(64),latencyMs:1,recorded:true,
      createdAt:"2026-09-01T00:00:00.000Z"};
    recordRecallEvent(db, receipt);
    const authority = authorizeRecallFeedback(db, project.id, {actor:"reviewer",reason:"Explicit feedback"});
    const otherAuthority = authorizeRecallFeedback(db, other.id, {actor:"other",reason:"Other project"});
    const base = {recallId:receipt.id,outcome:"partial" as const,reason:"Explicit evaluation"};

    expect(() => recordRecallFeedback(db, project.id, {...base,relevantMemoryIds:[memory.id]}, {} as never)).toThrow(/authority/i);
    expect(() => recordRecallFeedback(db, project.id, {...base,relevantMemoryIds:[memory.id]}, otherAuthority)).toThrow(/authority/i);
    expect(() => recordRecallFeedback(db, project.id, {...base,relevantMemoryIds:[otherMemory.id]}, authority)).toThrow(/not injected/i);
    expect(() => recordRecallFeedback(db, project.id, {...base,missingMemoryIds:[memory.id]}, authority)).toThrow(/was injected/i);
    expect(() => recordRecallFeedback(db, project.id, {...base,relevantMemoryIds:[memory.id],correctedMemoryIds:[memory.id]}, authority)).toThrow(/both/i);
    expect(() => recordRecallFeedback(db, project.id, {...base,relevantMemoryIds:[memory.id,memory.id]}, authority)).toThrow(/unique/i);
    expect(() => recordRecallFeedback(db, project.id, {...base,relevantMemoryIds:[memory.id],reason:"api_key=privatevalue123456"}, authority)).toThrow(/sensitive/i);
  } finally { db.close(); }
});
