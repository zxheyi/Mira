import {expect, test} from 'vitest';
import {openDatabase} from '../../src/db/client.js';
import {migrate} from '../../src/db/schema.js';
import {createProject} from '../../src/projects/projectStore.js';
import {submitResearchPacket,authorizeResearch,reviewResearchClaim} from '../../src/research/researchService.js';
import {verifyEvidence} from '../../src/research/evidenceVerification.js';
import {prepareResearchContext,listResearchBriefingSummaries} from '../../src/research/researchContext.js';

for (const validThrough of ['2026-08-15','2026-09-01']) test(`approval and recall agree at case-time boundary ${validThrough}`, () => {
  const db=openDatabase(':memory:'); migrate(db);
  try {
    const project=createProject(db,{name:'Eligibility',rootPath:'/eligibility'});
    const packet=submitResearchPacket(db,project.id,{
      case:{title:'Boundary',question:'Is all support eligible?',asOfDate:'2026-09-01'},
      snapshots:[{key:'S',canonicalUri:'https://example.test/source',sourceTitle:'Source',publishedAt:'2026-08-01',accessedAt:'2026-09-01',mediaType:'text/plain',content:'Page 1\nObservation.'}],
      evidence:['2026-09-30',validThrough].map((date,i)=>({key:`E${i}`,snapshotKey:'S',sourceType:'other' as const,sourceUri:'https://example.test/source',sourceTitle:'Source',locator:'Page 1',excerpt:'Observation.',publishedAt:'2026-08-01',accessedAt:'2026-09-01',validThrough:date})),
      claims:[{key:'C',statement:'Conclusion.',evidenceStatus:'supported',confidence:0.9,thesisImpact:'none',invalidationConditions:'New observation.',links:[0,1].map(i=>({evidenceKey:`E${i}`,relation:'supports' as const,rationale:'Support.'}))}]
    });
    for(const item of packet.evidence) verifyEvidence(db,project.id,packet.researchCase.id,item.id);
    const approve=()=>reviewResearchClaim(db,project.id,packet.claims[0].id,'approve','Reviewed',authorizeResearch(db,project.id,{actor:'test',reason:'Reviewed'}));
    if(validThrough < '2026-09-01') {
      expect(approve).toThrow(/evidence_expired/);
      // Legacy approved records must be filtered on read without rewriting audit history.
      db.prepare("update research_claims set review_status='approved' where id=?").run(packet.claims[0].id);
      expect(prepareResearchContext(db,project.id,packet.researchCase.id).claimIds).toEqual([]);
      expect(listResearchBriefingSummaries(db,project.id)[0]).toMatchObject({approvedClaimCount:1,eligibleClaimCount:0});
    } else {
      approve();
      expect(prepareResearchContext(db,project.id,packet.researchCase.id).evidenceIds).toHaveLength(2);
    }
  } finally {db.close();}
});

test('research rendering never truncates a Claim or its invalidation conditions',()=>{
 const db=openDatabase(':memory:');migrate(db);
 try {
  const project=createProject(db,{name:'Budget',rootPath:'/budget'});
  const packet=submitResearchPacket(db,project.id,{
   case:{title:'Budget',question:'A bounded answer?',asOfDate:'2026-09-01'},
   snapshots:[{key:'S',canonicalUri:'https://example.test/s',sourceTitle:'S',accessedAt:'2026-09-01',mediaType:'text/plain',content:'Page 1\nObservation.'}],
   evidence:[{key:'E',snapshotKey:'S',sourceType:'other',sourceUri:'https://example.test/s',sourceTitle:'S',locator:'Page 1',excerpt:'Observation.',accessedAt:'2026-09-01'}],
   claims:[{key:'C',statement:'A bounded conclusion.',evidenceStatus:'supported',confidence:0.9,thesisImpact:'none',invalidationConditions:'限'.repeat(500),links:[{evidenceKey:'E',relation:'supports',rationale:'Support'}]}]
  });
  verifyEvidence(db,project.id,packet.researchCase.id,packet.evidence[0].id);
  reviewResearchClaim(db,project.id,packet.claims[0].id,'approve','Reviewed',authorizeResearch(db,project.id,{actor:'test',reason:'Reviewed'}));
  const result=prepareResearchContext(db,project.id,packet.researchCase.id,{maxTokens:800});
  expect(result.tokenUpperBound).toBeLessThanOrEqual(800);
  expect(result.claimIds).toEqual([]);
  expect(result.markdown).not.toContain('A bounded conclusion.');
  expect(result.selections).toContainEqual(expect.objectContaining({id:packet.claims[0].id,selected:false,reasons:['budget']}));
 }finally{db.close();}
});
