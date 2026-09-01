import { afterEach, describe, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { createProject } from "../../src/projects/projectStore.js";
import {
  createResearchPacketRecords,
  getResearchCaseSnapshot,
  listResearchCases
} from "../../src/research/researchStore.js";

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

describe("research store", () => {
  test("round-trips a scoped packet and its append-only receipt", () => {
    db = openDatabase(":memory:");
    migrate(db);
    const project = createProject(db, { name: "Research", rootPath: "/research-store" });
    const createdAt = "2026-09-01T00:00:00.000Z";

    createResearchPacketRecords(db, {
      researchCase: {
        id: "case-1", projectId: project.id, title: "Case", question: "What changed?",
        asOfDate: "2026-09-01", status: "draft", createdAt, updatedAt: createdAt
      },
      evidence: [{
        id: "evidence-1", projectId: project.id, caseId: "case-1",
        sourceType: "regulatory_filing", sourceUri: "https://example.test/filing",
        sourceTitle: "Quarterly filing", locator: "p. 12", excerpt: "Reported revenue increased.",
        publishedAt: "2026-08-01", accessedAt: "2026-09-01", validThrough: "2026-09-30",
        contentHash: "hash-1", state: "current", createdAt, updatedAt: createdAt
      }],
      claims: [{
        id: "claim-1", projectId: project.id, caseId: "case-1",
        statement: "Revenue increased.", evidenceStatus: "supported", reviewStatus: "pending",
        confidence: 0.8, thesisImpact: "watch", invalidationConditions: "Next filing reverses growth.",
        status: "active", createdAt, updatedAt: createdAt
      }],
      links: [{
        projectId: project.id, caseId: "case-1", claimId: "claim-1", evidenceId: "evidence-1",
        relation: "supports", rationale: "The filing reports the observation."
      }],
      event: {
        id: "research-event-1", projectId: project.id, caseId: "case-1",
        eventType: "packet_submitted",
        receipt: { operation: "submitResearchPacket", actor: "test", outcome: "created" },
        createdAt
      }
    });

    expect(listResearchCases(db, project.id)).toEqual([
      expect.objectContaining({ id: "case-1", status: "draft" })
    ]);
    expect(getResearchCaseSnapshot(db, project.id, "case-1")).toEqual({
      researchCase: expect.objectContaining({ id: "case-1", question: "What changed?" }),
      snapshots: [],
      evidence: [expect.objectContaining({ id: "evidence-1", state: "current" })],
      verifications: [],
      claims: [expect.objectContaining({
        id: "claim-1",
        reviewStatus: "pending",
        links: [expect.objectContaining({ evidenceId: "evidence-1", relation: "supports" })]
      })],
      events: [expect.objectContaining({
        id: "research-event-1",
        receipt: { operation: "submitResearchPacket", actor: "test", outcome: "created" }
      })]
    });
  });

  test("rolls back the whole stored packet when one relation is invalid", () => {
    db = openDatabase(":memory:");
    migrate(db);
    const project = createProject(db, { name: "Rollback", rootPath: "/research-rollback" });
    const createdAt = "2026-09-01T00:00:00.000Z";

    expect(() => createResearchPacketRecords(db!, {
      researchCase: {
        id: "case-bad", projectId: project.id, title: "Bad", question: "Rollback?",
        asOfDate: "2026-09-01", status: "draft", createdAt, updatedAt: createdAt
      },
      evidence: [],
      claims: [],
      links: [{
        projectId: project.id, caseId: "case-bad", claimId: "missing-claim", evidenceId: "missing-evidence",
        relation: "supports", rationale: "Invalid"
      }],
      event: {
        id: "event-bad", projectId: project.id, caseId: "case-bad",
        eventType: "packet_submitted", receipt: { outcome: "created" }, createdAt
      }
    })).toThrow();

    expect(listResearchCases(db, project.id)).toEqual([]);
  });
});
