import {expect,test} from 'vitest';
import {openDatabase} from '../../src/db/client.js';
import {migrate} from '../../src/db/schema.js';
import {createProject} from '../../src/projects/projectStore.js';
import {saveThread} from '../../src/threads/threadStore.js';
import {submitMemoryCandidates,reviewMemoryCandidate,listMemoryCandidates} from '../../src/distill/candidateService.js';

for(const [heading,expected] of [['### User','accepted'],['### Assistant','pending_review'],['### Tool','pending_review'],['## Summary','pending_review']] as const) test(`stored ${heading} controls attribution, not extractor confidence`,()=>{
 const db=openDatabase(':memory:');migrate(db);
 try{
  const project=createProject(db,{name:'Origin',rootPath:'/origin'});
  const content='The project uses SQLite.';
  const thread=saveThread(db,{id:"thread-origin",projectId:project.id,title:'Thread',source:'codex',rawFormat:'markdown',rawText:`## Turn host-1\n${heading}\n${content}`});
  const [result]=submitMemoryCandidates(db,{projectId:project.id,threadId:thread.id,sourceAgent:'user',extractionMethod:'agent',candidates:[{title:'Storage',kind:'fact',content,evidence:content,confidence:1,importance:0.5}]});
  expect(result.outcome).toBe(expected);
  expect(result.candidate.provenance?.sourceTurnRef).toBe('host-1');
  const originalReasons=result.candidate.provenance?.policyReasons;
  if(expected==='pending_review') {
   const reviewed=reviewMemoryCandidate(db,project.id,result.candidate.id,'accept','Explicit review');
   expect(reviewed.candidate.acceptanceMode).toBe('reviewed');
   expect(reviewed.candidate.provenance?.policyReasons).toEqual(originalReasons);
   expect(reviewed.candidate.reviewReason).toBe('Explicit review');
  }else expect(result.candidate.acceptanceMode).toBe('automatic');
  expect(listMemoryCandidates(db,project.id,undefined,1,1)).toEqual([]);
 }finally{db.close();}
});
