# Mira Agent Context

Last updated: 2026-07-20

本文件是开发 Agent 接手 Mira 时的项目入口卡片。Mira 是面向 Codex、Claude Code 等编程 Agent 的本地优先项目记忆层，不是通用 AI 工作台。

## 当前状态

- MVP 的 Thread、Memory、Working Memory、Context Bundle、CLI、导出和 MCP 闭环已完成。
- Codex / Claude Code Markdown 与 JSONL transcript 导入已完成。
- 可审查的 LLM distill candidate 工作流已完成。
- 多轮审计修复已完成，Phase 0 FTS/搜索基线已收口。
- Phase 1 项目级自动接入已实现：SessionStart 注入上下文，Stop/SessionEnd 捕获真实 transcript。
- 自动捕获使用 schema v2 持久化检查点；未变化跳过，失败不推进。
- Phase 2 可信自动提炼、Phase 3 Memory 生命周期、Phase 4 Project Briefing 与 Phase 5 Markdown Vault 均已实现并验证。
- 当前项目历史会话批量导入已实现：支持 Codex/Claude Code 扫描、旧根路径别名、幂等分类、schema v6 审计、dry-run、失败查询和可选提炼入队。
- 可安装的投资研究 domain skill 已实现：Evidence → Claim → Review 运行配置位于核心记忆层之上，投资主张与 thesis 状态不由 Mira 自动修改。

## 事实源

按以下顺序读取：

1. `specs/014-phase0-phase1-auto-integration/spec.md`
2. `specs/014-phase0-phase1-auto-integration/tasks.md`
3. `.agents/progress.md`
4. `README.md`
5. `.agents/development-rhythm.md`
6. `specs/001-mira-mvp/spec.md`
7. `docs/agent-config/automatic-integration.md`
8. `docs/agent-config/AGENTS-template.md`

规格、任务和代码不一致时，先确认最新规格，再按 SDD + TDD 修正实现和文档。

## 常用命令

```bash
git -C /Users/limaolin/Desktop/Mira status --short
npm run dev -- health
npm test
npm run build

node dist/src/index.js --project-root /Users/limaolin/Desktop/Mira integration install --agent all --dry-run
node dist/src/index.js --project-root /Users/limaolin/Desktop/Mira integration status
```

全局 `--project-root` 与 `--db` 必须位于子命令前。

## 当前架构

```text
Codex / Claude Code
  -> project SessionStart Hook
  -> Mira Context Bundle stdout

Codex Stop / Claude Stop + SessionEnd
  -> Hook input validation
  -> transcript path + cwd guard
  -> persisted capture cursor
  -> JSONL importer
  -> stable Thread upsert

Agent MCP calls
  -> project-bound stdio server
  -> Working Memory / Memory / Thread stores
  -> SQLite + FTS5
```

关键目录：

```text
src/db/                 SQLite client 与 schema
src/projects/           项目探测与 Project Store
src/threads/            Thread Store
src/memory/             Memory Store 与 FTS 搜索
src/workingMemory/      Working Memory
src/context/            Context Bundle
src/briefing/           Project Briefing
src/distill/            deterministic / reviewed LLM distill
src/vault/              Obsidian-ready Markdown Vault
src/importers/          Markdown / JSONL importer
src/integrations/       Hook、安装器、捕获检查点
src/history/            历史扫描、项目匹配、批量导入、审计与报告
src/mcp/                MCP tools 与 stdio transport
src/evaluation/         可重复质量基线
skills/                 可安装的领域 skill 与 agent runtime profile
tests/                  单元、集成和 CLI 端到端测试
specs/                  SDD 规格、计划和任务证据
```

## 关键契约

### 项目解析

- 显式 `--project-root` 优先，否则从 cwd 向上探测 Git 根目录。
- Project 不存在时按根目录自动创建，名称使用目录名。
- 默认数据库是 `<project>/.mira/mira.sqlite`。

### 搜索

- `searchMemories` 默认 `orTerms`，可显式使用 `phrase`。
- FTS 同时搜索 title 与 content。
- 返回 `{ memory, score }`，score 越高越相关。
- Context Bundle 使用 phrase 优先、OR 回退，并严格执行字符预算。

### 自动捕获

- Codex：`SessionStart` + `Stop`。
- Claude Code：`SessionStart` + `Stop` + `SessionEnd`。
- 只读取 Hook 明确提供的主 `.jsonl` transcript，不扫描子 Agent 目录。
- Hook cwd 必须位于绑定项目，transcript 必须位于 Agent 官方会话目录。
- Thread ID 为 `thread_<agent-slug>_<session-id-slug>`。
- `integration_cursors` 以 project + agent + session 为唯一键。
- 捕获失败默认不阻塞宿主 Agent，日志不含 transcript 正文。

### 历史批量导入

- `history import` 只导入当前根目录和显式 `--root-alias` 对应的主会话。
- Codex 包含 sessions 与 archived_sessions；Claude Code 只扫描项目目录直接子文件，排除 subagents 与越界符号链接。
- 历史导入与 Hook 共享 `stableThreadId`，同一 Agent session 落到同一 Thread。
- 正式导入在 schema v6 中记录 run/item 审计；单文件失败继续，失败原因脱敏并限长。
- `--distill` 只为 imported/updated Thread 入队；`--dry-run` 不写 Thread、cursor、job 或 audit，首次运行不创建数据库。

### 配置安装

- `integration install` 原子合并用户配置，重复执行幂等。
- 同名非 Mira MCP 配置视为冲突，不覆盖。
- `.git/info/exclude` 只管理 Mira 标记块，不改团队 `.gitignore`。
- `integration uninstall` 只移除 Mira 管理内容，不删除数据库。

### 记忆边界

- Hook 自动保存 Thread；配置 Provider 后会异步生成证据绑定候选，只有高置信低风险候选自动接受。
- 高影响、低置信或冲突候选进入审核队列，稳定决策和当前状态仍可由 Agent 通过 MCP 主动维护。
- `save_thread` 是手动摘要兜底，不应重复保存 Hook 已捕获的完整 transcript。
- Markdown Vault 是 SQLite 的单向物化视图，不解析或回写人工编辑。
- 投资研究 skill 只编排证据账本、主张审核与 candidate 提交；确认写入沿用 Mira 权限，thesis 状态由核心外领域协议持有。

## 开发节奏

```text
SDD：先更新目标、边界、数据模型、CLI/MCP 契约和验收标准。
TDD：写失败测试，确认 RED；最小实现到 GREEN；再重构和扩大验证。
```

更改数据契约时同步 schema、store、CLI/MCP、文档与迁移测试。完成前至少执行相关定向测试、`npm test`、`npm run build` 和 `git diff --check`。

## 下一阶段

下一阶段用 20 题基线和真实 recall audit 样本验证语义召回或重排方案，优先解决当前 5 个语义改写未命中；继续观察候选准确率、Briefing 可读性、Vault 审核效率和 Context 预算命中率。
