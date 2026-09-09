import {expect,test} from 'vitest';
import {openDatabase} from '../../src/db/client.js';
import {migrate} from '../../src/db/schema.js';
import {createProject} from '../../src/projects/projectStore.js';
import {prepareContext} from '../../src/context/contextPreparation.js';
import {callMiraTool} from '../../src/mcp/server.js';
import {listRecallEvents} from '../../src/context/recallAuditStore.js';

test('scope is explicit and project mismatch leaves recalls and lifecycle unchanged',()=>{
  const db=openDatabase(':memory:');migrate(db);
  try {
    const project=createProject(db,{name:'Scope',rootPath:'/scope'});
    const packet=prepareContext(db,project.id,{taskId:'task-a',recordAudit:false,maxCharacters:1});
    expect(packet.scope).toMatchObject({projectId:project.id,primaryRoot:'/scope',workspaceRoot:'/scope',taskId:'task-a',sessionId:null,scopeKind:'task'});
    expect(packet.generatedAt).toBeTruthy();
    expect(()=>prepareContext(db,project.id,{expectedProjectId:'other'})).toThrow(/does not match/);
    expect(()=>callMiraTool({db,projectRoot:'/scope',dbPath:':memory:'},'before_turn',{
      host:'mcp',sessionId:'s',turnId:'t',query:'q',expectedProjectId:'other'
    })).toThrow(/does not match/);
    expect(listRecallEvents(db,project.id)).toEqual([]);
    expect(db.prepare('select count(*) as n from lifecycle_turns').get()).toEqual({n:0});
  }finally{db.close();}
});
