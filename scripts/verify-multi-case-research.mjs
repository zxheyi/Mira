// Run after npm run build. Replays three bounded official-source cases without network access.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase } from "../dist/src/db/client.js";
import { migrate } from "../dist/src/db/schema.js";
import { ensureProjectForRoot } from "../dist/src/projects/projectStore.js";
import {
  authorizeResearch,
  reviewResearchClaim,
  submitResearchPacket
} from "../dist/src/research/researchService.js";
import { verifyEvidence } from "../dist/src/research/evidenceVerification.js";
import { callMiraTool } from "../dist/src/mcp/server.js";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const fixturePath = resolve(repoRoot, "examples/research/official-multi-case-pilot.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const root = await mkdtemp(join(tmpdir(), "mira-multi-case-pilot-"));
const dbPath = join(root, ".mira", "mira.sqlite");
const db = openDatabase(dbPath);
migrate(db);
const project = ensureProjectForRoot(db, root);
const authority = authorizeResearch(db, project.id, {
  actor: "pilot:reviewer",
  reason: "Reproducible official-source multi-case review"
});

assert.equal(fixture.cases.length, 3, "the pilot must contain exactly three cases");
assert.equal(new Set(fixture.cases.map(item => item.slug)).size, 3);

const results = [];
for (const item of fixture.cases) {
  assert.equal(item.packet.snapshots.length, 1);
  assert.equal(item.packet.evidence.length, 1);
  assert.equal(item.packet.claims.length, 1);
  for (const evidence of item.packet.evidence) {
    const host = new URL(evidence.sourceUri).hostname;
    assert.ok(host === item.officialDomain || host.endsWith(`.${item.officialDomain}`));
    assert.equal(evidence.sourceType, "regulatory_filing");
  }

  let snapshot = submitResearchPacket(db, project.id, item.packet, "pilot:fixture");
  const evidenceId = snapshot.events[0].receipt.evidenceIds[0];
  const claimId = snapshot.events[0].receipt.claimIds[0];
  assert.equal(verifyEvidence(db, project.id, snapshot.researchCase.id, evidenceId).status, "verified");

  const beforeApproval = callMiraTool({
    projectRoot: root, dbPath, taskId: `pilot:${item.slug}:before-approval`
  }, "prepare_research_context", {
    caseId: snapshot.researchCase.id
  });
  assert.deepEqual(beforeApproval.claimIds, []);
  assert.equal(beforeApproval.receipt.recorded, true);

  snapshot = reviewResearchClaim(
    db,
    project.id,
    claimId,
    "approve",
    "Reviewed against the bound official filing excerpt.",
    authority
  );
  assert.equal(snapshot.researchCase.status, "completed");

  const context = callMiraTool({
    projectRoot: root, dbPath, taskId: `pilot:${item.slug}:approved`
  }, "prepare_research_context", {
    caseId: snapshot.researchCase.id
  });
  assert.deepEqual(context.claimIds, [claimId]);
  assert.deepEqual(context.evidenceIds, [evidenceId]);
  assert.ok(context.markdown.includes(item.packet.claims[0].statement));

  const recalls = callMiraTool({projectRoot: root, dbPath}, "list_research_context_recalls", {
    caseId: snapshot.researchCase.id,
    limit: 10
  });
  assert.equal(recalls.length, 2);
  assert.ok(recalls.every(receipt => receipt.caseId === snapshot.researchCase.id));
  assert.ok(recalls.every(receipt => !Object.hasOwn(receipt, "markdown")));
  assert.ok(recalls.every(receipt => /^[a-f0-9]{64}$/.test(receipt.outputHash)));

  results.push({
    slug: item.slug,
    caseId: snapshot.researchCase.id,
    claimId,
    evidenceId,
    context,
    recalls
  });
}

const discovered = callMiraTool({projectRoot: root, dbPath}, "list_research_cases", {});
assert.equal(discovered.length, 3);
assert.deepEqual(
  new Set(discovered.map(item => item.id)),
  new Set(results.map(item => item.caseId))
);
assert.ok(discovered.every(item => item.status === "completed"));

for (const result of results) {
  const otherStatements = fixture.cases
    .filter(item => item.slug !== result.slug)
    .map(item => item.packet.claims[0].statement);
  assert.ok(otherStatements.every(statement => !result.context.markdown.includes(statement)));
}

assert.equal(Number(db.prepare("select count(*) from memories").pluck().get()), 0);
assert.equal(Number(db.prepare("select count(*) from memory_candidates").pluck().get()), 0);
assert.equal(Number(db.prepare(`select count(*) from sqlite_master
  where type = 'table' and lower(name) like '%thesis%'`).pluck().get()), 0);
const auditPayloads = db.prepare(`select payload from domain_events
  where project_id = ? and event_type = 'research_context_prepared'`).all(project.id);
assert.equal(auditPayloads.length, 6);
assert.ok(auditPayloads.every(row => !Object.hasOwn(JSON.parse(row.payload), "markdown")));

console.log(JSON.stringify({
  status: "passed",
  fixture: fixturePath,
  cases: results.map(item => ({
    slug: item.slug,
    caseId: item.caseId,
    claimId: item.claimId,
    evidenceId: item.evidenceId,
    recallReceipts: item.recalls.length
  })),
  checks: [
    "three-official-source-cases",
    "snapshot-bound-evidence-verification",
    "pre-review-exclusion",
    "authorized-claim-approval",
    "case-discovery",
    "case-isolated-context",
    "body-free-recall-audit",
    "no-memory-candidate-or-thesis-mutation"
  ]
}));
db.close();
