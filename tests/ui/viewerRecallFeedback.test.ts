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
  await viewer?.close();
  viewer = undefined;
  db?.close();
  db = undefined;
});

test("Viewer records explicit feedback against a generic Recall Receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "mira-viewer-recall-feedback-"));
  await mkdir(join(root, ".git"));
  const dbPath = join(root, ".mira", "mira.sqlite");
  db = openDatabase(dbPath); migrate(db);
  const project = createProject(db, {name:"Recall feedback UI",rootPath:root});
  const authority = authorizeCuration(db, project.id, {actor:"test",reason:"Viewer feedback fixture"});
  const relevant = curateMemory(db, {operation:"add",input:{
    projectId:project.id,title:"SQLite fact source",content:"SQLite is Mira's fact source.",
    kind:"decision",source:"manual",confidence:1,importance:8
  }}, authority);
  const missing = curateMemory(db, {operation:"add",input:{
    projectId:project.id,title:"Evidence gate",content:"Research conclusions require verified evidence.",
    kind:"decision",source:"manual",confidence:1,importance:8
  }}, authority);
  const receipt = prepareContext(db, project.id, {query:"SQLite fact source"}).receipt;
  expect(receipt.injectedMemoryIds).toEqual([relevant.id]);
  viewer = await startViewerServer({projectRoot:root,dbPath,port:0});

  const initial = await fetch(viewer.url + "/api/recalls");
  expect(initial.status).toBe(200);
  expect(await initial.json()).toEqual([
    expect.objectContaining({id:receipt.id,injectedMemoryIds:[relevant.id]})
  ]);

  const session = await (await fetch(viewer.url + "/api/session")).json() as {csrfToken:string};
  const response = await fetch(viewer.url + "/api/recall-feedback/" + receipt.id, {
    method:"POST",
    headers:{
      "content-type":"application/json",
      origin:viewer.url,
      "x-mira-csrf":session.csrfToken
    },
    body:JSON.stringify({
      outcome:"partial",
      relevantMemoryIds:[relevant.id],
      missingMemoryIds:[missing.id],
      reason:"The database decision was useful, but the evidence rule was absent."
    })
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    recallId:receipt.id,outcome:"partial",relevantMemoryIds:[relevant.id],missingMemoryIds:[missing.id],actor:"ui:user"
  });

  const recorded = await (await fetch(viewer.url + "/api/recalls")).json() as unknown[];
  expect(recorded).toEqual([
    expect.objectContaining({
      id:receipt.id,
      feedback:expect.objectContaining({outcome:"partial",missingMemoryIds:[missing.id]})
    })
  ]);
  const html = await (await fetch(viewer.url)).text();
  expect(html).toContain('id="recall-feedback-form"');
  expect(html).toContain("标注召回");
});
