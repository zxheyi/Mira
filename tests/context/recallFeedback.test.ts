import { expect, test } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { addMemory } from "../../src/memory/memoryStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { recordRecallEvent, type RecallReceipt } from "../../src/context/recallAuditStore.js";
import {
  authorizeRecallFeedback,
  getRecallQualityReport,
  recordRecallFeedback
} from "../../src/context/recallFeedbackStore.js";

test("feedback attributes missing memories to retrieval, ranking and budget causes", () => {
  const db = openDatabase(":memory:"); migrate(db);
  const project = createProject(db, {name: "Quality", rootPath: "/recall-quality"});
  const authority = authorizeRecallFeedback(db, project.id, {
    actor: "user:reviewer",
    reason: "Explicit recall evaluation"
  });
  try {
    const input = {projectId:project.id,kind:"fact" as const,source:"manual",confidence:1,importance:5};
    const relevant = addMemory(db, {...input,title:"Relevant",content:"Use SQLite for local storage."});
    const irrelevant = addMemory(db, {...input,title:"Irrelevant",content:"Use blue for links."});
    const retrievalMiss = addMemory(db, {...input,title:"Semantic miss",content:"The embedded database is SQLite."});
    const rankingMiss = addMemory(db, {...input,title:"Ranked out",content:"Keep project state local."});
    const budgetMiss = addMemory(db, {...input,title:"Budgeted out",content:"Audit every context injection."});
    const receipt: RecallReceipt = {
      id:"recall_feedback_fixture",projectId:project.id,query:"local persistence",
      candidateMemoryIds:[relevant.id,irrelevant.id,rankingMiss.id,budgetMiss.id],
      injectedMemoryIds:[relevant.id,irrelevant.id],
      dropped:[
        {memoryId:rankingMiss.id,reason:"memory_limit"},
        {memoryId:budgetMiss.id,reason:"budget"}
      ],
      characterCount:100,tokenUpperBound:100,outputHash:"a".repeat(64),latencyMs:1,
      recorded:true,createdAt:"2026-09-01T00:00:00.000Z"
    };
    recordRecallEvent(db, receipt);

    expect(() => recordRecallFeedback(db, project.id, {
      recallId:receipt.id,outcome:"partial",relevantMemoryIds:[relevant.id],
      missingMemoryIds:[retrievalMiss.id,rankingMiss.id,budgetMiss.id],
      irrelevantMemoryIds:[irrelevant.id],correctedMemoryIds:[],reason:"One result helped; three expected memories were absent."
    })).toThrow(/authority/i);

    const feedback = recordRecallFeedback(db, project.id, {
      recallId:receipt.id,outcome:"partial",relevantMemoryIds:[relevant.id],
      missingMemoryIds:[retrievalMiss.id,rankingMiss.id,budgetMiss.id],
      irrelevantMemoryIds:[irrelevant.id],correctedMemoryIds:[],reason:"One result helped; three expected memories were absent."
    }, authority);
    expect(feedback).toMatchObject({recallId:receipt.id,outcome:"partial",actor:"user:reviewer"});

    expect(getRecallQualityReport(db, project.id)).toMatchObject({
      recallCount:1,labeledRecallCount:1,feedbackCoverage:1,
      outcomes:{useful:0,partial:1,missed:0,incorrect:0},
      retrievalMissMemoryIds:[retrievalMiss.id],
      rankingMissMemoryIds:[rankingMiss.id],
      budgetMissMemoryIds:[budgetMiss.id],
      unexplainedMissingMemoryIds:[],
      irrelevantMemoryIds:[irrelevant.id],
      correctedMemoryIds:[],
      recommendation:{status:"insufficient_data",minimumLabeledRecalls:20,minimumRetrievalMissRecords:5}
    });
  } finally { db.close(); }
});
