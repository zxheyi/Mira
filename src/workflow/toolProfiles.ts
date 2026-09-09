import {MiraError} from '../runtime/errors.js';
export const TOOL_PROFILES=['core','research','admin','full'] as const;
export type ToolProfile=typeof TOOL_PROFILES[number];
const core=new Set(['get_runtime_status','before_turn','after_turn','prepare_context','search_memory','set_working_memory','list_working_memory','clear_working_memory','save_thread','submit_memory_candidates','get_workflow_progress','get_context_replay']);
export function selectToolProfile<T extends string>(names:readonly T[],profile:ToolProfile='full'):T[] {
 if(!(TOOL_PROFILES as readonly string[]).includes(profile)) throw new MiraError('INVALID_PROFILE','Unknown MCP tool profile','Choose core, research, admin, or full');
 return names.filter(name=>profile==='full'||profile==='admin'||core.has(name)||(profile==='research'&&name.includes('research')));
}
