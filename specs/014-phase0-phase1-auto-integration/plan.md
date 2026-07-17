# Phase 0/1 自动接入实施计划

状态：完成

> 给后续 Agent：按任务逐项执行，并使用 checkbox 记录经过测试验证的进度。实现优先采用 SDD + TDD，完成声明前执行完整验证。

## 目标

完成 Phase 0 工程基线收口，并为 Codex 与 Claude Code 提供项目级、幂等的自动会话接入：会话开始读取 Mira，上下文结束自动捕获真实 transcript，同时保留 MCP 主动读写能力。

## 架构

集成能力拆分为三条清晰路径：

1. `configInstaller` 负责合并、状态检查和卸载项目配置。
2. `hookRuntime` 负责 Hook 输入校验、SessionStart 上下文输出和 Stop/SessionEnd 捕获。
3. 现有 importer、Thread Store、Context Bundle 和 MCP Server 继续作为核心能力，不引入 watcher、后台服务或外部 LLM。

自动捕获使用 SQLite schema v2 的 `integration_cursors` 持久化文件指纹。成功保存 Thread 后才推进检查点；未变化 transcript 直接跳过，失败由后续 Hook 自然重试。

## 技术栈

- TypeScript / Node.js filesystem APIs
- better-sqlite3 / SQLite FTS5
- Commander / Zod
- Vitest
- Codex 与 Claude Code 项目 Hook
- stdio MCP

## 文件映射

- `src/db/client.ts`：SQLite recursive triggers 等运行参数。
- `src/db/schema.ts`：schema v2 与 `integration_cursors`。
- `src/memory/memoryStore.ts`：默认 OR 与显式 phrase 查询模式。
- `src/mcp/server.ts`：MCP `search_memory.queryMode` 契约。
- `src/importers/agentSessionImporter.ts`：真实 Codex / Claude Code JSONL envelope 归一化。
- `src/integrations/configInstaller.ts`：JSON/TOML 原子合并、卸载与 Git 本地排除。
- `src/integrations/captureCursorStore.ts`：持久化捕获检查点。
- `src/integrations/hookRuntime.ts`：SessionStart、Stop、SessionEnd 调度和安全诊断。
- `src/index.ts`：integration CLI 与 Hook stdin/stdout 接线。
- `tests/integrations/*.test.ts`：安装器与 Hook 运行时测试。
- `tests/cli/integration-cli.test.ts`：spawned CLI 端到端闭环。
- `README.md`、`docs/agent-config/automatic-integration.md`、`.agents/progress.md`：用户和 Agent 文档。

## 任务 1：Phase 0 FTS 完整性

- [x] 添加 Project / Thread 级联删除后 `memory_fts` 无孤儿记录的失败测试。
- [x] 在 `openDatabase` 启用 `recursive_triggers`。
- [x] 验证数据库、Project 和 Thread 回归测试。

## 任务 2：Phase 0 搜索语义

- [x] 添加默认多关键词 OR、显式 phrase 精确匹配测试。
- [x] 添加 MCP `queryMode` schema 与调用测试。
- [x] Core 和 MCP 默认改为 `orTerms`，Context Bundle 保留 phrase 优先、OR 回退。

## 任务 3：项目配置安装器

- [x] 覆盖 Codex / Claude Code 创建、合并、幂等、dry-run、冲突和卸载测试。
- [x] 使用原子 JSON 写入和 Codex TOML 托管块。
- [x] 生成绝对 Node 与 Mira CLI 路径，不依赖 IDE 的 `PATH`。
- [x] 使用 `.git/info/exclude` 托管块防止本机配置误提交。

## 任务 4：Hook 与 transcript 捕获

- [x] 覆盖 SessionStart、稳定 Thread、路径拒绝、非阻塞失败和安全日志。
- [x] 支持当前 Codex 与 Claude Code JSONL envelope。
- [x] Codex Stop 与 Claude Code Stop/SessionEnd 捕获主 transcript。
- [x] 增加持久化检查点、未变化跳过和失败重试。

## 任务 5：CLI 接入

- [x] 增加 `integration install/status/uninstall/hook`。
- [x] 支持 `--agent codex|claude-code|all` 和 `--dry-run`。
- [x] 验证 Hook stdin、纯 stdout Context Bundle 和脚本友好 JSON 输出。
- [x] 端到端覆盖 install -> start -> capture -> Thread -> uninstall。

## 任务 6：文档与最终验证

- [x] 更新 README、自动接入指南、Agent context、进度记录和审计索引。
- [x] Phase 0/1 定向测试通过：11 个测试文件，83 项测试。
- [x] 完整 `npm test` 通过。
- [x] `npm run build` 通过。
- [x] 在真实 Mira 项目执行 dry-run、安装、状态和 Hook smoke test。
- [x] 检查 `git status`、`git diff --check` 与需求到证据映射。
