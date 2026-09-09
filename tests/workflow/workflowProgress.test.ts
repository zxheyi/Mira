import {expect,test} from 'vitest';
import {openDatabase} from '../../src/db/client.js';
import {migrate} from '../../src/db/schema.js';
import {createProject} from '../../src/projects/projectStore.js';
import {createTurnLifecycle} from '../../src/lifecycle/turnLifecycle.js';
import {createHostAdapterRegistry} from '../../src/lifecycle/hostAdapterRegistry.js';
import {createOutboxRunner} from '../../src/events/outboxRunner.js';
import {createDefaultOutboxHandlers,drainOutbox} from '../../src/events/defaultOutboxHandlers.js';
import {runNextDistillJob} from '../../src/distill/distillWorker.js';
import {getWorkflowProgress} from '../../src/workflow/workflowProgress.js';
import {reviewMemoryCandidate} from '../../src/distill/candidateService.js';
import {callMiraTool,createMiraMcpServer} from '../../src/mcp/server.js';

test('progress distinguishes queued, pending review and accepted without duplicate finish work',async()=>{
 const db=openDatabase(':memory:');migrate(db);
 try{
  const project=createProject(db,{name:'Workflow',rootPath:'/workflow'});
  const lifecycle=createTurnLifecycle({db,projectId:project.id});
  const command=createHostAdapterRegistry().normalizeAfterTurn('mcp',{sessionId:'s',turnId:'t',query:'Use SQLite.',response:'Recorded.',status:'succeeded'});
  const result=lifecycle.afterTurn(command);
  expect(result.processing?.memoryAcceptance).toBe('not_implied');
  expect(getWorkflowProgress(db,project.id,result.turn.id).stage).toBe('queued');
  expect(lifecycle.afterTurn(command).outboxMessageIds).toEqual(result.outboxMessageIds);
  await drainOutbox(createOutboxRunner({db}),project.id,createDefaultOutboxHandlers({db}));
  await runNextDistillJob(db,project.id,{distill:async()=>[{title:'Storage decision',kind:'decision',content:'Use SQLite.',evidence:'Use SQLite.',confidence:1,importance:0.8}]},'fixture');
  const progress=getWorkflowProgress(db,project.id,result.turn.id);
  expect(progress.stage).toBe('pending_review');
  reviewMemoryCandidate(db,project.id,progress.candidates[0].id,'accept','Reviewed');
  expect(getWorkflowProgress(db,project.id,result.turn.id).stage).toBe('accepted');
  expect(()=>getWorkflowProgress(db,'other',result.turn.id)).toThrow(/not found/);
 }finally{db.close();}
});
test('profiles are fixed surfaces and do not grant authority',async()=>{
 const db=openDatabase(':memory:');migrate(db);
 try{
  createProject(db,{name:'Profiles',rootPath:'/profiles'});
  const options={db,dbPath:':memory:',projectRoot:'/profiles'};
  const core=createMiraMcpServer({...options,profile:'core'});
  expect(core.toolNames).toContain('before_turn');
  expect(core.toolNames).not.toContain('review_memory_candidate');
  expect(()=>callMiraTool({...options,profile:'core'},'review_memory_candidate',{candidateId:'x',decision:'accept'})).toThrow(/profile/);
  expect(()=>callMiraTool({...options,profile:'admin'},'add_memory',{title:'X',content:'X',kind:'fact',source:'manual'})).toThrow(/authority/);
  await core.server.close();
 }finally{db.close();}
});
