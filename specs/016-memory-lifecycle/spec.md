# Phase 3 记忆生命周期与证据链规格

Feature ID: `016-memory-lifecycle`
Status: Complete

## 目标

让 Mira 的长期 Memory 从“可写入的搜索记录”升级为可演变、可追溯的项目事实。Memory 内容不得原地覆盖；更新创建 successor，旧 Memory 保留为 superseded。归档、恢复、候选替代和所有状态变化都必须进入事件账本。

## 数据模型

SQLite schema 升级到 v4。

Memory 新增：

- `status`: `active | superseded | archived | rejected`，既有记录迁移为 active。
- `supersedes_memory_id`: predecessor Memory，可空；一个 Memory 最多有一个直接 successor。
- `updated_at`: 最近生命周期变化时间，既有记录使用 `created_at`。

新增 `memory_events`：

- `id`, `memory_id`, `project_id`。
- `event_type`: `accepted | updated | superseded | archived | rejected | restored`。
- `actor`: 发起者，如 `manual`、`cli`、`mcp`、`candidate:<id>`。
- `reason`: 可选说明，最大 1000 字符。
- `metadata`: JSON object 字符串，不允许非法 JSON。
- `created_at`。

## 状态机

- 新 Memory 默认 `active` 并产生 `accepted` 事件。
- `update(active)`：创建 active successor；predecessor 原子转为 superseded；分别产生 `updated` 与 `superseded` 事件。
- `archive(active)`：转为 archived 并产生 archived 事件。
- `restore(archived)`：仅当不存在 active successor 时恢复 active，并产生 restored 事件。
- superseded Memory 不能归档、恢复或再次更新。
- archived Memory 必须先 restore 才能 update。
- rejected 状态保留给明确的事实否决，不在本阶段开放通用 CLI 写入。
- 硬删除只用于明确隐私删除，现有 delete API 保留但不能替代 archive；Project、Thread 和 Memory 的 CLI 删除入口必须显式传入 `--confirm-hard-delete`。

## 不可变更新

- `memory update` 必须提供与 predecessor 不同的非空 content。
- title、kind、confidence、importance 未传时继承 predecessor。
- successor 继承 project、thread 和 source，调用方可显式提供新的 source/actor/reason。
- 同一 predecessor 只能创建一个 successor；重复/并发更新必须失败，不得分叉。
- 整个 successor insert、predecessor 状态变化和两个事件必须在一个事务内完成。

## 检索与历史

- FTS、`searchMemories`、top memories、Context Bundle 和默认 Memory list 只返回 active。
- status 从 active 变化时立即移出 FTS；restore 后重新进入 FTS。
- `getMemoryHistory` 从链根按 predecessor -> successor 返回完整线性历史，包括非 active 状态和每条事件。
- `getMemory` 可按 ID读取任意状态，供审计和历史入口使用。

## 候选冲突处理

待审候选支持：

- `reject`：拒绝候选，不创建 Memory。
- `accept`：作为独立 Memory 接受，保留现有行为。
- `accept --supersedes <memory-id>`：以候选内容创建 successor，并 supersede 指定 active Memory。

候选替代必须满足项目一致、目标 active、候选 Thread 版本仍有效，并把 successor ID 写入 `accepted_memory_id`。

## CLI

```text
mira memory get --id <memory-id>
mira memory update --id <memory-id> --content <content> [--title ...] [--kind ...] [--reason ...]
mira memory archive --id <memory-id> [--reason ...]
mira memory restore --id <memory-id> [--reason ...]
mira memory history --id <memory-id>
mira memory candidate review --id <candidate-id> --decision accept [--supersedes <memory-id>]
```

CLI 固定输出 JSON，所有枚举、分数、长度在 Store 前验证。

## MCP

新增：`get_memory`、`update_memory`、`archive_memory`、`get_memory_history`。

`review_memory_candidate` 增加可选 `supersedesMemoryId`。MCP Server 继续绑定单项目，不接收 projectRoot。

## 非目标

- 不做自动时间衰减、自动归档或模型自动判定 successor。
- 不实现分支/合并历史，MVP 历史链保持线性。
- 不提供 Web 管理 UI。
- 不生成 Project Briefing；属于 Phase 4。

## 验收标准

1. v3 数据库无损升级 v4，既有 Memory active 且 FTS 可用。
2. add/update/archive/restore 和候选 supersede 均产生完整事件。
3. update 在一个事务中创建 successor 并 supersede predecessor，失败不留半状态。
4. 默认搜索、列表和 Context Bundle 不返回 superseded/archived/rejected。
5. archive 立即移出 FTS，合法 restore 重新进入；存在 active successor 时 restore 被拒绝。
6. 历史接口可从链中任一 ID 返回有序完整链与事件。
7. CLI 与 MCP 覆盖读取、更新、归档、历史；候选可显式 supersede。
8. 完整测试、构建、diff 检查和独立代码审查通过。
