import {MiraError} from '../runtime/errors.js';
export type ContextBudget={maxCharacters?:number;maxTokens?:number};
export const DEFAULT_CONTEXT_CHARACTERS=12_000;
export function normalizeBudget(input:ContextBudget):Required<ContextBudget> {
 const maxCharacters=input.maxCharacters??DEFAULT_CONTEXT_CHARACTERS;
 const maxTokens=input.maxTokens??36_000;
 for(const [name,value,max] of [['maxCharacters',maxCharacters,1_000_000],['maxTokens',maxTokens,250_000]] as const) {
  if(!Number.isInteger(value)||value<1||value>max) throw new MiraError('INVALID_BUDGET',`${name} must be an integer between 1 and ${max}`,'Provide a supported positive budget');
 }
 return {maxCharacters,maxTokens};
}
export function withinBudget(text:string,budget:Required<ContextBudget>):boolean {
 return text.length<=budget.maxCharacters && Buffer.byteLength(text,'utf8')<=budget.maxTokens;
}
export type ContextSelection={type:'working_memory'|'memory'|'briefing'|'claim';id:string;selected:boolean;reasons:string[];contentHash?:string;caseId?:string;section?:string;version?:string;rank?:number|null;cost?:{characters:number;tokenUpperBound:number}|null;sources?:Array<{type:string;id:string;version:string;contentHash:string}>};
