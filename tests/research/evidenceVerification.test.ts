import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { createProject } from "../../src/projects/projectStore.js";
import {
  registerSourceSnapshot,
  verifyEvidence
} from "../../src/research/evidenceVerification.js";
import {
  authorizeResearch,
  reviewResearchClaim,
  submitResearchPacket
} from "../../src/research/researchService.js";

let db: Database.Database | undefined;
afterEach(() => { db?.close(); db = undefined; });

function verifiedPacket() {
  return {
    case: {title: "Snapshot gate", question: "What changed?", asOfDate: "2026-09-01"},
    snapshots: [{
      key: "S1",
      canonicalUri: "https://example.test/q3",
      sourceTitle: "Q3 filing",
      publishedAt: "2026-08-01",
      accessedAt: "2026-09-01",
      mediaType: "text/plain",
      content: "Page 12\nRevenue increased by ten percent."
    }],
    evidence: [{
      key: "E1",
      snapshotKey: "S1",
      sourceType: "regulatory_filing" as const,
      sourceUri: "https://example.test/q3",
      sourceTitle: "Q3 filing",
      locator: "Page 12",
      excerpt: "Revenue increased by ten percent.",
      publishedAt: "2026-08-01",
      accessedAt: "2026-09-01",
      validThrough: "2026-09-30"
    }],
    claims: [{
      key: "C1",
      statement: "Reported revenue growth remains positive.",
      evidenceStatus: "supported" as const,
      confidence: 0.8,
      thesisImpact: "watch" as const,
      invalidationConditions: "A later filing reports negative growth.",
      links: [{evidenceKey: "E1", relation: "supports" as const, rationale: "Direct filing observation."}]
    }]
  };
}

describe("Evidence Verification", () => {
  test("registers immutable Source Snapshots idempotently and verifies a bound Evidence item", () => {
    db = openDatabase(":memory:");
    migrate(db);
    const project = createProject(db, {name: "Verifier", rootPath: "/research-verifier"});
    const input = verifiedPacket().snapshots[0];
    const first = registerSourceSnapshot(db, project.id, input);
    const duplicate = registerSourceSnapshot(db, project.id, input);
    const successor = registerSourceSnapshot(db, project.id, {...input, content: input.content + "\nUpdated."});
    expect(duplicate.id).toBe(first.id);
    expect(successor.id).not.toBe(first.id);
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const packet = submitResearchPacket(db, project.id, verifiedPacket());
    expect(packet.snapshots).toEqual([expect.objectContaining({id: first.id, state: "current"})]);
    expect(packet.verifications).toEqual([
      expect.objectContaining({evidenceId: packet.evidence[0].id, snapshotId: first.id, status: "pending"})
    ]);

    const authority = authorizeResearch(db, project.id, {actor: "reviewer", reason: "Checked source snapshot"});
    expect(() => reviewResearchClaim(
      db!, project.id, packet.claims[0].id, "approve", "Reviewed", authority
    )).toThrow(/verified/i);

    const verification = verifyEvidence(db, project.id, packet.researchCase.id, packet.evidence[0].id);
    expect(verification).toMatchObject({
      status: "verified",
      checks: {
        integrity: true,
        sourceBinding: true,
        locator: true,
        excerpt: true,
        publication: true,
        freshness: true
      }
    });
    expect(JSON.stringify(verification.receipt)).not.toContain(input.content);
    expect(reviewResearchClaim(
      db, project.id, packet.claims[0].id, "approve", "Snapshot verified.", authority
    ).claims[0].reviewStatus).toBe("approved");
  });

  test("fails structural verification when Snapshot content or as-of checks disagree", () => {
    db = openDatabase(":memory:");
    migrate(db);
    const project = createProject(db, {name: "Failed verifier", rootPath: "/research-verifier-failed"});
    const input = verifiedPacket();
    input.case.asOfDate = "2026-07-01";
    input.snapshots[0].content = "A different section with no quoted observation.";
    const packet = submitResearchPacket(db, project.id, input);

    const verification = verifyEvidence(db, project.id, packet.researchCase.id, packet.evidence[0].id);
    expect(verification.status).toBe("failed");
    expect(verification.checks).toMatchObject({locator: false, excerpt: false, publication: false});
    expect(verification.receipt.checkCodes).toEqual(expect.arrayContaining([
      "locator_not_found", "excerpt_not_found", "published_after_case_as_of"
    ]));
  });
});
