import {allows,GOVERNED_TOOLS,type CapabilityPolicy} from './capabilities.js';
import type {ContextScope} from '../context/contextScope.js';
import type {DoctorReport} from '../doctor/doctor.js';

export function runtimeStatus(input:{scope?:ContextScope;policy?:CapabilityPolicy;tools?:readonly string[];doctor?:DoctorReport;connectionObserved?:boolean}) {
  const observedAt=new Date().toISOString();
  const project=input.doctor?.database.project;
  const scope=input.scope ?? (project && input.doctor ? {
    schemaVersion:1 as const,projectId:project.id,primaryRoot:project.rootPath,workspaceRoot:input.doctor.projectRoot,
    bindingReason:project.rootPath===input.doctor.projectRoot?'registered_root' as const:'registered_workspace_alias' as const,
    scopeKind:'project' as const,taskId:null,sessionId:null,turnId:null,sessionReason:'not_supplied' as const
  } : null);
  return {
    schemaVersion:1,observedAt,scope,
    configuration:input.doctor ? {state:'observed',source:'project_configuration',observedAt,hosts:input.doctor.integrations}
      : {state:'unknown',source:'not_inspected',observedAt},
    connection:{state:input.connectionObserved?'connected':'unknown',source:input.connectionObserved?'current_mcp_request':'not_observed',observedAt},
    delegation:input.policy ? {mode:input.policy.scopes===undefined&&input.policy.developmentLegacyBroad?'development_legacy_broad':'scoped',actor:input.policy.actor,scopes:input.policy.scopes??(input.policy.developmentLegacyBroad?Object.values(GOVERNED_TOOLS).filter((x,i,a)=>a.indexOf(x)===i):[])} : {mode:input.tools?'none':'unknown',scopes:[]},
    tools:(input.tools??Object.keys(GOVERNED_TOOLS)).map(name=>({name,registered:input.tools?input.tools.includes(name):'unknown',
      serverPermission:input.tools ? (!GOVERNED_TOOLS[name] || allows(input.policy,GOVERNED_TOOLS[name])?'allowed':'denied') : 'unknown',
      hostApproval:'unknown',scope:GOVERNED_TOOLS[name]??null,
      reasonCode:!input.tools?'SERVER_POLICY_NOT_OBSERVED':GOVERNED_TOOLS[name]&&!allows(input.policy,GOVERNED_TOOLS[name])?'HOST_AUTHORITY_REQUIRED':'SERVER_POLICY_ALLOWS',
      nextAction:!input.tools?'Inspect status through the connected MCP session':GOVERNED_TOOLS[name]&&!allows(input.policy,GOVERNED_TOOLS[name])?'Submit a candidate or review in local CLI/UI':'Follow the host approval policy'})),
    diagnostics:input.doctor??null
  };
}
export function renderRuntimeStatus(status:ReturnType<typeof runtimeStatus>):string {
  return [`Mira status · ${status.observedAt}`,`Project: ${status.scope?.projectId??status.diagnostics?.database.project?.id??'not bound'}`,
    `Workspace: ${status.scope?.workspaceRoot??status.diagnostics?.projectRoot??'unknown'}`,
    `MCP connection: ${status.connection.state} (${status.connection.source})`,
    'Host approval: unknown — the host must supply approval information',
    ...(status.diagnostics ? Object.entries(status.diagnostics.integrations).map(([host,value])=>`${host} configuration: ${value.installed?'installed':'incomplete'}`):[]),
    ...status.tools.map(tool=>`${tool.name}: ${tool.serverPermission}; ${tool.nextAction}`)].join('\n');
}
