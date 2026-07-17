# Mira Agent Context

Last updated: 2026-07-17

本文件是开发 Agent 接手 Mira 时的项目入口卡片。Mira 是面向 Codex、Claude Code 等编程 Agent 的本地优先项目记忆层，不是通用 AI 工作台。

## 当前状态

- MVP 的 Thread、Memory、Working Memory、Context Bundle、CLI、导出和 MCP 闭环已完成。
- Codex / Claude Code Markdown 与 JSONL transcript 导入已完成。
- 可审查的 LLM distill candidate 工作流已完成。
- 多轮审计修复已完成，Phase 0 FTS/搜索基线已收口。
- Phase 1 项目级自动接入已实现：SessionStart 注入上下文，Stop/SessionEnd 捕获真实 transcript。
- 自动捕获使用 schema v2 持久化检查点；未变化跳过，失败不推进。
- Phase 2 自动可信提炼尚未实现，Hook 当前不会自动改写长期 Memory 或 Working Memory。

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
src/distill/            deterministic / reviewed LLM distill
src/importers/          Markdown / JSONL importer
src/integrations/       Hook、安装器、捕获检查点
src/mcp/                MCP tools 与 stdio transport
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

### 配置安装

- `integration install` 原子合并用户配置，重复执行幂等。
- 同名非 Mira MCP 配置视为冲突，不覆盖。
- `.git/info/exclude` 只管理 Mira 标记块，不改团队 `.gitignore`。
- `integration uninstall` 只移除 Mira 管理内容，不删除数据库。

### 记忆边界

- Hook 当前自动保存 Thread，不自动把 transcript 结论写成长期 Memory。
- 稳定决策、失败经验和当前状态仍由 Agent 通过 MCP 主动维护。
- `save_thread` 是手动摘要兜底，不应重复保存 Hook 已捕获的完整 transcript。
- Phase 2 才引入候选生成、审查、去重和受控写回。

## 开发节奏

```text
SDD：先更新目标、边界、数据模型、CLI/MCP 契约和验收标准。
TDD：写失败测试，确认 RED；最小实现到 GREEN；再重构和扩大验证。
```

更改数据契约时同步 schema、store、CLI/MCP、文档与迁移测试。完成前至少执行相关定向测试、`npm test`、`npm run build` 和 `git diff --check`。

## 下一阶段

Phase 2：自动可信提炼。目标是从自动捕获的 Thread 生成结构化 Memory 候选，通过明确的置信度、来源、去重和审查门禁受控写回，并安全更新 Working Memory。
