import {createHash} from 'node:crypto';
import type {ContextSelection,ContextBudget} from './contextBudget.js';

export const selectionHash=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const textCost=(text:string)=>({characters:text.length,tokenUpperBound:Buffer.byteLength(text,'utf8')});
export type SelectionManifest={
 schemaVersion:1;policyVersion:'selection-v1';inputHash:string;outputHash:string;
 inputs:Record<string,unknown>;budget:Required<ContextBudget>;cost:ReturnType<typeof textCost>;
 overheadCost:ReturnType<typeof textCost>;entryTruncation:'none';
 selections:ContextSelection[];
};
export function createSelectionManifest(inputs:Record<string,unknown>,selections:ContextSelection[],budget:Required<ContextBudget>,markdown:string):SelectionManifest {
 const cost=textCost(markdown);
 const selected=selections.filter(item=>item.selected);
 const body=selected.reduce((total,item)=>({characters:total.characters+(item.cost?.characters??0),tokenUpperBound:total.tokenUpperBound+(item.cost?.tokenUpperBound??0)}),{characters:0,tokenUpperBound:0});
 return {schemaVersion:1,policyVersion:'selection-v1',inputHash:selectionHash({inputs,selections,budget}),inputs,selections,budget,cost,
  outputHash:createHash('sha256').update(markdown).digest('hex'),entryTruncation:'none',
  overheadCost:{characters:cost.characters-body.characters,tokenUpperBound:cost.tokenUpperBound-body.tokenUpperBound}};
}
export function explainSelection(manifest:SelectionManifest,id:string) {
 const matches=manifest.selections.filter(item=>item.id===id);
 return matches.length?{state:'evaluated' as const,selections:matches}:{state:'not_in_candidate_pool' as const,reason:'Not evaluated by this bounded retrieval; no budget exclusion can be inferred'};
}
