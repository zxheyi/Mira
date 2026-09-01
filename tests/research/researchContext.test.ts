import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { createProject } from "../../src/projects/projectStore.js";
import { verifyEvidence } from "../../src/research/evidenceVerification.js";
import { prepareResearchContext } from "../../src/research/researchContext.js";
import { authorizeResearch, markResearchEvidenceStale, reviewResearchClaim, submitResearchPacket } from "../../src/research/researchService.js";
import { rebuildProjectBriefing } from "../../src/briefing/projectBriefingStore.js";

let db: Database.Database | undefined;
afterEach(() => { db?.close(); db = undefined; });

describe("Research Context", () => {
  test("projects only active approved Claims with current verified supporting Evidence", () => {
    db = openDatabase(":memory:");
    migrate(db);
    const project = createProject(db, {name:"Context",rootPath:"/research-context"});
    const snapshot = submitResearchPacket(db, project.id, {
      case:{title:"Quarter",question:"What changed?",asOfDate:"2026-09-01"},
      snapshots:[
        {key:"S1",canonicalUri:"https://example.test/q3",sourceTitle:"Q3 filing",publishedAt:"2026-08-01",accessedAt:"2026-09-01",mediaType:"text/plain",content:"Page 12\nRevenue grew 10%."},
        {key:"S2",canonicalUri:"https://example.test/outlook",sourceTitle:"Outlook",publishedAt:"2026-08-01",accessedAt:"2026-09-01",mediaType:"text/plain",content:"Slide 3\nGrowth may slow."}
      ],
      evidence:[
        {key:"E1",snapshotKey:"S1",sourceType:"regulatory_filing",sourceUri:"https://example.test/q3",sourceTitle:"Q3 filing",locator:"Page 12",excerpt:"Revenue grew 10%.",publishedAt:"2026-08-01",accessedAt:"2026-09-01"},
        {key:"E2",snapshotKey:"S2",sourceType:"company_material",sourceUri:"https://example.test/outlook",sourceTitle:"Outlook",locator:"Slide 3",excerpt:"Growth may slow.",publishedAt:"2026-08-01",accessedAt:"2026-09-01"}
      ],
      claims:[{key:"C1",statement:"Revenue growth was positive.",evidenceStatus:"supported",confidence:0.9,thesisImpact:"watch",invalidationConditions:"A later filing restates revenue.",links:[
        {evidenceKey:"E1",relation:"supports",rationale:"Direct observation."},
        {evidenceKey:"E2",relation:"contradicts",rationale:"Forward outlook is weaker."}
      ]}]
    });
    const authority = authorizeResearch(db, project.id, {actor:"reviewer",reason:"Verified public filing"});
    const supporting = snapshot.evidence.find((item) => item.sourceUri.endsWith("/q3"))!;
    const contradicting = snapshot.evidence.find((item) => item.sourceUri.endsWith("/outlook"))!;

    expect(prepareResearchContext(db, project.id, snapshot.researchCase.id).claimIds).toEqual([]);
    verifyEvidence(db, project.id, snapshot.researchCase.id, supporting.id);
    expect(prepareResearchContext(db, project.id, snapshot.researchCase.id).claimIds).toEqual([]);

    reviewResearchClaim(db, project.id, snapshot.claims[0].id, "approve", "Reviewed.", authority, [{
      evidenceId:contradicting.id,
      disposition:"requires_followup",rationale:"Track the weaker outlook."
    }]);
    const packet = prepareResearchContext(db, project.id, snapshot.researchCase.id);
    expect(packet.claimIds).toEqual([snapshot.claims[0].id]);
    expect(packet.evidenceIds).toEqual([supporting.id]);
    expect(packet.snapshotIds).toEqual([supporting.snapshotId]);
    expect(packet.markdown).toContain("Revenue growth was positive.");
    expect(packet.markdown).toContain(`[snapshot:${supporting.snapshotId}]`);
    expect(packet.markdown).not.toContain("Revenue grew 10%.");
    expect(packet.markdown).toContain("omitted from evidence context; verification is pending");
    expect(packet.markdown).toContain("Contradiction disposition: requires_followup");
    const briefing = rebuildProjectBriefing(db, project.id);
    expect(briefing.markdown).toContain("## Investment Research");
    expect(briefing.markdown).toContain(`[research-case:${snapshot.researchCase.id}]`);
    expect(briefing.markdown).toContain("claims 1 approved/0 pending · evidence 1/2 verified");

    markResearchEvidenceStale(db, project.id, supporting.id, "New filing available.", authority);
    expect(prepareResearchContext(db, project.id, snapshot.researchCase.id).claimIds).toEqual([]);
  });
});
