import {createHash} from 'node:crypto';
export type CandidateProvenance={
 role:'user'|'assistant'|'tool'|'unknown';origin:'verbatim'|'inferred'|'unknown';
 sourceTurnRef?:string;start?:number;end?:number;sourceHash:string;
 policyVersion:string;policyReasons:string[];conflictCheck:'same_kind_and_title';confidenceMeaning:'extractor_self_report';
};
/** Locate a unique excerpt in stored transcript roles; caller-supplied role labels are never accepted. */
export function locateCandidateEvidence(raw:string,evidence:string,content:string):CandidateProvenance {
 const start=raw.indexOf(evidence);
 const unique=start>=0 && raw.indexOf(evidence,start+1)<0;
 let role:CandidateProvenance['role']='unknown';let sourceTurnRef:string|undefined;
 if(unique) {
  const before=raw.slice(0,start);
  let fenced=false;
  for(const line of before.split("\n")) {
   if(/^\s*(```|~~~)/.test(line)) {fenced=!fenced;continue;}
   if(fenced) continue;
   const heading=line.match(/^#{2,3}\s+(User|Assistant|Tool|System)\s*$/i);
   if(heading) role=heading[1].toLowerCase()==="system"?"unknown":heading[1].toLowerCase() as CandidateProvenance['role'];
   else if(/^#{1,3}\s/.test(line)) role="unknown";
  }
  if(fenced || /^#{2,3}\s+(?:User|Assistant|Tool|System|Turn\b)/mi.test(evidence)) role="unknown";
  sourceTurnRef=[...before.matchAll(/^## Turn (.+)$/gm)].at(-1)?.[1];
  if(role==='unknown') {
   const lineStart=raw.lastIndexOf('\n',start)+1;const end=raw.indexOf('\n',start);
   try {const message=JSON.parse(raw.slice(lineStart,end<0?undefined:end));
    const body=typeof message.content==='string'?message.content:typeof message.message?.content==='string'?message.message.content:undefined;
    const messageRole=message.role??message.message?.role;
    if(body?.includes(evidence)&&['user','assistant','tool'].includes(messageRole)) role=messageRole;
   }catch{/* Unstructured summaries intentionally remain unattributed. */}
  }
 }
 const normalize=(text:string)=>text.trim().replace(/\s+/g,' ');
 return {role,origin:normalize(evidence).includes(normalize(content))?'verbatim':'inferred',
  ...(unique?{start,end:start+evidence.length}:{}),...(sourceTurnRef?{sourceTurnRef}:{}),
  sourceHash:createHash('sha256').update(raw).digest('hex'),policyVersion:'candidate-v2',policyReasons:[],conflictCheck:'same_kind_and_title',confidenceMeaning:'extractor_self_report'};
}
