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

test("Viewer correction from a Recall Receipt preserves recallId in immutable Memory history", async () => {
  const root = await mkdtemp(join(tmpdir(), "mira-viewer-recall-correction-"));
  await mkdir(join(root, ".git"));
  const dbPath = join(root, ".mira", "mira.sqlite");
  db = openDatabase(dbPath); migrate(db);
  const project = createProject(db, {name:"Recall correction UI",rootPath:root});
  const authority = authorizeCuration(db, project.id, {actor:"test",reason:"Viewer correction fixture"});
  const predecessor = curateMemory(db, {operation:"add",input:{
    projectId:project.id,title:"Storage decision",content:"Use Postgres.",kind:"decision",
    source:"manual",confidence:1,importance:9
  }}, authority);
  const receipt = prepareContext(db, project.id, {query:"Postgres"}).receipt;
  expect(receipt.injectedMemoryIds).toEqual([predecessor.id]);
  viewer = await startViewerServer({projectRoot:root,dbPath,port:0});
  const session = await (await fetch(viewer.url + "/api/session")).json() as {csrfToken:string};

  const response = await fetch(viewer.url + "/api/memory/" + predecessor.id, {
    method:"POST",
    headers:{
      "content-type":"application/json",
      origin:viewer.url,
      "x-mira-csrf":session.csrfToken
    },
    body:JSON.stringify({
      action:"correct",
      content:"Use SQLite with WAL.",
      reason:"The user corrected the recalled storage decision.",
      recallId:receipt.id
    })
  });
  expect(response.status).toBe(200);
  const successor = await response.json() as {id:string;supersedesMemoryId:string};
  expect(successor).toMatchObject({supersedesMemoryId:predecessor.id});

  const historyResponse = await fetch(viewer.url + "/api/memory/" + predecessor.id + "/history");
  expect(historyResponse.status).toBe(200);
  const history = await historyResponse.json() as {events:Array<{memoryId:string;eventType:string;metadata:Record<string,string>}>};
  expect(history.events).toEqual(expect.arrayContaining([
    expect.objectContaining({
      memoryId:successor.id,eventType:"updated",metadata:expect.objectContaining({recallId:receipt.id})
    }),
    expect.objectContaining({
      memoryId:predecessor.id,eventType:"superseded",metadata:expect.objectContaining({recallId:receipt.id})
    })
  ]));
  const html = await (await fetch(viewer.url)).text();
  expect(html).toContain("纠正此 Memory");
  expect(html).toContain("关联召回");
});
