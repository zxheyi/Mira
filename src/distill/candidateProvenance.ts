import type {TranscriptSpan} from "../lifecycle/sessionTranscript.js";
import {createHash} from 'node:crypto';
export type CandidateProvenance={
 role:'user'|'assistant'|'tool'|'unknown';origin:'verbatim'|'inferred'|'unknown';
 sourceTurnRef?:string;start?:number;end?:number;sourceHash:string;
 policyVersion:string;policyReasons:string[];conflictCheck:'same_kind_and_title';confidenceMeaning:'extractor_self_report';
};
/** Locate a unique excerpt in stored transcript roles; caller-supplied role labels are never accepted. */
export function locateCandidateEvidence(raw:string,evidence:string,content:string, spans:TranscriptSpan[] = []):CandidateProvenance {
 const start=raw.indexOf(evidence);
 const unique=start>=0 && raw.indexOf(evidence,start+1)<0;
 let role:CandidateProvenance['role']='unknown';let sourceTurnRef:string|undefined;
 if(unique) {
  const span=spans.find(item=>start>=item.start && start+evidence.length<=item.end);
  if(span) {role=span.role;sourceTurnRef=span.sourceTurnRef;}
  // Thread text and format can be supplied by an agent. Neither Markdown
  // headings nor JSON role fields grant authority without persisted spans.
 }
 const normalize=(text:string)=>text.trim().replace(/\s+/g,' ');
 return {role,origin:normalize(evidence).includes(normalize(content))?'verbatim':'inferred',
  ...(unique?{start,end:start+evidence.length}:{}),...(sourceTurnRef?{sourceTurnRef}:{}),
  sourceHash:createHash('sha256').update(raw).digest('hex'),policyVersion:'candidate-v3',policyReasons:[],conflictCheck:'same_kind_and_title',confidenceMeaning:'extractor_self_report'};
}
