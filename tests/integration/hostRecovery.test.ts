import {expect,test} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {openDatabase} from '../../src/db/client.js';
import {createProject} from '../../src/projects/projectStore.js';
import {appendDomainEvent,enqueueOutboxMessage,listOutboxMessages} from '../../src/events/domainOutboxStore.js';
import {createOutboxRunner} from '../../src/events/outboxRunner.js';
import {migrate,CURRENT_SCHEMA_VERSION} from '../../src/db/schema.js';

async function connect(root:string,dbPath:string) {
 const client=new Client({name:'recovery-test',version:'1'},{capabilities:{}});
 const transport=new StdioClientTransport({command:process.execPath,args:[join(process.cwd(),'dist/src/index.js'),'mcp','serve','--db',dbPath,'--project-root',root,'--profile','core'],stderr:'pipe'});
 client.onerror=()=>{};
 await client.connect(transport);
 return {client,transport,call:async(name:string,args:Record<string,unknown>)=>{
  const result=await client.callTool({name,arguments:args});
  expect(result.isError).not.toBe(true);
  return JSON.parse((result.content as Array<{text:string}>)[0].text);
 }};
}

test('real stdio crash preserves a started turn; restart, duplicate completion and capture repair stay explicit',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mira-host-crash-'));const dbPath=join(root,'mira.sqlite');
 let first:Awaited<ReturnType<typeof connect>>|undefined;let restarted:typeof first;
 try {
  first=await connect(root,dbPath);
  const command={host:'codex',sessionId:'session',turnId:'turn',query:'Use local memory.'};
  const before=await first.call('before_turn',command);
  const closed=new Promise<void>(resolve=>{first!.client.onclose=resolve;});
  expect(first.transport.pid).toBeTruthy();process.kill(first.transport.pid!,'SIGKILL');await closed;
  restarted=await connect(root,dbPath);
  expect(await restarted.call('get_workflow_progress',{turnId:before.turn.id})).toMatchObject({stage:'awaiting_capture',turnProvenance:{identitySource:'caller_supplied',hostNativeGranularity:'session',hostCrash:'not_inferred'}});
  expect(await restarted.call('get_context_replay',{recallId:before.context.receipt.id})).toMatchObject({replay:'exact',markdown:before.context.markdown,source:'lifecycle_result'});
  const completion={...command,response:'Recorded.',status:'succeeded'};
  const after=await restarted.call('after_turn',completion);
  expect((await restarted.call('after_turn',completion)).duplicate).toBe(true);
  const db=openDatabase(dbPath);
  try {db.prepare('update capture_records set thread_id=null where id=?').run(after.capture.id);}finally{db.close();}
  await restarted.call('after_turn',completion);
  expect(await restarted.call('get_workflow_progress',{turnId:before.turn.id})).toMatchObject({turnProvenance:{capturePath:'repaired'}});
  const captureOnly=await restarted.call('after_turn',{...completion,turnId:'without-before'});
  expect(await restarted.call('get_workflow_progress',{turnId:captureOnly.turn.id})).toMatchObject({turnProvenance:{capturePath:'capture_only'}});
 }finally{await first?.client.close();await restarted?.client.close();await rm(root,{recursive:true,force:true});}
});

test('process death before migration version commit rolls back DDL and permits recovery',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mira-migration-crash-'));const dbPath=join(root,'mira.sqlite');
 try {
  let db=openDatabase(dbPath);db.exec(await readFile('tests/fixtures/migrations/v3.sql','utf8'));db.close();
  const clientUrl=pathToFileURL(join(process.cwd(),'dist/src/db/client.js')).href;
  const schemaUrl=pathToFileURL(join(process.cwd(),'dist/src/db/schema.js')).href;
  const script=`import {openDatabase} from ${JSON.stringify(clientUrl)};import {migrate} from ${JSON.stringify(schemaUrl)};const db=openDatabase(process.argv[1]);const original=db.prepare.bind(db);db.prepare=sql=>{if(sql.startsWith('insert into schema_version'))process.kill(process.pid,'SIGKILL');return original(sql);};migrate(db);`;
  const killed=spawnSync(process.execPath,['--input-type=module','-e',script,dbPath],{encoding:'utf8',timeout:10000});
  expect(killed.signal).toBe('SIGKILL');
  db=openDatabase(dbPath);
  try {
   expect(db.prepare('select max(version) from schema_version').pluck().get()).toBe(3);
   migrate(db);
   expect(db.prepare('select max(version) from schema_version').pluck().get()).toBe(CURRENT_SCHEMA_VERSION);
   expect(db.prepare('select job_id from memory_candidates where id=?').get('candidate_fixture')).toEqual({job_id:'job_fixture'});
   expect(db.prepare('pragma foreign_key_check').all()).toEqual([]);
  }finally{db.close();}
 }finally{await rm(root,{recursive:true,force:true});}
});

test('worker death on its final attempt recovers to failed without stranding pending work',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mira-worker-crash-'));const dbPath=join(root,'mira.sqlite');
 const db=openDatabase(dbPath);
 try {
  migrate(db);const project=createProject(db,{name:'Worker crash',rootPath:root});
  const event=appendDomainEvent(db,{projectId:project.id,aggregateType:'project',aggregateId:project.id,eventType:'projection_refresh_requested',payload:{reason:'recovery test'}});
  const message=enqueueOutboxMessage(db,{projectId:project.id,eventId:event.id,topic:'projection.refresh.requested',payload:{reason:'recovery test'},maxAttempts:1,createdAt:'2026-09-01T00:00:00.000Z'});
  const clientUrl=pathToFileURL(join(process.cwd(),'dist/src/db/client.js')).href;
  const runnerUrl=pathToFileURL(join(process.cwd(),'dist/src/events/outboxRunner.js')).href;
  const script=`import {openDatabase} from ${JSON.stringify(clientUrl)};import {createOutboxRunner} from ${JSON.stringify(runnerUrl)};const db=openDatabase(process.argv[1]);await createOutboxRunner({db,now:()=>new Date('2026-09-01T00:00:00.000Z'),leaseMs:1000}).runNext(process.argv[2],{'projection.refresh.requested':()=>process.kill(process.pid,'SIGKILL')});`;
  expect(spawnSync(process.execPath,['--input-type=module','-e',script,dbPath,project.id],{encoding:'utf8',timeout:10000}).signal).toBe('SIGKILL');
  expect(listOutboxMessages(db,project.id)[0]).toMatchObject({status:'running',attempts:1});
  let called=false;
  const runner=createOutboxRunner({db,now:()=>new Date('2026-09-01T00:00:02.000Z')});
  expect(await runner.runNext(project.id,{'projection.refresh.requested':()=>{called=true;}})).toBeUndefined();
  expect(called).toBe(false);
  expect(listOutboxMessages(db,project.id)[0]).toMatchObject({id:message.id,status:'failed',attempts:1,lastError:'Recovered expired lease',payload:{reason:'recovery test'}});
 }finally{db.close();await rm(root,{recursive:true,force:true});}
});
