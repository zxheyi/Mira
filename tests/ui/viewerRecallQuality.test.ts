import {mkdtemp, mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, expect, test} from "vitest";
import type Database from "better-sqlite3";
import {openDatabase} from "../../src/db/client.js";
import {migrate} from "../../src/db/schema.js";
import {createProject} from "../../src/projects/projectStore.js";
import {authorizeCuration, curateMemory} from "../../src/memory/curationService.js";
import {prepareContext} from "../../src/context/contextPreparation.js";
import {startViewerServer, type ViewerServerHandle} from "../../src/ui/viewerServer.js";

let db: Database.Database | undefined;
let viewer: ViewerServerHandle | undefined;
afterEach(async () => {
  await viewer?.close(); viewer = undefined;
  db?.close(); db = undefined;
});

test("Viewer exposes the domain Recall Quality report without changing retrieval", async () => {
  const root = await mkdtemp(join(tmpdir(), "mira-viewer-recall-quality-"));
  await mkdir(join(root, ".git"));
  const dbPath = join(root, ".mira", "mira.sqlite");
  db = openDatabase(dbPath); migrate(db);
  const project = createProject(db, {name:"Recall quality UI",rootPath:root});
  const authority = authorizeCuration(db, project.id, {actor:"test",reason:"Viewer quality fixture"});
  const relevant = curateMemory(db, {operation:"add",input:{
    projectId:project.id,title:"SQLite fact source",content:"SQLite is the fact source.",
    kind:"decision",source:"manual",confidence:1,importance:8
  }}, authority);
  const missing = curateMemory(db, {operation:"add",input:{
    projectId:project.id,title:"Evidence discipline",content:"Investment claims require verified evidence.",
    kind:"decision",source:"manual",confidence:1,importance:8
  }}, authority);
  const receipt = prepareContext(db, project.id, {query:"SQLite fact source"}).receipt;
  viewer = await startViewerServer({projectRoot:root,dbPath,port:0});
  const session = await (await fetch(viewer.url + "/api/session")).json() as {csrfToken:string};
  const headers = {
    "content-type":"application/json",origin:viewer.url,"x-mira-csrf":session.csrfToken
  };
  const feedback = await fetch(viewer.url + "/api/recall-feedback/" + receipt.id, {
    method:"POST",headers,body:JSON.stringify({
      outcome:"partial",relevantMemoryIds:[relevant.id],missingMemoryIds:[missing.id],
      reason:"The source-of-truth decision helped; the evidence rule was absent."
    })
  });
  expect(feedback.status).toBe(200);
  const correction = await fetch(viewer.url + "/api/memory/" + relevant.id, {
    method:"POST",headers,body:JSON.stringify({
      action:"correct",content:"SQLite with WAL is the fact source.",recallId:receipt.id,
      reason:"The user clarified the recalled decision."
    })
  });
  expect(correction.status).toBe(200);

  const response = await fetch(viewer.url + "/api/recall-quality");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    recallCount:1,
    labeledRecallCount:1,
    feedbackCoverage:1,
    outcomes:{partial:1},
    retrievalMissRecordCount:1,
    retrievalMissMemoryIds:[missing.id],
    rankingMissMemoryIds:[],
    budgetMissMemoryIds:[],
    irrelevantMemoryIds:[],
    correctedMemoryIds:[],
    confirmedCorrectionMemoryIds:[relevant.id],
    recommendation:{
      status:"insufficient_data",minimumLabeledRecalls:20,minimumRetrievalMissRecords:5
    }
  });
  const html = await (await fetch(viewer.url)).text();
  expect(html).toContain("召回质量证据");
  expect(html).toContain("不会自动切换检索");
});
