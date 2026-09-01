import { expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { addMemory } from "../../src/memory/memoryStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { recordRecallEvent, type RecallReceipt } from "../../src/context/recallAuditStore.js";
import { authorizeRecallFeedback, getRecallQualityReport, recordRecallFeedback } from "../../src/context/recallFeedbackStore.js";

function labelRecalls(db: Database.Database, root: string, missRecords: number, count = 20) {
  const project = createProject(db, {name:root,rootPath:root});
  const input = {projectId:project.id,kind:"fact" as const,source:"manual",confidence:1,importance:5};
  const relevant = addMemory(db, {...input,title:"Relevant",content:`Relevant ${root}`});
  const missing = addMemory(db, {...input,title:"Missing",content:`Semantic target ${root}`});
  const authority = authorizeRecallFeedback(db, project.id, {actor:"reviewer",reason:"Retrieval benchmark labeling"});
  for (let index = 0; index < count; index += 1) {
    const receipt: RecallReceipt = {id:`recall_${root}_${index}`,projectId:project.id,
      candidateMemoryIds:[relevant.id],injectedMemoryIds:[relevant.id],dropped:[],characterCount:1,
      tokenUpperBound:1,outputHash:String(index).padStart(64,"0"),latencyMs:1,recorded:true,
      createdAt:new Date(Date.UTC(2026, 8, 1, 0, 0, index)).toISOString()};
    recordRecallEvent(db, receipt);
    recordRecallFeedback(db, project.id, index < missRecords ? {
      recallId:receipt.id,outcome:"partial",relevantMemoryIds:[relevant.id],
      missingMemoryIds:[missing.id],reason:"Expected semantic match was absent."
    } : {
      recallId:receipt.id,outcome:"useful",relevantMemoryIds:[relevant.id],reason:"Expected Memory was returned."
    }, authority);
  }
  return getRecallQualityReport(db, project.id);
}

test("quality recommendation waits for twenty labels and requires five true retrieval-miss records", () => {
  const db = openDatabase(":memory:"); migrate(db);
  try {
    expect(labelRecalls(db, "/keep-fts", 4).recommendation.status).toBe("keep_fts");
    expect(labelRecalls(db, "/evaluate-hybrid", 5)).toMatchObject({
      labeledRecallCount:20,retrievalMissRecordCount:5,
      recommendation:{status:"evaluate_hybrid",minimumLabeledRecalls:20,minimumRetrievalMissRecords:5}
    });
  } finally { db.close(); }
});

test("quality report evaluates the complete feedback history beyond the paginated listing limit", () => {
  const db = openDatabase(":memory:"); migrate(db);
  try {
    expect(labelRecalls(db, "/complete-history", 0, 1001)).toMatchObject({
      recallCount:1001,labeledRecallCount:1001,outcomes:{useful:1001},
      recommendation:{status:"keep_fts"}
    });
  } finally { db.close(); }
});
