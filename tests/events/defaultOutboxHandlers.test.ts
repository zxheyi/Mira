import { afterEach, expect, test } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../src/db/client.js";
import { migrate } from "../../src/db/schema.js";
import { createProject } from "../../src/projects/projectStore.js";
import { createHostAdapterRegistry } from "../../src/lifecycle/hostAdapterRegistry.js";
import { createTurnLifecycle } from "../../src/lifecycle/turnLifecycle.js";
import { submitResearchPacket, getResearchCaseSnapshot } from "../../src/research/researchService.js";
import { listDistillJobs } from "../../src/distill/distillJobStore.js";
import { listProjectBriefings } from "../../src/briefing/projectBriefingStore.js";
import { listOutboxMessages } from "../../src/events/domainOutboxStore.js";
import { createOutboxRunner } from "../../src/events/outboxRunner.js";
import { createDefaultOutboxHandlers, drainOutbox } from "../../src/events/defaultOutboxHandlers.js";

let db: Database.Database | undefined;
afterEach(() => { db?.close(); db = undefined; });

test("default Outbox handlers materialize capture, verification, and projection effects idempotently", async () => {
  db = openDatabase(":memory:");
  migrate(db);
  const project = createProject(db, {name: "Handlers", rootPath: "/outbox-handlers"});
  const registry = createHostAdapterRegistry();
  createTurnLifecycle({db, projectId: project.id}).afterTurn(registry.normalizeAfterTurn("cli", {
    sessionId: "session-1", turnId: "turn-1", query: "Capture this turn.",
    response: "Captured.", status: "succeeded"
  }));
  const research = submitResearchPacket(db, project.id, {
    case: {title: "Outbox verification", question: "What changed?", asOfDate: "2026-09-01"},
    snapshots: [{key:"S1",canonicalUri:"https://example.test/source",sourceTitle:"Source",
      accessedAt:"2026-09-01",mediaType:"text/plain",content:"p. 1\nRevenue increased."}],
    evidence: [{key:"E1",snapshotKey:"S1",sourceType:"regulatory_filing",
      sourceUri:"https://example.test/source",sourceTitle:"Source",locator:"p. 1",
      excerpt:"Revenue increased.",accessedAt:"2026-09-01"}],
    claims: [{key:"C1",statement:"Revenue increased.",evidenceStatus:"supported",confidence:0.8,
      thesisImpact:"watch",invalidationConditions:"A later filing differs.",
      links:[{evidenceKey:"E1",relation:"supports",rationale:"Direct observation."}]}]
  });
  const handlers = createDefaultOutboxHandlers({db});
  const runner = createOutboxRunner({db});
  const drained = await drainOutbox(runner, project.id, handlers);

  expect(drained).toMatchObject({completed: 5, failed: 0});
  expect(listOutboxMessages(db, project.id).every((item) => item.status === "completed")).toBe(true);
  expect(listDistillJobs(db, project.id)).toHaveLength(1);
  expect(getResearchCaseSnapshot(db, project.id, research.researchCase.id).verifications)
    .toEqual([expect.objectContaining({status: "verified"})]);
  expect(listProjectBriefings(db, project.id)).toHaveLength(2);
  expect(listProjectBriefings(db, project.id)[0].markdown).toContain("evidence 1/1 verified");

  const projection = listOutboxMessages(db, project.id)
    .find((item) => item.topic === "projection.refresh.requested")!;
  await handlers[projection.topic]!(projection, {idempotencyKey: projection.id});
  await handlers[projection.topic]!(projection, {idempotencyKey: projection.id});
  expect(listProjectBriefings(db, project.id)).toHaveLength(2);
});
