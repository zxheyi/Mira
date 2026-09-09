import {expect,test} from 'vitest';
import {openDatabase} from '../../src/db/client.js';
import {migrate} from '../../src/db/schema.js';
import {createProject} from '../../src/projects/projectStore.js';
import {submitResearchPacket,authorizeResearch,reviewResearchClaim,markResearchEvidenceStale} from '../../src/research/researchService.js';
import {verifyEvidence} from '../../src/research/evidenceVerification.js';
import {getResearchCaseSnapshot} from '../../src/research/researchStore.js';
import {callMiraTool} from '../../src/mcp/server.js';

test('semantic review is explicit, version bound and separate from source integrity',()=>{
 const db=openDatabase(':memory:');migrate(db);
 try {
  const project=createProject(db,{name:'Semantics',rootPath:'/semantics'});
  const policy={actor:'host:reviewer',reason:'Explicit review',scopes:['research.review' as const,'research.mutate' as const]};
  const authority=authorizeResearch(db,project.id,policy);
  const packet=submitResearchPacket(db,project.id,{
   case:{title:'Revenue',question:'Revenue change?',asOfDate:'2026-09-01'},
   snapshots:[{key:'S',canonicalUri:'https://example.test/revenue',sourceTitle:'Report',accessedAt:'2026-09-01',mediaType:'text/plain',content:'Page 1\nRevenue grew 10% in 2025.'}],
   evidence:[{key:'E',snapshotKey:'S',sourceType:'other',sourceUri:'https://example.test/revenue',sourceTitle:'Report',locator:'Page 1',excerpt:'Revenue grew 10% in 2025.',accessedAt:'2026-09-01'}],
   claims:[{key:'C',statement:'Revenue grew 10% in 2025.',evidenceStatus:'supported',confidence:0.9,thesisImpact:'none',invalidationConditions:'Restated results.',links:[{evidenceKey:'E',relation:'supports',rationale:'Same year and measure.'}]}]
  });
  const claimId=packet.claims[0].id;
  expect(verifyEvidence(db,project.id,packet.researchCase.id,packet.evidence[0].id)).toMatchObject({status:'verified',semanticEntailment:'not_evaluated'});
  expect(getResearchCaseSnapshot(db,project.id,packet.researchCase.id).claims[0].semanticReview?.state).toBe('not_recorded');
  const assessment={reportedMethod:'human' as const,entailment:'supported' as const,scope:'matched' as const,timeRange:'matched' as const,units:'matched' as const};
  expect(()=>reviewResearchClaim(db,project.id,claimId,'approve','Check scope',authority,[],{...assessment,scope:'mismatched'})).toThrow(/semantic/);
  const reviewed=callMiraTool({db,dbPath:':memory:',projectRoot:'/semantics',confirmationPolicy:policy},'review_research_claim',{claimId,decision:'approve',reason:'Checked year and numeric measure',semanticAssessment:assessment}) as ReturnType<typeof getResearchCaseSnapshot>;
  expect(reviewed.claims[0].semanticReview).toMatchObject({state:'current',actor:'host:reviewer',assessment});
  markResearchEvidenceStale(db,project.id,packet.evidence[0].id,'Source updated',authority);
  expect(getResearchCaseSnapshot(db,project.id,packet.researchCase.id).claims[0].semanticReview?.state).toBe('stale');
  expect(reviewed.claims[0].semanticReview?.state).toBe('current');
 }finally{db.close();}
});
