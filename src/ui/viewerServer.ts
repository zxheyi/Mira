import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { listMemoryCandidates } from "../distill/candidateService.js";
import { listDistillJobs, sanitizeDistillError } from "../distill/distillJobStore.js";
import { listOutboxMessages } from "../events/domainOutboxStore.js";
import { getMemoryHistory } from "../memory/memoryLifecycleStore.js";
import { getRecallQualityReport } from "../context/recallFeedbackStore.js";
import { applyViewerAction } from "./viewerActions.js";
import { openDatabase } from "../db/client.js";
import { migrate } from "../db/schema.js";
import { ensureProjectForRoot } from "../projects/projectStore.js";
import {
  getViewerBriefing,
  getViewerContextBundle,
  getViewerMemorySnapshot,
  getViewerOverview,
  getViewerResearchCase,
  getViewerResearchContext,
  getViewerThread,
  listViewerImportRuns,
  listViewerRecallEntries,
  listViewerThreads,
  listViewerResearchCases
} from "./viewerData.js";
import { renderResearchCaseMarkdown } from "../research/researchExport.js";
import { createHostAdapterRegistry } from "../lifecycle/hostAdapterRegistry.js";
import { createTurnLifecycle } from "../lifecycle/turnLifecycle.js";

export type ViewerServerOptions = {
  projectRoot: string;
  dbPath: string;
  host?: string;
  port?: number;
};

export type ViewerServerHandle = {
  server: Server;
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
};

type RuntimeOptions = Required<ViewerServerOptions> & {csrfToken: string; origin: string; authority: string};

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mira 本地 Viewer</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #172033;
      --muted: #667085;
      --line: #d8dde6;
      --soft: #f6f8fb;
      --panel: #ffffff;
      --accent: #2f7d68;
      --accent-strong: #1f604f;
      --amber: #a16207;
      --danger: #b42318;
      --code: #253048;
    }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--soft);
      letter-spacing: 0;
    }
    button, pre, input, textarea, select { font: inherit; }
    input, textarea, select { max-width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 8px; }
    textarea { width: 100%; min-height: 130px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    .actions button, dialog button { border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; background: white; color: var(--accent-strong); cursor: pointer; }
    .actions button.primary, dialog button[type=submit] { background: var(--accent); color: white; }
    .memory-card { margin-bottom: 14px; overflow-wrap: anywhere; }
    dialog { border: 1px solid var(--line); border-radius: 12px; width: min(720px, 92vw); max-height: 90vh; padding: 24px; overflow: auto; }
    dialog::backdrop { background: #17203377; }
    dialog label { display: block; margin: 14px 0; }
    dialog input { display: block; width: 100%; margin-top: 6px; }
    fieldset { border: 1px solid var(--line); border-radius: 8px; margin: 14px 0; padding: 12px; }
    .recall-memory-row { display: grid; grid-template-columns: minmax(0, 1fr) 150px; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid #edf0f4; }
    .recall-memory-row:last-child { border-bottom: 0; }
    .recall-memory-row label { display: flex; gap: 8px; align-items: flex-start; margin: 0; }
    .recall-memory-row input { display: inline; width: auto; margin: 3px 0 0; }
    #feedback { margin-bottom: 12px; overflow-wrap: anywhere; }
    .app { min-height: 100vh; display: grid; grid-template-columns: 236px minmax(0, 1fr); }
    .sidebar { background: #172033; color: white; padding: 20px 14px; display: flex; flex-direction: column; gap: 18px; }
    .brand { font-weight: 800; font-size: 20px; line-height: 1.1; padding: 0 8px; }
    .project-pill { font-size: 12px; color: #d7dee8; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); border-radius: 6px; padding: 8px; overflow-wrap: anywhere; }
    .nav { display: grid; gap: 6px; }
    .nav button { width: 100%; border: 0; border-radius: 6px; padding: 10px 11px; color: #e7edf5; background: transparent; text-align: left; cursor: pointer; }
    .nav button.active { background: var(--accent); color: white; }
    .main { min-width: 0; padding: 22px; }
    .topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    h1 { font-size: 24px; line-height: 1.2; margin: 0 0 4px; }
    h2 { font-size: 17px; margin: 0 0 12px; }
    .muted { color: var(--muted); font-size: 13px; }
    .status { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .badge { border: 1px solid var(--line); border-radius: 999px; padding: 5px 9px; background: var(--panel); color: var(--muted); font-size: 12px; white-space: nowrap; }
    .badge.ok { color: var(--accent-strong); border-color: #9bd4c0; background: #edf8f4; }
    .badge.warn { color: var(--amber); border-color: #f0cc80; background: #fff8e8; }
    .grid { display: grid; gap: 14px; }
    .stats { grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); }
    .card, .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
    .card { padding: 14px; min-height: 86px; }
    .stat-value { font-size: 24px; font-weight: 800; line-height: 1; margin-bottom: 8px; }
    .stat-label { color: var(--muted); font-size: 12px; }
    .content-grid { grid-template-columns: minmax(0, 1.35fr) minmax(280px, .65fr); align-items: start; margin-top: 14px; }
    .panel { padding: 16px; min-width: 0; }
    .table { display: grid; border-top: 1px solid var(--line); }
    .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; padding: 12px 0; border-bottom: 1px solid #edf0f4; align-items: center; }
    .row button { border: 0; background: transparent; color: var(--accent-strong); cursor: pointer; padding: 0; text-align: left; font-weight: 700; overflow-wrap: anywhere; }
    .split { display: grid; grid-template-columns: 330px minmax(0, 1fr); gap: 14px; align-items: start; }
    .list { display: grid; gap: 8px; }
    .list button { text-align: left; border: 1px solid var(--line); background: var(--panel); border-radius: 8px; padding: 12px; cursor: pointer; min-height: 84px; }
    .list button.active { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
    .title { font-weight: 750; overflow-wrap: anywhere; }
    .meta { color: var(--muted); font-size: 12px; margin-top: 4px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--code); color: #f7fafc; border-radius: 8px; padding: 14px; max-height: 62vh; overflow: auto; line-height: 1.5; }
    .markdown { background: #fbfcfe; border: 1px solid #e5e9f0; border-radius: 8px; padding: 14px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.55; max-height: 62vh; overflow: auto; }
    .empty { color: var(--muted); background: #fbfcfe; border: 1px dashed #cfd6e2; border-radius: 8px; padding: 24px; text-align: center; }
    .error { color: var(--danger); }
    .view { display: none; }
    .view.active { display: block; }
    @media (max-width: 920px) {
      .app { grid-template-columns: 1fr; }
      .sidebar { position: static; }
      .nav { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .stats, .content-grid, .split { grid-template-columns: 1fr; }
      .topbar { flex-direction: column; }
      .status { justify-content: flex-start; }
    }
  </style>
</head>
<body>
  <div id="app" class="app">
    <aside class="sidebar">
      <div class="brand">Mira</div>
      <div id="project-pill" class="project-pill">正在加载项目</div>
      <nav class="nav" aria-label="Viewer 导航">
        <button class="active" data-view="overview">总览</button>
        <button data-view="threads">会话</button>
        <button data-view="runs">导入批次</button>
        <button data-view="briefing">简报</button>
        <button data-view="memory">记忆</button>
        <button data-view="candidates">候选审核</button>
        <button data-view="research">研究案例</button>
        <button data-view="recalls">召回审计</button>
        <button data-view="jobs">后台任务</button>
      </nav>
    </aside>
    <main class="main">
      <div class="topbar">
        <div>
          <h1>Mira 本地 Viewer</h1>
          <div id="db-path" class="muted"></div>
        </div>
        <div id="integration-status" class="status"></div>
      </div>
      <div id="feedback" role="status" aria-live="polite"></div>
      <section id="overview" class="view active"></section>
      <section id="threads" class="view"></section>
      <section id="runs" class="view"></section>
      <section id="briefing" class="view"></section>
      <section id="memory" class="view"></section>
      <section id="candidates" class="view"></section>
      <section id="research" class="view"></section>
      <section id="recalls" class="view"></section>
      <section id="jobs" class="view"></section>
    </main>
  </div>
  <dialog id="editor">
    <form id="edit-form">
      <h2 id="edit-title"></h2>
      <div id="edit-preview" class="markdown"></div>
      <label id="content-field">更正内容<textarea id="edit-content"></textarea></label>
      <label id="replacement-field">替换的 active 记忆 ID（可选）<input id="edit-replacement" maxlength="500"></label>
      <label id="contradictions-field">结构化反证处置（JSON）<textarea id="edit-contradictions"></textarea></label>
      <label id="reason-field">操作原因（可选）<input id="edit-reason" maxlength="1000"></label>
      <p id="edit-error" class="error" role="alert"></p>
      <div class="actions"><button type="button" id="edit-cancel">取消</button><button type="submit">确认提交</button></div>
    </form>
  </dialog>
  <dialog id="recall-feedback-editor">
    <form id="recall-feedback-form">
      <h2>标注召回</h2>
      <p class="muted">只记录用户明确评价；工具成功不代表召回有用。</p>
      <div id="recall-feedback-preview" class="markdown"></div>
      <label>总体结果
        <select id="recall-feedback-outcome" required>
          <option value="useful">有用</option><option value="partial">部分有用</option>
          <option value="missed">未召回</option><option value="incorrect">内容错误</option>
        </select>
      </label>
      <fieldset><legend>已注入 Memory</legend><div id="recall-injected-options"></div></fieldset>
      <fieldset><legend>缺失 Memory</legend>
        <label>搜索未注入的 active Memory<input id="recall-missing-filter" placeholder="标题、内容或 ID"></label>
        <div id="recall-missing-options"></div>
      </fieldset>
      <label>用户反馈原因<textarea id="recall-feedback-reason" maxlength="2000" required></textarea></label>
      <p id="recall-feedback-error" class="error" role="alert"></p>
      <div class="actions"><button type="button" id="recall-feedback-cancel">取消</button><button type="submit">保存标注</button></div>
    </form>
  </dialog>
  <script>
    const state = {
      overview: null,
      threads: [],
      memories: [],
      candidates: [],
      researchCases: [],
      researchSnapshot: null,
      recalls: [],
      selectedThreadId: null,
      selectedResearchCaseId: null,
      csrfToken: null,
      editing: null,
      recallFeedbackEditing: null,
      recallMissingIds: new Set()
    };
    const fmt = new Intl.NumberFormat();
    const bytes = (value) => {
      if (!value) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      let size = value;
      let index = 0;
      while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
      return \`\${size.toFixed(index === 0 ? 0 : 1)} \${units[index]}\`;
    };
    async function api(path, body) {
      const response = await fetch(path, body === undefined ? {} : {method: 'POST', headers: {'content-type': 'application/json', 'x-mira-csrf': state.csrfToken}, body: JSON.stringify(body)});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || \`Request 失败: \${response.status}\`);
      return data;
    }
    function text(value) { return value === undefined || value === null || value === '' ? '无' : String(value); }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }
    function stat(label, value) {
      return \`<div class="card"><div class="stat-value">\${escapeHtml(value)}</div><div class="stat-label">\${escapeHtml(label)}</div></div>\`;
    }
    function renderShell(overview) {
      document.getElementById('project-pill').textContent = overview.project.rootPath;
      document.getElementById('db-path').textContent = overview.database.path;
      const codex = overview.integrations.codex.installed;
      const claude = overview.integrations.claudeCode.installed;
      document.getElementById('integration-status').innerHTML = \`
        <span class="badge \${codex ? 'ok' : 'warn'}">Codex \${codex ? '已接入' : '未安装'}</span>
        <span class="badge \${claude ? 'ok' : 'warn'}">Claude Code \${claude ? '已接入' : '未安装'}</span>\`;
    }
    function renderOverview() {
      const overview = state.overview;
      const latest = overview.latestImportRun;
      document.getElementById('overview').innerHTML = \`
        <div class="grid stats">
          \${stat('会话', fmt.format(overview.counts.threads))}
          \${stat('记忆', fmt.format(overview.counts.memories))}
          \${stat('候选', fmt.format(overview.counts.memoryCandidates))}
          \${stat('研究案例', fmt.format(overview.counts.researchCases))}
          \${stat('导入批次', fmt.format(overview.counts.historyImportRuns))}
          \${stat('数据库', bytes(overview.database.sizeBytes))}
        </div>
        <div class="grid content-grid">
          <div class="panel">
            <h2>最近会话</h2>
            <div id="overview-threads" class="table"></div>
          </div>
          <div class="panel">
            <h2>最近导入</h2>
            \${latest ? \`<div class="row"><span>状态</span><b>\${escapeHtml(latest.status)}</b></div>
              <div class="row"><span>已导入</span><b>\${fmt.format(latest.importedCount)}</b></div>
              <div class="row"><span>已跳过</span><b>\${fmt.format(latest.skippedCount)}</b></div>
              <div class="row"><span>失败</span><b>\${fmt.format(latest.failedCount)}</b></div>\` : '<div class="empty">暂无导入批次</div>'}
            <h2 style="margin-top:18px">简报</h2>
            \${overview.latestBriefing ? \`<div class="row"><span>版本</span><b>\${overview.latestBriefing.version}</b></div>
              <div class="row"><span>Token 估算</span><b>\${fmt.format(overview.latestBriefing.estimatedTokens)}</b></div>\` : '<div class="empty">暂无简报</div>'}
          </div>
        </div>\`;
      document.getElementById('overview-threads').innerHTML = state.threads.slice(0, 5).map((thread) => \`
        <div class="row"><button data-open-thread="\${escapeHtml(thread.id)}">\${escapeHtml(thread.title)}</button><span class="muted">\${escapeHtml(thread.source)} · \${fmt.format(thread.rawCharacters)} 字符</span></div>\`).join('') || '<div class="empty">暂无会话</div>';
    }
    async function renderThreads() {
      const list = state.threads.map((thread) => \`<button class="\${thread.id === state.selectedThreadId ? 'active' : ''}" data-thread-id="\${escapeHtml(thread.id)}"><div class="title">\${escapeHtml(thread.title)}</div><div class="meta">\${escapeHtml(thread.source)} · \${escapeHtml(thread.rawFormat)} · \${fmt.format(thread.rawCharacters)} 字符</div><div class="meta">\${escapeHtml(thread.preview)}</div></button>\`).join('');
      document.getElementById('threads').innerHTML = \`<div class="split"><div class="list">\${list || '<div class="empty">暂无会话</div>'}</div><div id="thread-detail" class="panel"><div class="empty">请选择一条会话</div></div></div>\`;
      if (!state.selectedThreadId && state.threads[0]) state.selectedThreadId = state.threads[0].id;
      if (state.selectedThreadId) await loadThread(state.selectedThreadId);
    }
    async function loadThread(id) {
      state.selectedThreadId = id;
      document.querySelectorAll('[data-thread-id]').forEach((button) => button.classList.toggle('active', button.dataset.threadId === id));
      const thread = await api(\`/api/threads/\${encodeURIComponent(id)}\`);
      document.getElementById('thread-detail').innerHTML = \`<h2>\${escapeHtml(thread.title)}</h2><div class="muted">\${escapeHtml(thread.source)} · \${escapeHtml(thread.rawFormat)} · \${escapeHtml(thread.updatedAt)}</div><pre>\${escapeHtml(thread.rawText)}</pre>\`;
    }
    async function renderRuns() {
      const runs = await api('/api/import-runs');
      document.getElementById('runs').innerHTML = \`<div class="panel"><h2>导入批次</h2><div class="table">\${runs.map((run) => \`<div class="row"><span><b>\${escapeHtml(run.status)}</b><br><span class="muted">\${escapeHtml(run.startedAt)}</span></span><span class="muted">\${fmt.format(run.importedCount)} 已导入 · \${fmt.format(run.skippedCount)} 已跳过 · \${fmt.format(run.failedCount)} 失败</span></div>\`).join('') || '<div class="empty">暂无导入批次</div>'}</div></div>\`;
    }
    async function renderBriefing() {
      const [briefing, bundle] = await Promise.all([api('/api/briefing'), api('/api/context-bundle')]);
      document.getElementById('briefing').innerHTML = \`<div class="grid content-grid"><div class="panel"><h2>项目简报\${briefing?.staleAt ? '（已过期）' : ''}</h2><div class="markdown">\${escapeHtml(briefing?.markdown || '暂无简报；可通过 CLI briefing show 生成')}</div></div><div class="panel"><h2>上下文包预览（不记录召回）</h2><div class="markdown">\${escapeHtml(bundle.markdown)}</div></div></div>\`;
    }
    async function renderMemory() {
      const snapshot = await api('/api/memory');
      state.memories = snapshot.memories;
      document.getElementById('memory').innerHTML = '<h2>长期记忆 · 纠正保留历史</h2><label>搜索记忆 <input id="memory-filter" placeholder="标题、内容或状态"></label><div id="memory-cards" style="margin-top:14px"></div><div id="memory-history"></div><h2>项目共享工作记忆</h2><pre>' + escapeHtml(snapshot.workingMemory.map(item => item.kind + ': ' + item.content).join('\\n') || '暂无工作记忆') + '</pre>';
      renderMemoryCards('');
      document.getElementById('memory-filter').addEventListener('input', event => renderMemoryCards(event.target.value));
    }
    function actionButton(resource, id, action, label) {
      return '<button data-resource="' + resource + '" data-id="' + escapeHtml(id) + '" data-action="' + action + '">' + label + '</button>';
    }
    function renderMemoryCards(query) {
      const memories = state.memories.filter(memory => (memory.title + memory.content + memory.status).toLowerCase().includes(query.toLowerCase()));
      document.getElementById('memory-cards').innerHTML = memories.map(memory => '<article class="panel memory-card"><h2>' + escapeHtml(memory.title) + '</h2><div class="muted">' + escapeHtml(memory.id + ' · ' + memory.kind + ' · ' + memory.status) + '</div><p>' + escapeHtml(memory.content) + '</p><div class="muted">来源：' + escapeHtml(memory.source) + '</div><div class="actions">' + (memory.status === 'active' ? actionButton('memory', memory.id, 'correct', '纠正') + actionButton('memory', memory.id, 'archive', '归档') : memory.status === 'archived' ? actionButton('memory', memory.id, 'restore', '恢复') : '') + actionButton('memory', memory.id, 'history', '查看历史') + '</div></article>').join('') || '<div class="empty">暂无匹配记忆</div>';
    }
    async function renderCandidates() {
      state.candidates = await api('/api/candidates');
      document.getElementById('candidates').innerHTML = '<h2>候选审核 · 先核对证据，再批准</h2><p class="muted">展示最近 100 条。批准仅影响记忆，不更新投资 thesis。</p>' + state.candidates.map(candidate => '<article class="panel memory-card"><h2>' + escapeHtml(candidate.title) + '</h2><p>' + escapeHtml(candidate.content) + '</p><div class="muted">' + escapeHtml(candidate.status + ' · ' + candidate.riskLevel + ' · ' + (candidate.reviewReason || '无待审原因')) + '</div><h3>原文证据</h3><div class="markdown">' + escapeHtml(candidate.evidence) + '</div><div class="actions"><button data-open-thread="' + escapeHtml(candidate.threadId) + '">查看来源会话</button>' + (candidate.status === 'pending_review' ? actionButton('candidates', candidate.id, 'accept', '批准') + actionButton('candidates', candidate.id, 'reject', '拒绝') : '') + '</div></article>').join('') + (!state.candidates.length ? '<div class="empty">暂无候选记忆</div>' : '');
    }
    async function renderResearch() {
      state.researchCases = await api('/api/research-cases');
      if (!state.selectedResearchCaseId && state.researchCases[0]) {
        state.selectedResearchCaseId = state.researchCases[0].id;
      }
      const list = state.researchCases.map(item =>
        '<button class="' + (item.id === state.selectedResearchCaseId ? 'active' : '') + '" data-research-case="' + escapeHtml(item.id) + '">'
        + '<div class="title">' + escapeHtml(item.title) + '</div>'
        + '<div class="meta">' + escapeHtml(item.status + ' · as of ' + item.asOfDate) + '</div>'
        + '<div class="meta">' + escapeHtml(item.question) + '</div></button>'
      ).join('');
      document.getElementById('research').innerHTML =
        '<h2>研究案例 · Evidence → Claim → Review</h2>'
        + '<p class="muted">Thesis impact 只是提案；Mira 不修改 thesis、仓位或交易状态。</p>'
        + '<div class="split"><div class="list">' + (list || '<div class="empty">暂无研究案例；可通过 CLI 或 MCP 提交 draft packet</div>')
        + '</div><div id="research-detail" class="panel"><div class="empty">请选择一个研究案例</div></div></div>';
      if (state.selectedResearchCaseId) await loadResearchCase(state.selectedResearchCaseId);
    }
    async function loadResearchCase(id) {
      state.selectedResearchCaseId = id;
      document.querySelectorAll('[data-research-case]').forEach(button =>
        button.classList.toggle('active', button.dataset.researchCase === id)
      );
      const snapshot = await api('/api/research-cases/' + encodeURIComponent(id));
      state.researchSnapshot = snapshot;
      const evidenceById = new Map(snapshot.evidence.map(item => [item.id, item]));
      const verificationByEvidence = new Map(snapshot.verifications.filter(item => item.current).map(item => [item.evidenceId, item]));
      const sourceById = new Map(snapshot.snapshots.map(item => [item.id, item]));
      const sources = snapshot.snapshots.map(item =>
        '<article class="panel memory-card"><h3>' + escapeHtml(item.sourceTitle) + '</h3>'
        + '<div class="muted">' + escapeHtml(item.id + ' · ' + item.state + ' · ' + item.mediaType) + '</div>'
        + '<p><a href="' + escapeHtml(item.canonicalUri) + '" target="_blank" rel="noreferrer">打开来源</a></p>'
        + '<div class="muted">SHA-256: ' + escapeHtml(item.contentHash) + ' · accessed ' + escapeHtml(item.accessedAt) + '</div>'
        + (item.state === 'current' ? '<div class="actions">' + actionButton('research-snapshots', item.id, 'stale', '标记 Snapshot 过期') + '</div>' : '')
        + '</article>'
      ).join('');
      const evidence = snapshot.evidence.map(item => {
        const verification = verificationByEvidence.get(item.id);
        const source = sourceById.get(item.snapshotId);
        return '<article class="panel memory-card"><h3>' + escapeHtml(item.sourceTitle) + '</h3>'
        + '<div class="muted">' + escapeHtml(item.id + ' · ' + item.sourceType + ' · ' + item.state) + '</div>'
        + '<p><a href="' + escapeHtml(item.sourceUri) + '" target="_blank" rel="noreferrer">打开来源</a> · ' + escapeHtml(item.locator) + '</p>'
        + '<div class="markdown">' + escapeHtml(item.excerpt) + '</div>'
        + '<div class="muted">Snapshot: ' + escapeHtml(source?.id || item.snapshotId || 'missing')
        + ' · verification: ' + escapeHtml(verification?.status || 'missing')
        + (verification?.receipt?.checkCodes?.length ? ' · ' + escapeHtml(verification.receipt.checkCodes.join(', ')) : '') + '</div>'
        + (item.state === 'current' ? '<div class="actions">'
          + (verification?.status !== 'verified' ? actionButton('research-evidence', item.id, 'verify', '校验证据') : '')
          + actionButton('research-evidence', item.id, 'stale', '标记过期') + '</div>' : '')
        + '</article>';
      }).join('');
      const claims = snapshot.claims.map(claim => {
        const links = claim.links.map(link => {
          const source = evidenceById.get(link.evidenceId);
          return '<li><b>' + escapeHtml(link.relation) + '</b> · ' + escapeHtml(source?.sourceTitle || link.evidenceId)
            + '：' + escapeHtml(link.rationale) + '</li>';
        }).join('');
        const actions = claim.status === 'active'
          ? '<div class="actions">'
            + actionButton('research-claims', claim.id, 'approve', '批准')
            + actionButton('research-claims', claim.id, 'reject', '拒绝')
            + actionButton('research-claims', claim.id, 'request_changes', '要求修改')
            + '</div>'
          : '';
        return '<article class="panel memory-card"><h3>' + escapeHtml(claim.statement) + '</h3>'
          + '<div class="muted">' + escapeHtml(claim.id + ' · ' + claim.status + ' · evidence:' + claim.evidenceStatus + ' · review:' + claim.reviewStatus) + '</div>'
          + '<p>置信度 ' + escapeHtml(claim.confidence) + ' · Thesis impact proposal: <b>' + escapeHtml(claim.thesisImpact) + '</b></p>'
          + '<p><b>失效条件：</b>' + escapeHtml(claim.invalidationConditions) + '</p>'
          + '<ul>' + links + '</ul>' + actions + '</article>';
      }).join('');
      const [exported, researchContext] = await Promise.all([
        api('/api/research-cases/' + encodeURIComponent(id) + '/export'),
        api('/api/research-cases/' + encodeURIComponent(id) + '/context')
      ]);
      document.getElementById('research-detail').innerHTML =
        '<h2>' + escapeHtml(snapshot.researchCase.title) + '</h2>'
        + '<div class="muted">' + escapeHtml(snapshot.researchCase.status + ' · as of ' + snapshot.researchCase.asOfDate) + '</div>'
        + '<p>' + escapeHtml(snapshot.researchCase.question) + '</p>'
        + '<h2>Claims</h2>' + (claims || '<div class="empty">暂无 Claim</div>')
        + '<h2>Source Snapshot Ledger</h2>' + (sources || '<div class="empty">暂无 Source Snapshot</div>')
        + '<h2>Evidence Ledger</h2>' + (evidence || '<div class="empty">暂无 Evidence</div>')
        + '<h2>Review Events</h2><pre>' + escapeHtml(JSON.stringify(snapshot.events, null, 2)) + '</pre>'
        + '<details><summary>Evidence-gated Research Context</summary><pre>' + escapeHtml(researchContext.markdown) + '</pre></details>'
        + '<details><summary>Markdown 导出预览</summary><pre>' + escapeHtml(exported.markdown) + '</pre></details>';
    }
    function recallMemoryLabel(id) {
      const memory = state.memories.find(item => item.id === id);
      return memory ? memory.title + ' · ' + id : id;
    }
    function renderRecallQuality(report) {
      const threshold = report.recommendation;
      const list = ids => ids.length
        ? '<ul>' + ids.map(id => '<li>' + escapeHtml(recallMemoryLabel(id)) + '</li>').join('') + '</ul>'
        : '<div class="muted">无</div>';
      const memoryQualityIds = [...new Set([
        ...report.irrelevantMemoryIds,...report.correctedMemoryIds,...report.confirmedCorrectionMemoryIds
      ])];
      return '<section id="recall-quality" class="panel memory-card">'
        + '<h2>召回质量证据</h2><p class="muted">该报告只提供决策证据，不会自动切换检索、修改 Research 或 thesis。</p>'
        + '<div class="grid stats">'
        + stat('标注覆盖率',Math.round(report.feedbackCoverage * 100) + '%')
        + stat('已标注 Recall',report.labeledRecallCount + ' / ' + threshold.minimumLabeledRecalls)
        + stat('真实检索缺失',report.retrievalMissRecordCount + ' / ' + threshold.minimumRetrievalMissRecords)
        + stat('当前建议',threshold.status) + '</div>'
        + '<div class="grid content-grid">'
        + '<div><h3>Retrieval miss</h3>' + list(report.retrievalMissMemoryIds)
        + '<h3>Ranking miss</h3>' + list(report.rankingMissMemoryIds) + '</div>'
        + '<div><h3>Budget miss</h3>' + list(report.budgetMissMemoryIds)
        + '<h3>Memory quality</h3>' + list(memoryQualityIds) + '</div></div>'
        + (report.unexplainedMissingMemoryIds.length ? '<details><summary>未解释的缺失</summary>' + list(report.unexplainedMissingMemoryIds) + '</details>' : '')
        + '</section>';
    }
    async function renderRecalls() {
      const [receipts,snapshot,quality] = await Promise.all([
        api('/api/recalls'),api('/api/memory'),api('/api/recall-quality')
      ]);
      state.recalls = receipts;
      state.memories = snapshot.memories;
      document.getElementById('recalls').innerHTML = renderRecallQuality(quality) + '<h2>召回审计 · 注入不等于使用成功</h2><p class="muted">只对用户明确评价的通用 Memory 召回进行标注；Research Context receipt 独立审计。</p>' + receipts.map(receipt => {
        const injected = receipt.injectedMemoryIds.map(id => {
          const memory = state.memories.find(item => item.id === id);
          const correct = memory?.status === 'active'
            ? '<button data-recall-correct-memory="' + escapeHtml(id) + '" data-recall-id="' + escapeHtml(receipt.id) + '">纠正此 Memory</button>'
            : '';
          return '<li><span>' + escapeHtml(recallMemoryLabel(id)) + '</span>' + (correct ? '<div class="actions">' + correct + '</div>' : '') + '</li>';
        }).join('') || '<li>无</li>';
        const dropped = receipt.dropped.map(item => '<li>' + escapeHtml(recallMemoryLabel(item.memoryId) + ' · ' + item.reason) + '</li>').join('') || '<li>无</li>';
        const feedback = receipt.feedback
          ? '<span class="badge ok">已标注 · ' + escapeHtml(receipt.feedback.outcome) + '</span><p>' + escapeHtml(receipt.feedback.reason) + '</p>'
          : '<div class="actions"><button data-recall-feedback="' + escapeHtml(receipt.id) + '">标注召回</button></div>';
        return '<article class="panel memory-card"><b>' + escapeHtml(receipt.createdAt) + '</b><div class="muted">任务：' + escapeHtml(receipt.taskId || '项目共享') + ' · 查询：' + escapeHtml(receipt.query || '默认召回') + '</div><p>候选 ' + receipt.candidateMemoryIds.length + ' · 完整注入 ' + receipt.injectedMemoryIds.length + ' · 省略 ' + receipt.dropped.length + ' · ' + receipt.characterCount + ' 字符</p><details><summary>Memory 明细</summary><h3>已注入</h3><ul>' + injected + '</ul><h3>已省略</h3><ul>' + dropped + '</ul></details>' + feedback + '<details><summary>查看完整回执</summary><pre>' + escapeHtml(JSON.stringify(receipt, null, 2)) + '</pre></details></article>';
      }).join('') + (!receipts.length ? '<div class="empty">暂无召回记录；界面预览不会生成记录</div>' : '');
    }
    function renderRecallMissingOptions(query) {
      const receipt = state.recallFeedbackEditing;
      const normalized = query.trim().toLowerCase();
      const eligible = state.memories.filter(memory => memory.status === 'active'
        && !receipt.injectedMemoryIds.includes(memory.id)
        && (!normalized || (memory.id + memory.title + memory.content).toLowerCase().includes(normalized)));
      document.getElementById('recall-missing-options').innerHTML = eligible.map(memory =>
        '<div class="recall-memory-row"><label><input type="checkbox" data-missing-memory="' + escapeHtml(memory.id) + '" ' + (state.recallMissingIds.has(memory.id) ? 'checked' : '') + '><span><b>' + escapeHtml(memory.title) + '</b><br><span class="muted">' + escapeHtml(memory.id) + '</span></span></label></div>'
      ).join('') || '<div class="empty">没有匹配的未注入 active Memory</div>';
    }
    function openRecallFeedback(recallId) {
      const receipt = state.recalls.find(item => item.id === recallId);
      if (!receipt || receipt.feedback) return;
      state.recallFeedbackEditing = receipt;
      state.recallMissingIds = new Set();
      document.getElementById('recall-feedback-preview').textContent = (receipt.query || '默认召回') + '\\n' + receipt.id;
      document.getElementById('recall-injected-options').innerHTML = receipt.injectedMemoryIds.map(id =>
        '<div class="recall-memory-row"><span>' + escapeHtml(recallMemoryLabel(id)) + '</span><select data-injected-memory="' + escapeHtml(id) + '"><option value="">未标注</option><option value="relevant">有用</option><option value="irrelevant">无关</option><option value="corrected">内容错误</option></select></div>'
      ).join('') || '<div class="empty">本次没有注入 Memory</div>';
      document.getElementById('recall-feedback-outcome').value = 'useful';
      document.getElementById('recall-feedback-reason').value = '';
      document.getElementById('recall-missing-filter').value = '';
      document.getElementById('recall-feedback-error').textContent = '';
      renderRecallMissingOptions('');
      document.getElementById('recall-feedback-editor').showModal();
    }
    async function renderJobs() {
      const [jobs, outbox] = await Promise.all([api('/api/jobs'), api('/api/outbox')]);
      const distill = jobs.map(job => '<article class="panel memory-card"><b>' + escapeHtml(job.status + ' · ' + job.threadId) + '</b><p>尝试 ' + job.attempts + ' / ' + job.maxAttempts + '</p><div class="muted">下次重试：' + escapeHtml(job.nextAttemptAt || '无') + '</div><p class="error">' + escapeHtml(job.lastError || '') + '</p>' + (job.status === 'failed' || (job.status === 'running' && Date.parse(job.updatedAt) <= Date.now() - 300000) ? '<div class="actions">' + actionButton('jobs', job.id, 'retry', '重新排队') + '</div>' : '') + '</article>').join('');
      const messages = outbox.map(item => '<article class="panel memory-card"><b>' + escapeHtml(item.status + ' · ' + item.topic) + '</b><p>尝试 ' + item.attempts + ' / ' + item.maxAttempts + '</p><div class="muted">可执行：' + escapeHtml(item.availableAt) + '</div><p class="error">' + escapeHtml(item.lastError || '') + '</p></article>').join('');
      document.getElementById('jobs').innerHTML = '<h2>后台任务</h2><p class="muted">Outbox 使用租约恢复；CLI outbox run --drain 处理事实提交后的可靠跟进。</p><h2>Domain Outbox</h2>' + (messages || '<div class="empty">暂无 Outbox 消息</div>') + '<h2>Distill Jobs</h2>' + (distill || '<div class="empty">暂无提炼任务</div>');
    }
    function openEditor(resource, id, action, context = {}) {
      state.editing = {resource,id,action,...context};
      const item = resource === 'memory'
        ? state.memories.find(memory => memory.id === id)
        : resource === 'candidates'
          ? state.candidates.find(candidate => candidate.id === id)
          : resource === 'research-claims'
            ? state.researchSnapshot?.claims.find(claim => claim.id === id)
            : resource === 'research-evidence'
              ? state.researchSnapshot?.evidence.find(evidence => evidence.id === id)
              : resource === 'research-snapshots'
                ? state.researchSnapshot?.snapshots.find(snapshot => snapshot.id === id)
              : null;
      document.getElementById('edit-title').textContent = ({
        correct:'纠正记忆', archive:'归档记忆', restore:'恢复记忆', accept:'批准候选',
        reject: resource === 'research-claims' ? '拒绝 Claim' : '拒绝候选',
        retry:'重新排队', approve:'批准 Claim', request_changes:'要求修改 Claim', stale:'标记 Evidence 过期', verify:'校验 Evidence'
      })[action];
      const preview = item
        ? (item.title || item.statement || item.sourceTitle || id) + '\\n' + (item.content || item.excerpt || '')
        : id;
      document.getElementById('edit-preview').textContent = preview
        + (context.recallId ? '\\n关联召回：' + context.recallId : '');
      document.getElementById('content-field').hidden = action !== 'correct';
      document.getElementById('replacement-field').hidden = action !== 'accept';
      const contradictions = resource === 'research-claims' && action === 'approve'
        ? (item?.links || []).filter(link => link.relation === 'contradicts')
          .filter(link => state.researchSnapshot?.evidence.find(evidence => evidence.id === link.evidenceId)?.state === 'current')
        : [];
      document.getElementById('contradictions-field').hidden = contradictions.length === 0;
      document.getElementById('edit-contradictions').value = contradictions.length
        ? JSON.stringify(contradictions.map(link => ({evidenceId:link.evidenceId,disposition:'requires_followup',rationale:''})), null, 2)
        : '';
      document.getElementById('reason-field').hidden = resource === 'jobs';
      const governedResearch = resource === 'research-claims'
        || (resource === 'research-evidence' && action === 'stale')
        || resource === 'research-snapshots';
      document.getElementById('reason-field').hidden = resource === 'jobs' || (resource === 'research-evidence' && action === 'verify');
      document.getElementById('edit-reason').required = governedResearch;
      document.getElementById('reason-field').childNodes[0].nodeValue = governedResearch ? '操作原因（必填）' : '操作原因（可选）';
      document.getElementById('edit-content').value = item?.content || '';
      document.getElementById('edit-content').required = action === 'correct';
      document.getElementById('edit-reason').value = '';
      document.getElementById('edit-replacement').value = '';
      document.getElementById('edit-error').textContent = '';
      document.getElementById('editor').showModal();
    }
    async function show(view) {
      document.querySelectorAll('.view').forEach((node) => node.classList.toggle('active', node.id === view));
      document.querySelectorAll('.nav button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
      if (view === 'threads') await renderThreads();
      if (view === 'runs') await renderRuns();
      if (view === 'briefing') await renderBriefing();
      if (view === 'memory') await renderMemory();
      if (view === 'candidates') await renderCandidates();
      if (view === 'research') await renderResearch();
      if (view === 'recalls') await renderRecalls();
      if (view === 'jobs') await renderJobs();
      if (view === 'overview') { state.overview = await api('/api/overview'); renderOverview(); }
    }
    document.addEventListener('click', async (event) => {
      try {
      const nav = event.target.closest('[data-view]');
      if (nav) await show(nav.dataset.view);
      const thread = event.target.closest('[data-thread-id]');
      if (thread) await loadThread(thread.dataset.threadId);
      const openThread = event.target.closest('[data-open-thread]');
      if (openThread) { state.selectedThreadId = openThread.dataset.openThread; await show('threads'); }
      const researchCase = event.target.closest('[data-research-case]');
      if (researchCase) await loadResearchCase(researchCase.dataset.researchCase);
      const recallFeedback = event.target.closest('[data-recall-feedback]');
      if (recallFeedback) openRecallFeedback(recallFeedback.dataset.recallFeedback);
      const recallCorrection = event.target.closest('[data-recall-correct-memory]');
      if (recallCorrection) openEditor('memory',recallCorrection.dataset.recallCorrectMemory,'correct',{
        recallId:recallCorrection.dataset.recallId,returnView:'recalls'
      });
      const action = event.target.closest('[data-action]');
      if (action?.dataset.action === 'history') {
        const history = await api('/api/memory/' + encodeURIComponent(action.dataset.id) + '/history');
        document.getElementById('memory-history').innerHTML = '<h2>记忆历史</h2><pre>' + escapeHtml(JSON.stringify(history, null, 2)) + '</pre>';
        document.getElementById('memory-history').scrollIntoView({block:'nearest'});
      } else if (action) openEditor(action.dataset.resource, action.dataset.id, action.dataset.action);
      } catch (error) { document.getElementById('feedback').textContent = error.message; }
    });
    document.getElementById('recall-missing-filter').addEventListener('input', event => renderRecallMissingOptions(event.target.value));
    document.getElementById('recall-missing-options').addEventListener('change', event => {
      const id = event.target.dataset.missingMemory;
      if (!id) return;
      if (event.target.checked) state.recallMissingIds.add(id);
      else state.recallMissingIds.delete(id);
    });
    document.getElementById('recall-feedback-cancel').addEventListener('click', () => document.getElementById('recall-feedback-editor').close());
    document.getElementById('recall-feedback-form').addEventListener('submit', async event => {
      event.preventDefault();
      const button = event.target.querySelector('[type=submit]');
      button.disabled = true;
      try {
        const groups = {relevantMemoryIds:[],irrelevantMemoryIds:[],correctedMemoryIds:[]};
        document.querySelectorAll('[data-injected-memory]').forEach(select => {
          if (select.value === 'relevant') groups.relevantMemoryIds.push(select.dataset.injectedMemory);
          if (select.value === 'irrelevant') groups.irrelevantMemoryIds.push(select.dataset.injectedMemory);
          if (select.value === 'corrected') groups.correctedMemoryIds.push(select.dataset.injectedMemory);
        });
        await api('/api/recall-feedback/' + encodeURIComponent(state.recallFeedbackEditing.id), {
          outcome:document.getElementById('recall-feedback-outcome').value,
          ...groups,
          missingMemoryIds:[...state.recallMissingIds],
          reason:document.getElementById('recall-feedback-reason').value
        });
        document.getElementById('recall-feedback-editor').close();
        document.getElementById('feedback').textContent = '召回标注已保存；不会自动修改检索配置。';
        await renderRecalls();
      } catch (error) { document.getElementById('recall-feedback-error').textContent = error.message; }
      finally { button.disabled = false; }
    });
    document.getElementById('edit-cancel').addEventListener('click', () => document.getElementById('editor').close());
    document.getElementById('edit-form').addEventListener('submit', async event => {
      event.preventDefault();
      const button = event.target.querySelector('[type=submit]');
      button.disabled = true;
      try {
        const {resource,id,action,recallId,returnView} = state.editing;
        const body = resource === 'candidates' || resource === 'research-claims'
          ? {decision: action}
          : {action};
        if (resource === 'research-evidence' && action === 'verify') body.caseId = state.selectedResearchCaseId;
        const reason = document.getElementById('edit-reason').value.trim();
        if (reason && resource !== 'jobs') body.reason = reason;
        if (action === 'correct') {
          body.content = document.getElementById('edit-content').value;
          if (recallId) body.recallId = recallId;
        }
        const replacement = document.getElementById('edit-replacement').value.trim();
        if (action === 'accept' && replacement) body.supersedesMemoryId = replacement;
        const contradictions = document.getElementById('edit-contradictions').value.trim();
        if (resource === 'research-claims' && action === 'approve' && contradictions) {
          body.contradictionDispositions = JSON.parse(contradictions);
        }
        await api('/api/' + resource + '/' + encodeURIComponent(id), body);
        document.getElementById('editor').close();
        document.getElementById('feedback').textContent = '已保存；历史记录保留。';
        await show(returnView || (resource.startsWith('research-') ? 'research' : resource));
      } catch (error) { document.getElementById('edit-error').textContent = error.message; }
      finally { button.disabled = false; }
    });
    async function boot() {
      try {
        const [overview, threads, session] = await Promise.all([api('/api/overview'), api('/api/threads'), api('/api/session')]);
        state.csrfToken = session.csrfToken;
        state.overview = overview;
        state.threads = threads;
        renderShell(overview);
        renderOverview();
      } catch (error) {
        document.querySelector('.main').innerHTML = \`<div class="panel error">\${escapeHtml(error.message)}</div>\`;
      }
    }
    boot();
  </script>
</body>
</html>`;
}

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, "application/json; charset=utf-8", `${JSON.stringify(body ?? null)}\n`);
}

async function withProject<T>(options: Required<ViewerServerOptions>, run: (input: {
  db: ReturnType<typeof openDatabase>;
  project: ReturnType<typeof ensureProjectForRoot>;
}) => T | Promise<T>): Promise<T> {
  const db = openDatabase(options.dbPath);
  try {
    migrate(db);
    const project = ensureProjectForRoot(db, options.projectRoot);
    return await run({ db, project });
  } finally {
    db.close();
  }
}

async function routeRequest(
  options: RuntimeOptions,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.headers.host !== options.authority) {
    sendJson(res, 403, {error: "Host not allowed"}); return;
  }
  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const url = new URL(req.url ?? "/", options.origin);
  const pathname = url.pathname;
  if (req.method === "POST") {
    if (req.headers.origin !== options.origin || req.headers["x-mira-csrf"] !== options.csrfToken) {
      sendJson(res, 403, {error: "Same-origin confirmation token required"}); return;
    }
    if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
      sendJson(res, 415, {error: "JSON required"}); return;
    }
    const lifecycleMatch = pathname.match(/^\/api\/turn\/(before|after)$/);
    const actionMatch = pathname.match(/^\/api\/(memory|candidates|jobs|recall-feedback|research-claims|research-evidence|research-snapshots)\/([^/]+)$/);
    if (!lifecycleMatch && !actionMatch) { sendJson(res, 404, {error: "Not found"}); return; }
    if (Number(req.headers["content-length"] ?? 0) > 65_536) { sendJson(res, 413, {error: "Body too large"}); return; }
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65_536) { sendJson(res, 413, {error: "Body too large"}); return; }
        chunks.push(Buffer.from(chunk));
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const result = await withProject(options, ({db, project}) => {
        if (lifecycleMatch) {
          const registry = createHostAdapterRegistry();
          const lifecycle = createTurnLifecycle({db, projectId: project.id});
          return lifecycleMatch[1] === "before"
            ? lifecycle.beforeTurn(registry.normalizeBeforeTurn("ui", body, "ui"))
            : lifecycle.afterTurn(registry.normalizeAfterTurn("ui", body, "ui"));
        }
        return applyViewerAction(
          db,
          project.id,
          actionMatch![1],
          decodeURIComponent(actionMatch![2]),
          body
        );
      });
      sendJson(res, 200, result);
    } catch (error) { sendJson(res, 400, {error: sanitizeDistillError(error)}); }
    return;
  }
  if (pathname === "/api/session") { sendJson(res, 200, {csrfToken: options.csrfToken}); return; }
  if (pathname === "/api/hosts") { sendJson(res, 200, createHostAdapterRegistry().list()); return; }
  if (pathname === "/" || pathname === "/index.html") {
    send(res, 200, "text/html; charset=utf-8", dashboardHtml());
    return;
  }

  await withProject(options, async ({ db, project }) => {
    if (pathname === "/api/candidates") { sendJson(res, 200, listMemoryCandidates(db, project.id, undefined, 100)); return; }
    if (pathname === "/api/recalls") { sendJson(res, 200, listViewerRecallEntries(db, project.id, url.searchParams.get("taskId") ?? undefined)); return; }
    if (pathname === "/api/recall-quality") { sendJson(res, 200, getRecallQualityReport(db, project.id)); return; }
    if (pathname === "/api/jobs") { sendJson(res, 200, listDistillJobs(db, project.id)); return; }
    if (pathname === "/api/outbox") { sendJson(res, 200, listOutboxMessages(db, project.id)); return; }
    if (pathname === "/api/research-cases") {
      sendJson(res, 200, listViewerResearchCases(db, project.id)); return;
    }
    const researchExportMatch = pathname.match(/^\/api\/research-cases\/([^/]+)\/export$/);
    if (researchExportMatch) {
      const snapshot = getViewerResearchCase(db, project.id, decodeURIComponent(researchExportMatch[1]));
      sendJson(res, 200, {markdown: renderResearchCaseMarkdown(snapshot)}); return;
    }
    const researchContextMatch = pathname.match(/^\/api\/research-cases\/([^/]+)\/context$/);
    if (researchContextMatch) {
      sendJson(res, 200, getViewerResearchContext(db, project.id, decodeURIComponent(researchContextMatch[1]))); return;
    }
    const researchCaseMatch = pathname.match(/^\/api\/research-cases\/([^/]+)$/);
    if (researchCaseMatch) {
      sendJson(res, 200, getViewerResearchCase(db, project.id, decodeURIComponent(researchCaseMatch[1]))); return;
    }
    if (pathname.startsWith("/api/memory/") && pathname.endsWith("/history")) {
      const id = decodeURIComponent(pathname.slice("/api/memory/".length, -"/history".length));
      sendJson(res, 200, getMemoryHistory(db, project.id, id)); return;
    }
    if (pathname === "/api/overview") {
      sendJson(res, 200, await getViewerOverview({ db, project, projectRoot: options.projectRoot, dbPath: options.dbPath }));
      return;
    }
    if (pathname === "/api/threads") {
      sendJson(res, 200, listViewerThreads(db, project.id));
      return;
    }
    if (pathname.startsWith("/api/threads/")) {
      const id = decodeURIComponent(pathname.slice("/api/threads/".length));
      const thread = getViewerThread(db, project.id, id);
      if (!thread) sendJson(res, 404, { error: "Thread not found" });
      else sendJson(res, 200, thread);
      return;
    }
    if (pathname === "/api/import-runs") {
      sendJson(res, 200, listViewerImportRuns(db, project.id));
      return;
    }
    if (pathname === "/api/briefing") {
      sendJson(res, 200, getViewerBriefing(db, project.id));
      return;
    }
    if (pathname === "/api/context-bundle") {
      sendJson(res, 200, { markdown: getViewerContextBundle(db, project.id) });
      return;
    }
    if (pathname === "/api/memory") {
      sendJson(res, 200, getViewerMemorySnapshot(db, project.id));
      return;
    }
    sendJson(res, 404, { error: "Not found" });
  });
}

export async function startViewerServer(options: ViewerServerOptions): Promise<ViewerServerHandle> {
  const required: RuntimeOptions = {
    projectRoot: resolve(options.projectRoot),
    dbPath: resolve(options.dbPath),
    host: options.host ?? "127.0.0.1",
    port: options.port ?? 4317,
    csrfToken: randomBytes(32).toString("hex"), origin: "", authority: ""
  };
  if (!["127.0.0.1", "localhost", "::1"].includes(required.host)) throw new Error("Mira UI is loopback-only; remote binding requires authentication");
  const server = createServer((req, res) => {
    routeRequest(required, req, res).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) sendJson(res, 500, { error: message });
      else res.end();
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(required.port, required.host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : required.port;
  const hostForUrl = required.host === "::1" ? "[::1]" : required.host;
  required.port = port;
  required.authority = `${hostForUrl}:${port}`;
  required.origin = `http://${required.authority}`;
  return {
    server,
    host: required.host,
    port,
    url: `http://${hostForUrl}:${port}`,
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    })
  };
}
