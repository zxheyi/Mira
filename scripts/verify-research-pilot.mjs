// Run after npm run build. Verifies the committed public-source pilot without network access.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { openDatabase } from "../dist/src/db/client.js";
import { migrate } from "../dist/src/db/schema.js";
import { ensureProjectForRoot } from "../dist/src/projects/projectStore.js";
import {
  authorizeResearch,
  markResearchEvidenceStale,
  reviewResearchClaim,
  reviseResearchClaim,
  submitResearchPacket
} from "../dist/src/research/researchService.js";
import { renderResearchCaseMarkdown } from "../dist/src/research/researchExport.js";
import { callMiraTool } from "../dist/src/mcp/server.js";
import { getViewerResearchCase } from "../dist/src/ui/viewerData.js";

const execFileAsync = promisify(execFile);
const jsonRoundTrip = value => JSON.parse(JSON.stringify(value));
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const fixturePath = resolve(repoRoot, "examples/research/apple-fy2024-pilot.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const root = await mkdtemp(join(tmpdir(), "mira-research-pilot-"));
const dbPath = join(root, ".mira", "mira.sqlite");
const db = openDatabase(dbPath);
migrate(db);
const project = ensureProjectForRoot(db, root);
const authority = authorizeResearch(db, project.id, {
  actor: "pilot:reviewer",
  reason: "Reproducible public-source pilot review"
});

assert.ok(fixture.packet.evidence.length >= 10 && fixture.packet.evidence.length <= 20);
assert.ok(fixture.packet.claims.length >= 5 && fixture.packet.claims.length <= 10);
assert.ok(fixture.packet.evidence.every(item => {
  const host = new URL(item.sourceUri).hostname;
  return host === "sec.gov" || host.endsWith(".sec.gov") || host === "apple.com" || host.endsWith(".apple.com");
}), "pilot Evidence must use Apple or SEC primary-source URLs");
assert.ok(fixture.packet.claims.some(claim => claim.links.some(link => link.relation === "contradicts")));

let snapshot = submitResearchPacket(db, project.id, fixture.packet, "pilot:fixture");
const receipt = snapshot.events[0].receipt;
const evidenceIds = receipt.evidenceIds;
const claimIds = receipt.claimIds;
assert.ok(Array.isArray(evidenceIds) && Array.isArray(claimIds));
const evidenceByKey = new Map(fixture.packet.evidence.map((item, index) => [item.key, evidenceIds[index]]));
const claimByKey = new Map(fixture.packet.claims.map((item, index) => [item.key, claimIds[index]]));

const preReview = fixture.workflow.preStaleReview;
snapshot = reviewResearchClaim(
  db,
  project.id,
  claimByKey.get(preReview.claimKey),
  preReview.decision,
  preReview.reason,
  authority
);
assert.equal(snapshot.claims.find(item => item.id === claimByKey.get(preReview.claimKey)).reviewStatus, "approved");

snapshot = markResearchEvidenceStale(
  db,
  project.id,
  evidenceByKey.get(fixture.workflow.staleEvidenceKey),
  fixture.workflow.staleReason,
  authority
);
assert.equal(snapshot.evidence.find(item => item.id === evidenceByKey.get(fixture.workflow.staleEvidenceKey)).state, "stale");

const revision = fixture.workflow.revision;
snapshot = reviseResearchClaim(
  db,
  project.id,
  claimByKey.get(revision.claimKey),
  {
    ...revision.input,
    links: revision.input.links.map(link => ({
      evidenceId: evidenceByKey.get(link.evidenceKey),
      relation: link.relation,
      rationale: link.rationale
    }))
  },
  revision.reason,
  authority
);
const successor = snapshot.claims.find(item => item.supersedesClaimId === claimByKey.get(revision.claimKey));
assert.ok(successor, "pilot revision must create a successor");

for (const review of fixture.workflow.finalReviews) {
  const claimId = review.claimKey === "$revision" ? successor.id : claimByKey.get(review.claimKey);
  const current = snapshot.claims.find(item => item.id === claimId);
  if (!current || current.status !== "active") throw new Error("Final review targets an inactive Claim: " + review.claimKey);
  snapshot = reviewResearchClaim(db, project.id, claimId, review.decision, review.reason, authority);
}

assert.equal(snapshot.researchCase.status, "completed");
assert.ok(snapshot.claims.filter(item => item.status === "active")
  .every(item => item.reviewStatus === "approved" || item.reviewStatus === "rejected"));
assert.ok(snapshot.events.some(event => event.eventType === "claim_revised"));
assert.ok(snapshot.events.some(event => event.eventType === "evidence_marked_stale"));
assert.equal(Number(db.prepare("select count(*) from memories").pluck().get()), 0);

const mcpSnapshot = callMiraTool({projectRoot: root, dbPath}, "get_research_case", {
  caseId: snapshot.researchCase.id
});
const canonicalSnapshot = jsonRoundTrip(snapshot);
assert.deepEqual(jsonRoundTrip(mcpSnapshot), canonicalSnapshot);
assert.deepEqual(
  jsonRoundTrip(getViewerResearchCase(db, project.id, snapshot.researchCase.id)),
  canonicalSnapshot
);

const cli = await execFileAsync(process.execPath, [
  resolve(repoRoot, "dist/src/index.js"),
  "--db", dbPath,
  "--project-root", root,
  "research", "show",
  "--case", snapshot.researchCase.id
], {cwd: repoRoot});
assert.deepEqual(JSON.parse(cli.stdout.trim()), canonicalSnapshot);

const markdown = renderResearchCaseMarkdown(snapshot);
assert.match(markdown, /## Evidence Ledger/);
assert.match(markdown, /## Claim Matrix/);
assert.match(markdown, /Mira does not mutate thesis state/);
const exportPath = join(root, "apple-fy2024-research.md");
await writeFile(exportPath, markdown, "utf8");

console.log(JSON.stringify({
  status: "passed",
  fixture: fixturePath,
  caseId: snapshot.researchCase.id,
  evidence: snapshot.evidence.length,
  claims: snapshot.claims.length,
  activeClaims: snapshot.claims.filter(item => item.status === "active").length,
  events: snapshot.events.length,
  exportPath,
  checks: [
    "official-source-boundary",
    "contradicting-evidence",
    "authorized-review",
    "stale-propagation",
    "immutable-revision",
    "all-active-claims-reviewed",
    "cli-mcp-ui-consistency",
    "no-memory-or-thesis-mutation"
  ]
}));
db.close();
