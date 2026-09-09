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
