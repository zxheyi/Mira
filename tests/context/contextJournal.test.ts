import {expect,test} from 'vitest';
import {openDatabase} from '../../src/db/client.js';
import {migrate} from '../../src/db/schema.js';
import {createProject} from '../../src/projects/projectStore.js';
import {setWorkingMemory} from '../../src/workingMemory/workingMemoryStore.js';
import {prepareContext} from '../../src/context/contextPreparation.js';
import {authorizeContextDelivery,recordContextDelivery,getContextDelivery,replayContext} from '../../src/context/contextJournal.js';

test('working-memory omissions are audited; replay and delivery are explicit and hash-bound',()=>{
 const db=openDatabase(':memory:');migrate(db);
 try {
  const project=createProject(db,{name:'Journal',rootPath:'/journal'});
  const item=setWorkingMemory(db,{projectId:project.id,kind:'current_task',content:'中'.repeat(1000)});
  const packet=prepareContext(db,project.id,{maxCharacters:200,retainForSeconds:60});
  expect(packet.receipt.selections).toContainEqual(expect.objectContaining({type:'working_memory',id:item.id,selected:false,reasons:['budget']}));
  expect(packet.receipt.deliveryState).toBe('prepared');
  expect(replayContext(db,project.id,packet.receipt.id)).toMatchObject({replay:'exact',markdown:packet.markdown});
  expect(getContextDelivery(db,project.id,packet.receipt.id)).toMatchObject({state:'unknown'});
  const authority=authorizeContextDelivery(db,project.id,{actor:'host',reason:'Confirmed delivery',scopes:['context.delivery']});
  expect(()=>recordContextDelivery(db,project.id,packet.receipt.id,'bad',authority)).toThrow(/hash/);
  const delivered=recordContextDelivery(db,project.id,packet.receipt.id,packet.receipt.outputHash,authority);
  expect(delivered).toMatchObject({state:'delivered',modelUse:'unknown'});
  expect(recordContextDelivery(db,project.id,packet.receipt.id,packet.receipt.outputHash,authority)).toEqual(delivered);
  db.prepare("update context_payloads set expires_at='2000-01-01' where recall_id=?").run(packet.receipt.id);
  expect(replayContext(db,project.id,packet.receipt.id)).toMatchObject({replay:'unavailable'});
  prepareContext(db,project.id);
  expect(db.prepare('select count(*) as n from context_payloads').get()).toEqual({n:0});
  expect(getContextDelivery(db,project.id,packet.receipt.id).state).toBe('delivered');
 }finally{db.close();}
});
