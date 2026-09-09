import {submitResearchPacket} from '../../src/research/researchService.js';
import {expect,test} from 'vitest';
import {openDatabase} from '../../src/db/client.js';
import {migrate} from '../../src/db/schema.js';
import {createProject} from '../../src/projects/projectStore.js';
import {addMemory} from '../../src/memory/memoryStore.js';
import {setWorkingMemory} from '../../src/workingMemory/workingMemoryStore.js';
import {prepareContext} from '../../src/context/contextPreparation.js';
import {listRecallEvents} from '../../src/context/recallAuditStore.js';
import {explainSelection} from '../../src/context/selectionManifest.js';

test('selection receipts distinguish bounded retrieval from budget omission and preserve input versions',()=>{
 const db=openDatabase(':memory:');migrate(db);
 try {
  const project=createProject(db,{name:'Manifest',rootPath:'/manifest'});
  const memory=addMemory(db,{projectId:project.id,title:'Storage',content:'SQLite stores project data.',kind:'fact',source:'manual',confidence:1,importance:5});
  const working=setWorkingMemory(db,{projectId:project.id,kind:'current_task',content:'中'.repeat(200)});
  const first=prepareContext(db,project.id,{maxCharacters:150});
  const manifest=first.receipt.selectionManifest!;
  expect(explainSelection(manifest,'never-retrieved').state).toBe('not_in_candidate_pool');
  expect(manifest.selections.find(item=>item.id===working.id)).toMatchObject({selected:false,section:'working_memory',reasons:['budget'],version:working.updatedAt,cost:{characters:expect.any(Number)}});
  expect(manifest.selections.find(item=>item.id===memory.id)).toMatchObject({version:memory.id,rank:1,contentHash:expect.stringMatching(/^[a-f0-9]{64}$/)});
  expect(manifest.cost.characters).toBe(first.markdown.length);
  expect(manifest.overheadCost.characters).toBeGreaterThanOrEqual(0);
  expect(manifest.outputHash).toBe(first.receipt.outputHash);
  setWorkingMemory(db,{projectId:project.id,kind:'current_task',content:'Changed source'});
  const next=prepareContext(db,project.id,{maxCharacters:150});
  expect(next.receipt.selectionManifest!.inputHash).not.toBe(manifest.inputHash);
  expect(listRecallEvents(db,project.id).find(item=>item.id===first.receipt.id)?.selectionManifest).toEqual(manifest);
 }finally{db.close();}
});

test('generic input fingerprint binds Research case inputs even with equal-length output changes',()=>{
 const db=openDatabase(':memory:');migrate(db);
 try {
  const project=createProject(db,{name:'Research manifest',rootPath:'/research-manifest'});
  const packet=submitResearchPacket(db,project.id,{case:{title:'Case A',question:'Why?',asOfDate:'2026-09-01'},
   snapshots:[{key:'S',canonicalUri:'https://example.test/report',sourceTitle:'Report',accessedAt:'2026-09-01',mediaType:'text/plain',content:'Page 1: measured ten units.'}],
   evidence:[{key:'E',snapshotKey:'S',sourceType:'other',sourceUri:'https://example.test/report',sourceTitle:'Report',locator:'Page 1',excerpt:'measured ten units.',accessedAt:'2026-09-01'}],
   claims:[{key:'C',statement:'Measured ten units.',evidenceStatus:'supported',confidence:0.9,thesisImpact:'none',invalidationConditions:'Restatement.',links:[{evidenceKey:'E',relation:'supports',rationale:'Same measurement.'}]}]});
  const options={researchCaseIds:[packet.researchCase.id],recordAudit:false};
  const first=prepareContext(db,project.id,options);
  db.prepare('update research_cases set title=?,as_of_date=? where id=?').run('Case B','2026-09-02',packet.researchCase.id);
  const next=prepareContext(db,project.id,options);
  expect(next.markdown.length).toBe(first.markdown.length);
  expect(next.markdown).not.toBe(first.markdown);
  expect(next.receipt.selectionManifest!.inputHash).not.toBe(first.receipt.selectionManifest!.inputHash);
 }finally{db.close();}
});
