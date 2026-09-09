import {expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Script} from 'node:vm';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {openDatabase} from '../../src/db/client.js';
import {migrate} from '../../src/db/schema.js';
import {ensureProjectForRoot} from '../../src/projects/projectStore.js';
import {setWorkingMemory} from '../../src/workingMemory/workingMemoryStore.js';
import {startViewerServer} from '../../src/ui/viewerServer.js';
import type {ContextPacket} from '../../src/context/contextPreparation.js';

test('real stdio, CLI and Viewer agree on scope and bounded preview without recall writes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mira-context-entrypoints-'));const dbPath=join(root,'mira.sqlite');
 const db=openDatabase(dbPath);migrate(db);const project=ensureProjectForRoot(db,root);
 setWorkingMemory(db,{projectId:project.id,kind:'current_task',content:'核对项目范围与预算。'});
 const viewer=await startViewerServer({projectRoot:root,dbPath,port:0});
 const client=new Client({name:'context-acceptance',version:'1'},{capabilities:{}});
 const transport=new StdioClientTransport({command:process.execPath,args:[join(process.cwd(),'dist/src/index.js'),'mcp','serve','--db',dbPath,'--project-root',root,'--profile','core'],stderr:'pipe'});
 try{
  await client.connect(transport);
  const call=async(name:string,args:Record<string,unknown>={})=>{
   const result=await client.callTool({name,arguments:args});expect(result.isError).not.toBe(true);
   return JSON.parse((result.content as Array<{text:string}>)[0].text);
  };
  const status=await call('get_runtime_status');
  expect(status.connection).toMatchObject({state:'connected',source:'current_mcp_request'});
  expect(status.tools.every((item:{hostApproval:string})=>item.hostApproval==='unknown')).toBe(true);
  expect(status.tools.some((item:{name:string})=>item.name==='review_memory_candidate')).toBe(false);
  const cli=JSON.parse(execFileSync(process.execPath,[join(process.cwd(),'dist/src/index.js'),'--project-root',root,'--db',dbPath,'context','prepare','--preview','--max-characters','4000'],{encoding:'utf8'})) as ContextPacket;
  const mcp=await call('prepare_context',{preview:true,maxCharacters:4000,expectedProjectId:project.id}) as ContextPacket;
  const ui=await (await fetch(viewer.url+'/api/context-bundle?expectedProjectId='+project.id)).json() as ContextPacket;
  expect(mcp.scope).toEqual(cli.scope);expect(ui.scope).toEqual(cli.scope);
  expect(mcp.markdown).toEqual(cli.markdown);expect(ui.markdown).toEqual(cli.markdown);
  expect([cli,mcp,ui].every(packet=>!packet.receipt.recorded)).toBe(true);
  const rejected=await client.callTool({name:'prepare_context',arguments:{expectedProjectId:'other'}});
  expect(rejected.isError).toBe(true);
  expect(rejected.structuredContent).toMatchObject({code:'PROJECT_MISMATCH',retryable:false});
  const mismatch=await fetch(viewer.url+'/api/context-bundle?expectedProjectId=other');
  expect(mismatch.status).toBe(400);
  expect(await mismatch.json()).toMatchObject({code:'PROJECT_MISMATCH'});
  expect(db.prepare('select count(*) as n from recall_events').get()).toEqual({n:0});
  const html=await (await fetch(viewer.url)).text();
  const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];expect(script).toBeTruthy();
  expect(()=>new Script(script!)).not.toThrow();
 }finally{await client.close();await viewer.close();db.close();await rm(root,{recursive:true,force:true});}
});
