# Phase 5：Obsidian-ready Markdown Vault 规格

状态：Approved
日期：2026-07-17

## 目标

把 Mira SQLite 中的 Project Briefing、Working Memory、Memory、Thread 和待审核候选物化为可直接用 Obsidian 浏览的 Markdown Vault，同时维持 SQLite 作为唯一事实源。

## 用户故事

1. 用户运行 `mira vault sync` 后，可以在 `.mira/vault/` 中浏览项目上下文。
2. 用户可通过 WikiLink 从 Memory 追溯 Thread、前驱与后继记忆。
3. 同一数据库状态重复同步，得到完全相同的文件集合与内容。
4. 同步中途失败时，已有 Vault 不被部分结果覆盖。

## 功能要求

- 输出 `index.md`、`project-briefing.md`、`working-memory.md`、`memories/*.md`、`threads/*.md` 和 `reviews/pending-candidates.md`。
- Memory frontmatter 包含 `kind`、`status`、`confidence`、`importance`、`source`、`thread`、`supersedes`、`created_at`、`updated_at`。
- Thread 与候选证据可从 Markdown 中追溯，Memory 前驱/后继关系使用 WikiLink。
- 文件名基于稳定 ID；不可信 ID 必须编码为单一路径组件，不能越出 Vault。
- `mira vault sync [--out <path>]` 执行完整重建并输出同步摘要。
- 先写同级 staging 目录，全部成功后替换目标；失败时恢复旧目录并清理临时目录。
- 输出不写入“本次生成时间”等易变数据。

## 非目标

- 不解析或回写用户对 Vault 的编辑。
- 不做增量同步、冲突合并、Web UI、向量检索或云同步。

## 验收标准

- Core 渲染、文件系统同步与 CLI 均有自动化测试。
- 确定性、路径安全、空数据、全生命周期 Memory、待审核候选和失败恢复均被覆盖。
- `npm test`、`npm run build`、`git diff --check` 通过。
