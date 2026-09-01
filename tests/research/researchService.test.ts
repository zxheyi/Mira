import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { createProject } from "../../src/projects/projectStore.js";
import { listMemoriesForProject } from "../../src/memory/memoryStore.js";
import {
  authorizeResearch,
  getResearchCaseSnapshot,
  markResearchEvidenceStale,
  markResearchSourceSnapshotStale,
  reviewResearchClaim,
  reviseResearchClaim,
  submitResearchPacket
} from "../../src/research/researchService.js";
import { verifyEvidence } from "../../src/research/evidenceVerification.js";

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function packet() {
  return {
    case: { title: "Quarterly review", question: "What changed?", asOfDate: "2026-09-01" },
    snapshots: [
      {
        key: "S1", canonicalUri: "https://example.test/q3", sourceTitle: "Q3 filing",
        publishedAt: "2026-08-01", accessedAt: "2026-09-01", mediaType: "text/plain",
        content: "p. 12\nRevenue increased by ten percent."
      },
      {
        key: "S2", canonicalUri: "https://example.test/outlook", sourceTitle: "Outlook",
        publishedAt: "2026-08-01", accessedAt: "2026-09-01", mediaType: "text/plain",
        content: "slide 4\nManagement expects slower growth."
      }
    ],
    evidence: [
      {
        key: "E1", snapshotKey: "S1", sourceType: "regulatory_filing" as const,
        sourceUri: "https://example.test/q3", sourceTitle: "Q3 filing", locator: "p. 12",
        excerpt: "Revenue increased by ten percent.", publishedAt: "2026-08-01",
        accessedAt: "2026-09-01", validThrough: "2026-09-30"
      },
      {
        key: "E2", snapshotKey: "S2", sourceType: "company_material" as const,
        sourceUri: "https://example.test/outlook", sourceTitle: "Outlook", locator: "slide 4",
        excerpt: "Management expects slower growth.", publishedAt: "2026-08-01",
        accessedAt: "2026-09-01"
      }
    ],
    claims: [{
      key: "C1", statement: "Reported revenue growth remains positive.",
      evidenceStatus: "supported" as const, confidence: 0.8, thesisImpact: "watch" as const,
      invalidationConditions: "A later filing reports negative growth.",
      links: [
        { evidenceKey: "E1", relation: "supports" as const, rationale: "Direct reported observation." },
        { evidenceKey: "E2", relation: "contradicts" as const, rationale: "Forward outlook is weaker." }
      ]
    }]
  };
}

describe("research governance", () => {
  test("submits a validated draft atomically without creating Memory", () => {
    db = openDatabase(":memory:");
    migrate(db);
    const project = createProject(db, { name: "Draft", rootPath: "/research-draft" });

    const snapshot = submitResearchPacket(db, project.id, packet(), "agent:extractor");
    expect(snapshot.researchCase.status).toBe("draft");
    expect(snapshot.evidence).toHaveLength(2);
    expect(snapshot.claims[0]).toMatchObject({
      reviewStatus: "pending",
      links: [
        expect.objectContaining({ relation: "supports" }),
        expect.objectContaining({ relation: "contradicts" })
      ]
    });
    expect(snapshot.events[0]).toMatchObject({
      eventType: "packet_submitted",
      receipt: { operation: "submitResearchPacket", actor: "agent:extractor", outcome: "created" }
    });
    expect(listMemoriesForProject(db, project.id)).toEqual([]);

    expect(() => submitResearchPacket(db!, project.id, {
      ...packet(),
      evidence: [packet().evidence[0], packet().evidence[0]]
    }, "agent")).toThrow(/unique/i);
    expect(() => submitResearchPacket(db!, project.id, {
      ...packet(),
      case: { ...packet().case, asOfDate: "2026-02-31" }
    }, "agent")).toThrow(/calendar date/i);
    expect(db.prepare("select count(*) from research_cases").pluck().get()).toBe(1);
  });

  test("requires project authority and a current supporting source before approval", () => {
    db = openDatabase(":memory:");
    migrate(db);
    const project = createProject(db, { name: "Gate", rootPath: "/research-gate" });
    const other = createProject(db, { name: "Other", rootPath: "/research-other" });
    const snapshot = submitResearchPacket(db, project.id, {
      ...packet(),
      case: { ...packet().case, asOfDate: "2026-10-01" }
    });
    const claimId = snapshot.claims[0].id;
    const authority = authorizeResearch(db, project.id, { actor: "reviewer", reason: "Checked sources" });
    const otherAuthority = authorizeResearch(db, other.id, { actor: "other", reason: "Wrong project" });

    expect(() => reviewResearchClaim(db!, project.id, claimId, "approve", "Reviewed")).toThrow(/authority/i);
    expect(() => reviewResearchClaim(db!, project.id, claimId, "approve", "Reviewed", {} as never)).toThrow(/authority/i);
    expect(() => reviewResearchClaim(db!, project.id, claimId, "approve", "Reviewed", otherAuthority)).toThrow(/authority/i);
    expect(() => reviewResearchClaim(db!, project.id, claimId, "approve", "Reviewed", authority)).toThrow(/current.*support/i);

    const rejected = reviewResearchClaim(db, project.id, claimId, "reject", "Expired primary source", authority);
    expect(rejected.researchCase.status).toBe("in_review");
    expect(rejected.claims[0].reviewStatus).toBe("rejected");
    expect(rejected.events.at(-1)).toMatchObject({
      eventType: "claim_reviewed",
      receipt: expect.objectContaining({
        actor: "reviewer", authorityReason: "Checked sources",
        decision: "reject", reason: "Expired primary source"
      })
    });
  });

  test("propagates stale evidence and creates an immutable claim successor", () => {
    db = openDatabase(":memory:");
    migrate(db);
    const project = createProject(db, { name: "Lifecycle", rootPath: "/research-lifecycle" });
    const authority = authorizeResearch(db, project.id, { actor: "reviewer", reason: "Source review" });
    let snapshot = submitResearchPacket(db, project.id, packet());
    const predecessor = snapshot.claims[0];
    const filingEvidence = snapshot.evidence.find((item) => item.sourceUri.endsWith("/q3"))!;
    const outlookEvidence = snapshot.evidence.find((item) => item.sourceUri.endsWith("/outlook"))!;

    expect(verifyEvidence(db, project.id, snapshot.researchCase.id, filingEvidence.id))
      .toMatchObject({status: "verified"});

    expect(() => reviewResearchClaim(
      db!, project.id, predecessor.id, "approve", "Counter-evidence reviewed.", authority
    )).toThrow(/Contradiction Disposition/i);
    snapshot = reviewResearchClaim(
      db,
      project.id,
      predecessor.id,
      "approve",
      "Primary filing is current; outlook is retained as counter-evidence.",
      authority,
      [{evidenceId: outlookEvidence.id, disposition: "requires_followup", rationale: "Track the weaker forward outlook."}]
    );
    expect(snapshot.researchCase.status).toBe("completed");
    expect(snapshot.claims[0].reviewStatus).toBe("approved");

    snapshot = markResearchEvidenceStale(db, project.id, filingEvidence.id, "Superseded by a later filing.", authority);
    expect(snapshot.researchCase.status).toBe("in_review");
    expect(snapshot.evidence.find((item) => item.id === filingEvidence.id)?.state).toBe("stale");
    expect(snapshot.claims[0].reviewStatus).toBe("changes_requested");
    expect(snapshot.events.at(-1)?.receipt).toMatchObject({ affectedClaimIds: [predecessor.id] });

    snapshot = reviseResearchClaim(db, project.id, predecessor.id, {
      statement: "Forward growth is expected to slow.",
      evidenceStatus: "supported",
      confidence: 0.7,
      thesisImpact: "weaken",
      invalidationConditions: "Management raises the next reported outlook.",
      links: [{
        evidenceId: outlookEvidence.id,
        relation: "supports",
        rationale: "The outlook directly supports the revised claim."
      }]
    }, "Reframed around the still-current outlook.", authority);

    const oldClaim = snapshot.claims.find((claim) => claim.id === predecessor.id);
    const successor = snapshot.claims.find((claim) => claim.supersedesClaimId === predecessor.id);
    expect(oldClaim).toMatchObject({ statement: predecessor.statement, status: "superseded" });
    expect(successor).toMatchObject({
      statement: "Forward growth is expected to slow.", status: "active", reviewStatus: "pending",
      links: [expect.objectContaining({ evidenceId: outlookEvidence.id })]
    });
  });

  test("rolls back a review when its audit event cannot be stored", () => {
    db = openDatabase(":memory:");
    migrate(db);
    const project = createProject(db, { name: "Audit", rootPath: "/research-audit" });
    const authority = authorizeResearch(db, project.id, { actor: "reviewer", reason: "Explicit review" });
    const snapshot = submitResearchPacket(db, project.id, packet());
    const claimId = snapshot.claims[0].id;
    const filingEvidence = snapshot.evidence.find((item) => item.sourceUri.endsWith("/q3"))!;
    const outlookEvidence = snapshot.evidence.find((item) => item.sourceUri.endsWith("/outlook"))!;
    expect(verifyEvidence(db, project.id, snapshot.researchCase.id, filingEvidence.id))
      .toMatchObject({status: "verified"});
    db.exec("create trigger fail_research_audit before insert on research_events begin select raise(abort, 'audit unavailable'); end;");

    expect(() => reviewResearchClaim(
      db!, project.id, claimId, "approve", "Reviewed.", authority,
      [{evidenceId: outlookEvidence.id, disposition: "accepted_risk", rationale: "Authorized test disposition."}]
    ))
      .toThrow("audit unavailable");
    expect(getResearchCaseSnapshot(db, project.id, snapshot.researchCase.id).claims[0].reviewStatus)
      .toBe("pending");
  });

  test("propagates Source Snapshot staleness through Evidence, Verification and approved Claims", () => {
    db = openDatabase(":memory:");
    migrate(db);
    const project = createProject(db, {name:"Snapshot lifecycle",rootPath:"/snapshot-lifecycle"});
    const authority = authorizeResearch(db, project.id, {actor:"reviewer",reason:"Source governance"});
    const submitted = submitResearchPacket(db, project.id, {
      ...packet(),
      claims:[{...packet().claims[0],links:[packet().claims[0].links[0]]}]
    });
    const filing = submitted.evidence.find((item) => item.sourceUri.endsWith("/q3"))!;
    verifyEvidence(db, project.id, submitted.researchCase.id, filing.id);
    reviewResearchClaim(db, project.id, submitted.claims[0].id, "approve", "Verified.", authority);

    const affected = markResearchSourceSnapshotStale(
      db, project.id, filing.snapshotId!, "A successor filing is available.", authority
    );
    expect(affected).toHaveLength(1);
    expect(affected[0]).toMatchObject({
      researchCase:{status:"in_review"},
      evidence:expect.arrayContaining([expect.objectContaining({id:filing.id,state:"stale"})]),
      claims:expect.arrayContaining([expect.objectContaining({id:submitted.claims[0].id,reviewStatus:"changes_requested"})])
    });
    expect(affected[0].verifications.find((item) => item.evidenceId === filing.id)?.status).toBe("stale");
    expect(affected[0].snapshots.find((item) => item.id === filing.snapshotId)?.state).toBe("stale");
  });
});
