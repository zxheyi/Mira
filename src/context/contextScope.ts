import type Database from 'better-sqlite3';
import {resolve} from 'node:path';
import {findProjectByRoot} from '../projects/projectStore.js';
import {MiraError} from '../runtime/errors.js';

export type ScopeRequest = {expectedProjectId?:string;workspaceRoot?:string;taskId?:string;sessionId?:string;turnId?:string};
export type ContextScope = {
  schemaVersion:1;projectId:string;primaryRoot:string;workspaceRoot:string;
  bindingReason:'registered_root'|'registered_workspace_alias';scopeKind:'project'|'task';
  taskId:string|null;sessionId:string|null;turnId:string|null;sessionReason:'lifecycle'|'not_supplied';
};
export function assertExpectedProject(actual: string | undefined, expected?: string): void {
  if (expected !== undefined && (!expected.trim() || actual !== expected)) {
    throw new MiraError('PROJECT_MISMATCH','Requested project does not match the bound project','Select the intended project root or explicitly bind it before retrying');
  }
}
export function contextScope(db:Database.Database, projectId:string, input:ScopeRequest={}):ContextScope {
  assertExpectedProject(projectId,input.expectedProjectId);
  const project=db.prepare('select root_path from projects where id=?').get(projectId) as {root_path:string}|undefined;
  if(!project) throw new MiraError('PROJECT_NOT_FOUND','Bound project does not exist','Initialize or select the intended project');
  const root=input.workspaceRoot ? resolve(input.workspaceRoot) : project.root_path;
  if(input.workspaceRoot) assertExpectedProject(findProjectByRoot(db,root)?.id,projectId);
  return {schemaVersion:1,projectId,primaryRoot:project.root_path,workspaceRoot:root,
    bindingReason:root===project.root_path?'registered_root':'registered_workspace_alias',
    scopeKind:input.taskId?'task':'project',taskId:input.taskId??null,sessionId:input.sessionId??null,
    turnId:input.turnId??null,sessionReason:input.sessionId?'lifecycle':'not_supplied'};
}
