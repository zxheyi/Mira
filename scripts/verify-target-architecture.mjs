// Run after npm run build. Exercises the complete target architecture without network access.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../dist/src/db/client.js";
import { migrate } from "../dist/src/db/schema.js";
import { ensureProjectForRoot } from "../dist/src/projects/projectStore.js";
import { createHostAdapterRegistry } from "../dist/src/lifecycle/hostAdapterRegistry.js";
import { createTurnLifecycle } from "../dist/src/lifecycle/turnLifecycle.js";
import { createOutboxRunner } from "../dist/src/events/outboxRunner.js";
import { createDefaultOutboxHandlers, drainOutbox } from "../dist/src/events/defaultOutboxHandlers.js";
import { authorizeCuration, curateMemory } from "../dist/src/memory/curationService.js";
import { authorizeResearch, reviewResearchClaim, submitResearchPacket } from "../dist/src/research/researchService.js";
import { getResearchCaseSnapshot } from "../dist/src/research/researchStore.js";
import { renderResearchCaseMarkdown } from "../dist/src/research/researchExport.js";
import { prepareResearchContext } from "../dist/src/research/researchContext.js";
import { callMiraTool } from "../dist/src/mcp/server.js";
import { readVaultSnapshot, renderMarkdownVault } from "../dist/src/vault/markdownVault.js";

const root = await mkdtemp(join(tmpdir(), "mira-target-architecture-"));
const dbPath = join(root, ".mira", "mira.sqlite");
const db = openDatabase(dbPath);
migrate(db);
const project = ensureProjectForRoot(db, root);
const registry = createHostAdapterRegistry();
assert.deepEqual(registry.list().map(item => [item.host,item.adapterRole]), [
  ["codex","source_host"],["claude-code","source_host"],["cursor","source_host"],
  ["cli","transport"],["mcp","transport"],["ui","transport"]
]);

const lifecycle = createTurnLifecycle({db,projectId:project.id});
const before = lifecycle.beforeTurn(registry.normalizeBeforeTurn("cursor", {
  sessionId:"runtime-session",turnId:"runtime-turn",query:"Record the evidence policy.",taskId:"target-runtime"
}));
assert.equal(before.turn.status, "started");
const after = lifecycle.afterTurn(registry.normalizeAfterTurn("cursor", {
  sessionId:"runtime-session",turnId:"runtime-turn",query:"Record the evidence policy.",
  response:"Research claims require verified source snapshots.",status:"succeeded",taskId:"target-runtime"
}));
assert.equal(after.capture.outcome, "imported");

const runner = createOutboxRunner({db});
const handlers = createDefaultOutboxHandlers({db});
assert.equal((await drainOutbox(runner, project.id, handlers)).failed, 0);

const proposed = curateMemory(db, {operation:"propose",input:{
  projectId:project.id,threadId:after.capture.threadId,sourceAgent:"runtime",extractionMethod:"agent",
  candidates:[{title:"Evidence policy",kind:"constraint",
    content:"Research claims require verified source snapshots.",
    evidence:"Research claims require verified source snapshots.",confidence:0.6,importance:0.8}]
}});
assert.equal(proposed[0].candidate.status, "pending_review");
const curationAuthority = authorizeCuration(db, project.id, {actor:"runtime:reviewer",reason:"Explicit acceptance test review"});
const accepted = curateMemory(db, {operation:"review",projectId:project.id,
  candidateId:proposed[0].candidate.id,decision:"accept",reason:"Matches the captured turn."}, curationAuthority);
assert.equal(accepted.outcome, "accepted");

let research = submitResearchPacket(db, project.id, {
  case:{title:"Runtime filing review",question:"Did reported revenue grow?",asOfDate:"2026-09-01"},
  snapshots:[{key:"S1",canonicalUri:"https://example.test/filing",sourceTitle:"Public filing",
    publishedAt:"2026-08-01",accessedAt:"2026-09-01",mediaType:"text/plain",
    content:"Page 7\nReported revenue increased by 10%."}],
  evidence:[{key:"E1",snapshotKey:"S1",sourceType:"regulatory_filing",
    sourceUri:"https://example.test/filing",sourceTitle:"Public filing",locator:"Page 7",
    excerpt:"Reported revenue increased by 10%.",publishedAt:"2026-08-01",accessedAt:"2026-09-01"}],
  claims:[{key:"C1",statement:"Reported revenue growth was positive.",evidenceStatus:"supported",
    confidence:0.9,thesisImpact:"watch",invalidationConditions:"A later filing restates revenue.",
    links:[{evidenceKey:"E1",relation:"supports",rationale:"Direct reported observation."}]}]
}, "runtime:extractor");
assert.equal((await drainOutbox(runner, project.id, handlers)).failed, 0);
research = getResearchCaseSnapshot(db, project.id, research.researchCase.id);
assert.equal(research.verifications[0].status, "verified");
const researchAuthority = authorizeResearch(db, project.id, {actor:"runtime:reviewer",reason:"Verified Source Snapshot"});
research = reviewResearchClaim(db, project.id, research.claims[0].id, "approve", "Source and inference reviewed.", researchAuthority);
assert.equal(research.researchCase.status, "completed");

const markdown = renderResearchCaseMarkdown(research);
const context = prepareResearchContext(db, project.id, research.researchCase.id);
const mcpContext = callMiraTool(
  {projectRoot:root,dbPath,db},
  "prepare_research_context",
  {caseId:research.researchCase.id}
);
const mcpRecalls = callMiraTool(
  {projectRoot:root,dbPath,db},
  "list_research_context_recalls",
  {caseId:research.researchCase.id}
);
const {receipt,...mcpPacket} = mcpContext;
const vault = renderMarkdownVault(readVaultSnapshot(db, project));
assert.match(markdown, /## Source Snapshot Ledger/);
assert.deepEqual(context.claimIds, [research.claims[0].id]);
assert.deepEqual(mcpPacket, context);
assert.deepEqual(mcpRecalls.map(item => item.id), [receipt.id]);
assert.ok(vault.has(`research/${research.researchCase.id}.md`));
assert.equal(Number(db.prepare("select count(*) from memories").pluck().get()), 1,
  "Research workflow must not create an additional Memory");

console.log(JSON.stringify({status:"passed",root,projectId:project.id,turnId:before.turn.id,
  candidateId:proposed[0].candidate.id,caseId:research.researchCase.id,
  checks:["before-turn","after-turn","outbox-drain","candidate-review","source-snapshot",
    "evidence-verification","claim-review","research-context","mcp-research-context","research-context-recall-audit","export","vault","no-thesis-side-effect"]}));
db.close();
