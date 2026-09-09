import {expect,test} from 'vitest';
import {openDatabase} from '../../src/db/client.js';
import {migrate,CURRENT_SCHEMA_VERSION} from '../../src/db/schema.js';
import {createProject} from '../../src/projects/projectStore.js';
import {saveThread} from '../../src/threads/threadStore.js';
import {submitMemoryCandidates,listMemoryCandidates} from '../../src/distill/candidateService.js';
import {prepareContext} from '../../src/context/contextPreparation.js';
import {listRecallEvents} from '../../src/context/recallAuditStore.js';

test('v14 migration preserves legacy candidate and receipt facts without invented provenance',()=>{
 const db=openDatabase(':memory:');migrate(db);
 try {
  const project=createProject(db,{name:'Migration',rootPath:'/migration'});
  const thread=saveThread(db,{id:'old',projectId:project.id,title:'Old',source:'codex',rawFormat:'markdown',rawText:'Old source.'});
  const [candidate]=submitMemoryCandidates(db,{projectId:project.id,threadId:thread.id,sourceAgent:'codex',extractionMethod:'agent',candidates:[{title:'Old',kind:'decision',content:'Old source.',evidence:'Old source.',confidence:0.9,importance:0.5}]});
  const packet=prepareContext(db,project.id);
  const originalReceipt=JSON.parse(db.prepare('select receipt from recall_events where id=?').pluck().get(packet.receipt.id) as string);
  for(const key of ['schemaVersion','selections','scope','deliveryState','budgetPolicy','replay','researchRecallIds']) delete originalReceipt[key];
  db.prepare('update recall_events set receipt=? where id=?').run(JSON.stringify(originalReceipt),packet.receipt.id);
  db.exec("drop table context_payloads; alter table memory_candidates drop column provenance; alter table memory_candidates drop column acceptance_mode; delete from schema_version where version>=15; insert or ignore into schema_version values(14,'2026-01-01');");
  migrate(db);migrate(db);
  expect(db.prepare('select max(version) from schema_version').pluck().get()).toBe(CURRENT_SCHEMA_VERSION);
  const restored=listMemoryCandidates(db,project.id)[0];
  expect(restored.id).toBe(candidate.candidate.id);
  expect(restored.status).toBe('pending_review');
  expect(restored.acceptanceMode).toBe('unknown');
  expect(restored.provenance).toBeUndefined();
  expect(listRecallEvents(db,project.id)).toEqual([originalReceipt]);
 }finally{db.close();}
});
