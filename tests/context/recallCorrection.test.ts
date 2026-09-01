import { expect, test } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { authorizeCuration, curateMemory } from "../../src/memory/curationService.js";
import { getMemoryHistory } from "../../src/memory/memoryLifecycleStore.js";
import { createProject } from "../../src/projects/projectStore.js";
import { prepareContext } from "../../src/context/contextPreparation.js";
import { getRecallQualityReport } from "../../src/context/recallFeedbackStore.js";

test("a confirmed correction links immutable Memory events to the Recall Receipt that exposed it", () => {
  const db = openDatabase(":memory:"); migrate(db);
  const project = createProject(db, {name:"Correction",rootPath:"/recall-correction"});
  const authority = authorizeCuration(db, project.id, {actor:"user:reviewer",reason:"User corrected recalled memory"});
  try {
    const predecessor = curateMemory(db, {operation:"add",input:{
      projectId:project.id,title:"Storage",kind:"decision",content:"Use Postgres.",
      source:"manual",confidence:1,importance:8
    }}, authority);
    const recall = prepareContext(db, project.id, {query:"Postgres"}).receipt;
    expect(recall.injectedMemoryIds).toEqual([predecessor.id]);

    const successor = curateMemory(db, {operation:"correct",input:{
      projectId:project.id,memoryId:predecessor.id,content:"Use SQLite.",recallId:recall.id
    }}, authority);
    const history = getMemoryHistory(db, project.id, predecessor.id);
    expect(history.memories.map((item) => item.id)).toEqual([predecessor.id, successor.id]);
    expect(history.events).toEqual(expect.arrayContaining([
      expect.objectContaining({memoryId:successor.id,eventType:"updated",metadata:expect.objectContaining({recallId:recall.id})}),
      expect.objectContaining({memoryId:predecessor.id,eventType:"superseded",metadata:expect.objectContaining({recallId:recall.id})})
    ]));
    expect(getRecallQualityReport(db, project.id)).toMatchObject({
      correctedMemoryIds:[],
      confirmedCorrectionMemoryIds:[predecessor.id]
    });
  } finally { db.close(); }
});
