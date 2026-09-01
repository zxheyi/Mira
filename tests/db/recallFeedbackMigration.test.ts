import { expect, test } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { addMemory } from "../../src/memory/memoryStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { listRecallEvents, recordRecallEvent, type RecallReceipt } from "../../src/context/recallAuditStore.js";
import { authorizeRecallFeedback, recordRecallFeedback } from "../../src/context/recallFeedbackStore.js";

test("v13 to v14 preserves Recall Receipts and Memories while adding feedback storage", () => {
  const db = openDatabase(":memory:"); migrate(db);
  const project = createProject(db, {name:"Migration",rootPath:"/recall-feedback-v13"});
  try {
    const memory = addMemory(db, {projectId:project.id,title:"Preserved",kind:"fact",
      content:"Keep this Memory.",source:"manual",confidence:1,importance:5});
    const receipt: RecallReceipt = {id:"recall_v13",projectId:project.id,
      candidateMemoryIds:[memory.id],injectedMemoryIds:[memory.id],dropped:[],characterCount:1,
      tokenUpperBound:1,outputHash:"b".repeat(64),latencyMs:1,recorded:true,
      createdAt:"2026-09-01T00:00:00.000Z"};
    recordRecallEvent(db, receipt);
    db.exec(`drop table recall_feedback;
      drop index idx_recall_events_project_id;
      delete from schema_version;
      insert into schema_version values (13, '2026-09-01T00:00:00.000Z');`);

    migrate(db); migrate(db);

    expect(listRecallEvents(db, project.id)).toEqual([receipt]);
    expect(db.prepare("select content from memories where id = ?").pluck().get(memory.id)).toBe("Keep this Memory.");
    expect(db.prepare("select max(version) from schema_version").pluck().get()).toBe(14);
    const authority = authorizeRecallFeedback(db, project.id, {actor:"reviewer",reason:"Migration acceptance"});
    expect(recordRecallFeedback(db, project.id, {recallId:receipt.id,outcome:"useful",
      relevantMemoryIds:[memory.id],reason:"Expected Memory was returned."}, authority))
      .toMatchObject({recallId:receipt.id,outcome:"useful"});
  } finally { db.close(); }
});
