# Phase 4 主动 Project Briefing 规格

Feature ID: `017-project-briefing`
Status: Complete

## 目标

把 Working Memory、active Memory 与 Thread provenance 组织成可版本化、可追溯、可自动更新的项目简报。Briefing 是 SQLite 事实的派生 Markdown 快照，不是新的事实源；Context Bundle 在固定预算内优先提供当前工作状态和最新可用 Briefing。

## 数据模型

SQLite schema 升级到 v5，新增 `project_briefings`：

- `id`, `project_id`, `version`：同一 Project 的版本从 1 单调递增且唯一。
- `markdown`：完整派生快照；failed 版本为空字符串。
- `source_memory_ids`, `source_thread_ids`, `source_working_memory_ids`：JSON array，保留生成证据集合。
- `generation_method`：MVP 固定为 `deterministic`。
- `character_count`, `estimated_tokens`：字符数和 `ceil(characters / 4)` 的稳定 Token 估算。
- `status`：`complete | failed`。
- `stale_at`：complete 快照过期时间，可空；过期快照仍可作为失败回退。
- `error`：failed 版本的简短错误信息，可空。
- `created_at`。

Memory insert/update/delete 与 Working Memory insert/update/delete 通过数据库 trigger 将现有 complete Briefing 标记 stale。读取、Thread 保存和 Briefing 自身写入不触发失效。

## 确定性内容

Briefing 固定包含以下可用小节，空小节不输出：

1. Current Goal：`current_task`。
2. Current Phase：`current_phase`。
3. Recent Decisions：Working Memory 的 `recent_decision/decision` 与 active Memory 的 `decision/architecture`。
4. Known Constraints：active `constraint`。
5. Blockers：Working Memory `blocker`。
6. Lessons and Failed Attempts：active `lesson/failed_attempt`。
7. Open Questions and Notes：Working Memory `note`。
8. Next Actions：Working Memory `next_step` 与 active `task/todo`。

每个条目必须带稳定来源标记：`[working:<id>]`、`[memory:<id>]`，有 Thread 的 Memory 追加 `[thread:<id>]`。同一数据库状态重复生成的正文内容和来源顺序必须一致。

## 重建与回退

- `rebuildProjectBriefing` 生成下一个 complete 版本，不修改旧快照。
- `ensureFreshProjectBriefing` 在没有 complete 快照或最新 complete 已 stale 时执行一次重建。
- 重建失败时写入 failed 版本，并返回上一个 complete 快照；没有回退快照时返回 undefined。
- SessionStart 与 `buildContextBundle` 使用 `ensureFreshProjectBriefing`，本地确定性重建不得依赖网络。
- CLI/MCP 可显式读取和重建；history 同时显示 complete、stale 与 failed 版本。

## Context Planner

Context Bundle 预算顺序固定为：

1. 高优先级 Working Memory。
2. 最新可用 Project Briefing。
3. active Warning Memory：`constraint/lesson/failed_attempt`。
4. query 相关或 top-N active Memory。

支持 `maxCharacters` 与 `maxTokens`。MVP 使用 `maxTokens * 4` 转换为字符预算，两个参数同时存在时取更严格值。Briefing 若整体放不下则省略并给出预算提示，不截断中间条目。

## CLI

```text
mira briefing show
mira briefing rebuild
mira briefing history [--limit 20]
mira context bundle [--max-tokens 1000]
```

CLI 固定输出 JSON；Context Bundle 仍输出 Markdown。

## MCP

新增：`get_project_briefing`、`rebuild_project_briefing`。

`get_context_bundle` 增加可选 `maxTokens`，范围 25 到 250000。MCP Server 继续绑定单 Project。

## 非目标

- 不调用 LLM，不做自由文本总结。
- 不自动删除过期 blocker/next_step，只在 stale Briefing 中显示过期提示。
- 不做定时常驻进程；重建是 SessionStart、CLI 或 MCP 触发的一次性本地任务。
- 不实现 Vault 文件输出；属于 Phase 5。

## 验收标准

1. v4 数据库无损升级 v5，v4 Memory/FTS 不被重建。
2. Briefing 版本、来源 ID、字符/Token 估算与 Markdown 内容可审计且确定。
3. Memory/Working Memory 变化标记 complete Briefing stale；只读操作不失效。
4. 缺失或 stale 时自动重建；失败时保留并返回最后 complete 快照。
5. Context 顺序为 Working Memory -> Briefing -> Warning -> relevant Memory，并同时遵守字符/Token 预算。
6. CLI 与 MCP 覆盖读取、重建和历史/预算边界。
7. 完整测试、构建、diff 检查和独立代码审查通过。
