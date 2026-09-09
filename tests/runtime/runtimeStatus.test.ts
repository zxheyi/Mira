import {expect,test} from 'vitest';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../../src/db/client.js';
import {migrate} from '../../src/db/schema.js';
import {createProject} from '../../src/projects/projectStore.js';
import {callMiraTool} from '../../src/mcp/server.js';
import {authorizeCuration,curateMemory} from '../../src/memory/curationService.js';
import {runtimeStatus} from '../../src/runtime/runtimeStatus.js';

test('a read-only status never creates first-run state or claims host approval',()=>{
 const root=mkdtempSync(join(tmpdir(),'mira-status-'));
 try {
  const dbPath=join(root,'.mira','mira.sqlite');
  const status=callMiraTool({projectRoot:root,dbPath},'get_runtime_status',{}) as ReturnType<typeof runtimeStatus>;
  expect(existsSync(join(root,'.mira'))).toBe(false);
  expect(status.connection.state).toBe('unknown');
  expect(status.tools.every(t=>t.hostApproval==='unknown')).toBe(true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('scoped review authority cannot mutate memories and cannot be widened after grant',()=>{
 const db=openDatabase(':memory:');migrate(db);
 try {
  const project=createProject(db,{name:'Scopes',rootPath:'/scopes'});
  const policy={actor:'host',reason:'Review only',scopes:['memory.review' as const]};
  const authority=authorizeCuration(db,project.id,policy);
  expect(()=>curateMemory(db,{operation:'add',input:{projectId:project.id,title:'X',content:'X',kind:'fact',source:'manual',confidence:1,importance:5}},authority)).toThrow(/memory.mutate/);
  const status=callMiraTool({projectRoot:'/scopes',dbPath:':memory:',db,confirmationPolicy:policy},'get_runtime_status',{}) as ReturnType<typeof runtimeStatus>;
  expect(status.tools.find(t=>t.name==='review_memory_candidate')?.serverPermission).toBe('allowed');
  expect(status.tools.find(t=>t.name==='add_memory')?.serverPermission).toBe('denied');
 }finally{db.close();}
});
