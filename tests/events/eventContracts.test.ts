import {expect,test} from 'vitest';
import {openDatabase} from '../../src/db/client.js';
import {migrate} from '../../src/db/schema.js';
import {createProject} from '../../src/projects/projectStore.js';
import {appendDomainEvent,enqueueOutboxMessage,pruneCompletedOutboxPayloads} from '../../src/events/domainOutboxStore.js';
import {createOutboxRunner} from '../../src/events/outboxRunner.js';

test('event and outbox contracts reject bodies, secrets, oversize data and cross-project links before writes',()=>{
 const db=openDatabase(':memory:');migrate(db);
 try {
  const project=createProject(db,{name:'Events',rootPath:'/events'});
  const event={projectId:project.id,aggregateType:'project',aggregateId:project.id,eventType:'projection_refresh_requested',payload:{reason:'refresh'}};
  for(const payload of [{reason:'refresh',transcript:'private body'}, {reason:'api_key=privatevalue123456'}, {reason:'中'.repeat(6000)}]) expect(()=>appendDomainEvent(db,{...event,payload})).toThrow();
  expect(()=>appendDomainEvent(db,{...event,eventType:'unregistered'})).toThrow(/Unknown/);
  expect(db.prepare('select count(*) as n from domain_events').get()).toEqual({n:0});
  const saved=appendDomainEvent(db,event);
  const other=createProject(db,{name:'Other',rootPath:'/other'});
  expect(()=>enqueueOutboxMessage(db,{projectId:other.id,eventId:saved.id,topic:'projection.refresh.requested',payload:{reason:'refresh'}})).toThrow(/same project/);
  expect(db.prepare('select count(*) as n from outbox_messages').get()).toEqual({n:0});
 }finally{db.close();}
});

test('retention preserves unfinished work and identities; workers reject legacy unvalidated bodies',async()=>{
 const db=openDatabase(':memory:');migrate(db);
 try {
  const project=createProject(db,{name:'Retention',rootPath:'/retention'});
  const event=appendDomainEvent(db,{projectId:project.id,aggregateType:'project',aggregateId:project.id,eventType:'projection_refresh_requested',payload:{reason:'refresh'}});
  const messages=Array.from({length:3},()=>enqueueOutboxMessage(db,{projectId:project.id,eventId:appendDomainEvent(db,{projectId:project.id,aggregateType:'project',aggregateId:project.id,eventType:'projection_refresh_requested',payload:{reason:'refresh'}}).id,topic:'projection.refresh.requested',payload:{reason:'refresh'},maxAttempts:1,createdAt:'2026-01-01T00:00:00.000Z'}));
  db.prepare("update outbox_messages set status='completed' where id=?").run(messages[0].id);
  db.prepare("update outbox_messages set status='failed' where id=?").run(messages[1].id);
  const result=pruneCompletedOutboxPayloads(db,project.id,new Date('2026-02-01T00:00:00.000Z'));
  expect(result.completedPayloadsPruned['projection.refresh.requested']).toBe(1);
  expect(db.prepare('select count(*) as n from outbox_messages').get()).toEqual({n:3});
  expect(db.prepare('select payload from outbox_messages where id=?').get(messages[1].id)).toEqual({payload:JSON.stringify({reason:'refresh'})});
  db.prepare('update outbox_messages set payload=? where id=?').run(JSON.stringify({transcript:'Old unvalidated body'}),messages[2].id);
  let called=false;
  const runner=createOutboxRunner({db});
  expect((await runner.runNext(project.id,{'projection.refresh.requested':()=>{called=true;}}))?.status).toBe('failed');
  expect(called).toBe(false);
  expect(db.prepare('select count(*) as n from domain_events').get()).toEqual({n:4});
 }finally{db.close();}
});
