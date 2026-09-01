// Run after npm run build; MIRA_PLAYWRIGHT_MODULE may point to a bundled Playwright module.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../dist/src/db/client.js";
import { migrate } from "../dist/src/db/schema.js";
import { ensureProjectForRoot } from "../dist/src/projects/projectStore.js";
import { saveThread } from "../dist/src/threads/threadStore.js";
import { authorizeCuration, curateMemory } from "../dist/src/memory/curationService.js";
import { prepareContext } from "../dist/src/context/contextPreparation.js";
import { enqueueDistillJob, claimNextDistillJob, failDistillJob } from "../dist/src/distill/distillJobStore.js";
import { startViewerServer } from "../dist/src/ui/viewerServer.js";
import { submitResearchPacket } from "../dist/src/research/researchService.js";

const {chromium} = await import(process.env.MIRA_PLAYWRIGHT_MODULE || "playwright");
const root = await mkdtemp(join(tmpdir(), "mira-ui-acceptance-"));
const dbPath = join(root, ".mira", "mira.sqlite");
const db = openDatabase(dbPath); migrate(db);
const project = ensureProjectForRoot(db, root);
const thread = saveThread(db, {id: "synthetic_source", projectId: project.id, title: "示例来源会话", source: "synthetic-test", rawFormat: "markdown", rawText: "研究结论必须绑定可核验的原始资料。"});
curateMemory(db, {operation: "add", input: {projectId: project.id, title: "示例研究流程", content: "每次研究先核对来源。", kind: "convention", source: "manual", confidence: 1, importance: 5}}, authorizeCuration(db, project.id, {actor: "test", reason: "Synthetic UI fixture"}));
for (const title of ["待核对的证据规则", "待拒绝的自动归纳"]) curateMemory(db, {operation: "propose", input: {projectId: project.id, threadId: thread.id, sourceAgent: "synthetic-test", extractionMethod: "agent", candidates: [{title, content: title + "：结论保留原始出处。", kind: "decision", evidence: thread.rawText, confidence: 0.98, importance: 0.8}]}});
prepareContext(db, project.id, {taskId: "research-demo", maxCharacters: 1200});
enqueueDistillJob(db, project.id, thread.id, "cli");
const job = claimNextDistillJob(db, project.id);
failDistillJob(db, job.id, "Synthetic provider unavailable", job.attempts);
const research = submitResearchPacket(db, project.id, {
  case: {title: "公开公司季度研究", question: "本季度发生了什么变化？", asOfDate: "2026-09-01"},
  snapshots: [{
    key: "S1", canonicalUri: "https://example.test/filing", sourceTitle: "季度监管文件",
    accessedAt: "2026-09-01", mediaType: "text/plain", content: "p. 1\n报告收入同比增长。"
  }],
  evidence: [{
    key: "E1", snapshotKey: "S1", sourceType: "regulatory_filing", sourceUri: "https://example.test/filing",
    sourceTitle: "季度监管文件", locator: "p. 1", excerpt: "报告收入同比增长。", accessedAt: "2026-09-01"
  }],
  claims: [{
    key: "C1", statement: "报告收入仍保持同比增长。", evidenceStatus: "supported", confidence: 0.8,
    thesisImpact: "watch", invalidationConditions: "后续监管文件报告同比下降。",
    links: [{evidenceKey: "E1", relation: "supports", rationale: "监管文件直接报告该观察。"}]
  }]
}, "synthetic-test");
const server = await startViewerServer({projectRoot: root, dbPath, port: 0});
let browser;
try {
  browser = await chromium.launch({headless: true, ...(process.env.MIRA_BROWSER_PATH ? {executablePath: process.env.MIRA_BROWSER_PATH} : {})});
  const page = await browser.newPage({viewport: {width: 1365, height: 1000}});
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const nav = name => page.getByRole("button", {name, exact: true}).click();
  const submit = async () => {
    await page.getByRole("button", {name: "确认提交", exact: true}).click();
    await page.locator("#editor").waitFor({state: "hidden"});
  };
  await page.goto(server.url);
  await page.locator("#overview .stats").waitFor();
  await nav("简报");
  await page.getByText("暂无简报；可通过 CLI briefing show 生成", {exact:true}).waitFor();
  await nav("候选审核");
  const candidate = page.locator("article").filter({has: page.getByRole("heading", {name:"待核对的证据规则", exact:true})});
  await candidate.getByRole("button", {name:"批准", exact:true}).click();
  assert.equal(await page.locator("#content-field").isVisible(), false, "approval must not show an ignored correction field");
  await page.screenshot({path:join(root,"desktop-review.png"), fullPage:true});
  await page.getByRole("button", {name:"取消",exact:true}).click();
  await candidate.getByRole("button", {name:"批准",exact:true}).click();
  await page.locator("#edit-reason").fill("人工核对原文后确认");
  await submit();
  await candidate.getByText(/accepted/).waitFor();
  await page.locator("article").filter({hasText:"待拒绝的自动归纳"}).getByRole("button",{name:"拒绝",exact:true}).click();
  await submit();
  await nav("记忆");
  const active = page.locator("article").filter({hasText:"示例研究流程"}).filter({has:page.locator('[data-action="correct"]')});
  await active.getByRole("button",{name:"纠正",exact:true}).click();
  assert.equal(await page.locator("#replacement-field").isVisible(), false);
  await page.getByLabel("更正内容").fill("已纠正：研究结论需要原始证据和审核记录。");
  await submit();
  await active.getByText("已纠正：研究结论需要原始证据和审核记录。",{exact:true}).waitFor();
  await active.getByRole("button",{name:"归档",exact:true}).click(); await submit();
  const archived = page.locator("article").filter({hasText:"示例研究流程"}).filter({has:page.locator('[data-action="restore"]')});
  await archived.getByRole("button",{name:"恢复",exact:true}).click(); await submit();
  await active.getByRole("button",{name:"查看历史",exact:true}).click();
  await page.locator("#memory-history pre").waitFor();
  assert.match(await page.locator("#memory-history").innerText(), /superseded/);
  await page.screenshot({path:join(root,"desktop-memory-history.png"), fullPage:true});
  await nav("召回审计"); await page.getByText(/完整注入 1/).waitFor();
  await nav("后台任务"); await page.getByRole("button",{name:"重新排队",exact:true}).click(); await submit();
  await page.getByText(/pending · synthetic_source/).waitFor();
  await nav("研究案例");
  await page.getByRole("heading",{name:"研究案例 · Evidence → Claim → Review",exact:true}).waitFor();
  const evidence = page.locator("article").filter({hasText:"季度监管文件"})
    .filter({has:page.locator('[data-resource="research-evidence"]')});
  await evidence.getByRole("button",{name:"校验证据",exact:true}).click();
  assert.equal(await page.locator("#reason-field").isVisible(), false, "deterministic verification needs no authority reason");
  await submit();
  await evidence.getByText(/verification: verified/).waitFor();
  const claim = page.locator("article").filter({hasText:"报告收入仍保持同比增长。"});
  await claim.getByRole("button",{name:"批准",exact:true}).click();
  assert.equal(await page.getByLabel("操作原因（必填）").getAttribute("required"), "");
  await page.getByLabel("操作原因（必填）").fill("已核对监管文件和定位");
  await page.screenshot({path:join(root,"desktop-research-review.png"), fullPage:true});
  await submit();
  await page.locator("#research-detail").getByText(/completed · as of 2026-09-01/).waitFor();
  await evidence.getByRole("button",{name:"标记过期",exact:true}).click();
  await page.getByLabel("操作原因（必填）").fill("已被后续监管文件替代");
  await submit();
  await page.locator("#research-detail").getByText(/review:changes_requested/).waitFor();
  assert.match(await page.locator("#research-detail").innerText(), new RegExp(research.researchCase.id));
  await nav("会话"); await page.locator("#thread-detail pre").waitFor();
  assert.match(await page.locator("#thread-detail pre").innerText(), /研究结论必须绑定可核验的原始资料/);
  await nav("导入批次"); await page.locator("#runs").getByText("暂无导入批次",{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844}); await nav("研究案例");
  await page.getByRole("heading",{name:"研究案例 · Evidence → Claim → Review",exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth), "narrow layout must not overflow horizontally");
  await page.screenshot({path:join(root,"narrow-research.png"), fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:"passed", baseline:["specs/025-recovery-and-management-ui/spec.md","specs/027-investment-research-case/spec.md"], artifacts:root, checks:["memory review/correct/lifecycle","research review/stale/export","recall/jobs/threads/empty-briefing","desktop/narrow/no-js-errors"]}));
} finally {
  await browser?.close(); await server.close(); db.close();
}
