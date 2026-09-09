import {persistContextPacket} from "./contextJournal.js";
import {normalizeBudget, withinBudget, type ContextSelection} from "./contextBudget.js";
import {prepareResearchContext,recordPreparedResearchContext,type ResearchContextPacket} from "../research/researchContext.js";
import {contextScope, type ScopeRequest, type ContextScope} from "./contextScope.js";
import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { ensureFreshProjectBriefing, getLatestCompleteProjectBriefing } from "../briefing/projectBriefingStore.js";
import { containsSensitiveInformation } from "../distill/candidatePolicy.js";
import { listTopMemoriesForProject, searchMemories, type Memory } from "../memory/memoryStore.js";
import { listWorkingMemory, normalizeTaskId } from "../workingMemory/workingMemoryStore.js";
import { recordRecallEvent, type RecallReceipt } from "./recallAuditStore.js";

export type PrepareContextOptions = ScopeRequest & {
  taskId?: string; query?: string; memoryLimit?: number; maxCharacters?: number; maxTokens?: number;
  recordAudit?: boolean; transport?:"mcp"|"cli"|"ui"|"internal"; researchCaseIds?:string[]; retainForSeconds?:number;
};
export type ContextPacket = { freshness:{briefing:"current"|"stale"|"missing";research:Array<{caseId:string;asOfDate:string}>}; schemaVersion: 1; scope: ContextScope; generatedAt: string; markdown: string; receipt: RecallReceipt };
const warningKinds = new Set(["failed_attempt", "lesson", "constraint"]);
const workingPriority = ["blocker", "current_task", "current_phase", "next_step", "recent_decision", "preference", "decision", "note"];

function validateInteger(value: number | undefined, name: string, min: number, max: number): void {
  if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
}

function candidates(db: Database.Database, projectId: string, query: string | undefined, limit: number): Memory[] {
  if (!query) return listTopMemoriesForProject(db, projectId, limit);
  const phrase = searchMemories(db, projectId, query, {limit, queryMode: "phrase"});
  const terms = searchMemories(db, projectId, query, {limit, queryMode: "orTerms"});
  const ids = new Set(phrase.map(hit => hit.memory.id));
  return [...phrase, ...terms.filter(hit => !ids.has(hit.memory.id))].map(hit => hit.memory);
}

function renderMemory(memory: Memory): string {
  return [`### ${memory.title}`, `- id: ${memory.id}`, `- kind: ${memory.kind}`,
    ...(memory.source !== "manual" ? [`- source: ${memory.source}`] : []),
    ...(memory.confidence !== 1 ? [`- confidence: ${memory.confidence}`] : []), memory.content].join("\n");
}

/** One public interface owns selection, rendering and the evidence of what was injected. */
export function prepareContext(db: Database.Database, projectId: string, options: PrepareContextOptions = {}): ContextPacket {
  return db.transaction(()=>prepareContextInTransaction(db,projectId,options))();
}

function prepareContextInTransaction(db:Database.Database,projectId:string,options:PrepareContextOptions):ContextPacket {
  if(options.retainForSeconds!==undefined && (!Number.isInteger(options.retainForSeconds)||options.retainForSeconds<0||options.retainForSeconds>86400)) throw new Error("retainForSeconds must be between 0 and 86400");
  const scope = contextScope(db, projectId, options);
  const budget=normalizeBudget(options);
  const researchCaseIds=[...new Set(options.researchCaseIds??[])];
  if(researchCaseIds.length>10) throw new Error("At most 10 Research Cases may be selected");
  // Validate selected cases before projection or audit writes.
  const research=researchCaseIds.map(caseId=>prepareResearchContext(db,projectId,caseId,{...options,...budget}));
  const selections:ContextSelection[]=[];
  const includedResearch:ResearchContextPacket[]=[];
  const started = Date.now();
  validateInteger(options.memoryLimit, "memoryLimit", 1, 50);
  validateInteger(options.maxCharacters, "maxCharacters", 1, 1_000_000);
  validateInteger(options.maxTokens, "maxTokens", 25, 250_000);
  const taskId = normalizeTaskId(options.taskId);
  const query = options.query?.trim();
  if (query && query.length > 1000) throw new Error("query must be at most 1000 characters");
  const project = db.prepare("select name from projects where id = ?").get(projectId) as { name: string } | undefined;
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const shared = listWorkingMemory(db, projectId);
  const task = taskId ? listWorkingMemory(db, projectId, taskId) : [];
  for(const item of shared) if(task.some(override=>override.kind===item.kind)) selections.push({type:"working_memory",id:item.id,selected:false,reasons:["task_override"]});
  const working = [...new Map([...shared, ...task].map(item => [item.kind, item])).values()]
    .sort((a,b) => workingPriority.indexOf(a.kind) - workingPriority.indexOf(b.kind));
  const briefing = options.recordAudit === false || taskId
    ? getLatestCompleteProjectBriefing(db, projectId) : ensureFreshProjectBriefing(db, projectId);
  const pool = candidates(db, projectId, query, Math.min(200, (options.memoryLimit ?? 8) * 4));
  const ordered = [...pool.filter(item => warningKinds.has(item.kind)), ...pool.filter(item => !warningKinds.has(item.kind))];
  const injected: string[] = [];
  const dropped: RecallReceipt["dropped"] = [];
  let markdown = "";
  const fits = (text: string) => withinBudget(text,budget);
  const append = (text: string): boolean => {
    const next = markdown + text + "\n\n";
    if (!fits(next)) return false;
    markdown = next; return true;
  };
  // Only the static heading may be shortened for tiny budgets; entries are atomic.
  for (const character of "# Mira Context Bundle\n\n") {
    if (!fits(markdown + character)) break;
    markdown += character;
  }
  if (taskId) append(`Task ID: ${JSON.stringify(taskId)}`);
  append("## Working Memory");
  for (const item of working) {
    const selected=append(`### ${item.kind}\n- updatedAt: ${item.updatedAt}\n${item.content}`);
    selections.push({type:"working_memory",id:item.id,selected,reasons:[selected?"task_priority":"budget"],contentHash:createHash("sha256").update(item.content).digest("hex")});
  }
  if (!working.length) append("No working memory recorded.");
  // The complete Briefing remains available separately; avoid reinjecting its duplicate, unfiltered memories.
  const briefingSelected=append(`## Project Briefing\nProject: ${project.name}${briefing ? ` · v${briefing.version}${briefing.staleAt ? " (stale)" : ""}` : ""}`);
  if(briefing) selections.push({type:"briefing",id:briefing.id,selected:briefingSelected,reasons:[briefingSelected?"metadata_only":"budget",...(briefing.staleAt?["stale_projection"]:[])]});
  for(const packet of research) {
    const remaining={maxCharacters:Math.max(1,budget.maxCharacters-markdown.length-2),maxTokens:Math.max(1,budget.maxTokens-Buffer.byteLength(markdown,"utf8")-2)};
    const bounded=prepareResearchContext(db,projectId,packet.caseId,{...options,...remaining});
    const selected=bounded.markdown.length>0 && append(bounded.markdown);
    if(selected) includedResearch.push(bounded);
    selections.push(...bounded.selections.map(item=>item.selected&&!selected?{...item,selected:false,reasons:["budget"]}:item));
  }
  let currentSection = "";
  for (const memory of ordered) {
    if (injected.length >= (options.memoryLimit ?? 8)) {
      dropped.push({memoryId: memory.id, reason: "memory_limit"}); continue;
    }
    const section = warningKinds.has(memory.kind) ? "## Warnings" : "## Long-Term Memory";
    const text = `${currentSection === section ? "" : section + "\n\n"}${renderMemory(memory)}`;
    if (append(text)) { injected.push(memory.id); currentSection = section; }
    else dropped.push({memoryId: memory.id, reason: "budget"});
  }
  for(const memory of ordered) selections.push({type:"memory",id:memory.id,selected:injected.includes(memory.id),reasons:[injected.includes(memory.id)?(query?"query_match":"project_priority"):dropped.find(item=>item.memoryId===memory.id)?.reason??"not_selected"],contentHash:createHash("sha256").update(memory.content).digest("hex")});
  if (!pool.some(memory => !warningKinds.has(memory.kind))) append("## Long-Term Memory\nNo matching long-term memory.");
  if (dropped.length) append(`Some memories omitted; inspect the recall receipt. (${dropped.length} omitted)`);
  const receipt: RecallReceipt = {
    schemaVersion:2,deliveryState:"prepared",scope,selections,budgetPolicy:"context-v2-utf8-upper-bound",replay:(options.retainForSeconds??0)>0?"retained_payload":"references_only",
    id: `recall_${randomUUID()}`, projectId, ...(taskId ? {taskId} : {}),
    ...(query ? {query: containsSensitiveInformation(query) ? "[REDACTED]" : query} : {}),
    candidateMemoryIds: pool.map(memory => memory.id), injectedMemoryIds: injected, dropped,
    characterCount: markdown.length, tokenUpperBound: Buffer.byteLength(markdown, "utf8"),
    maxCharacters:budget.maxCharacters,
    maxTokens:budget.maxTokens,
    outputHash: createHash("sha256").update(markdown).digest("hex"), latencyMs: Date.now() - started,
    recorded: options.recordAudit !== false, createdAt: new Date().toISOString()
  };
  if (receipt.recorded) db.transaction(()=>{
    receipt.researchRecallIds=includedResearch.map(packet=>recordPreparedResearchContext(db,packet,{taskId,transport:options.transport??"internal"}).receipt.id);
    persistContextPacket(db,receipt,markdown,options.retainForSeconds??0);
  })();
  return {freshness:{briefing:!briefing?"missing":briefing.staleAt?"stale":"current",research:research.map(packet=>({caseId:packet.caseId,asOfDate:packet.asOfDate}))},schemaVersion:1, scope, generatedAt:receipt.createdAt, markdown, receipt};
}
