# Phase 3 记忆生命周期实施计划

状态：已完成

> 按 SDD + TDD：每一项先确认 RED，再实现 GREEN。Phase 3 只包含生命周期与证据链，验收后独立提交。

## 文件映射

- `src/db/schema.ts`：schema v4、Memory 列、events 表、active-only FTS triggers。
- `src/memory/memoryStore.ts`：Memory status 字段、accepted event、active-only 默认查询。
- `src/memory/memoryLifecycleStore.ts`：get/update/archive/restore/history 和事件查询。
- `src/distill/candidateService.ts`：候选显式 supersede。
- `src/index.ts`：生命周期 CLI。
- `src/mcp/server.ts`：生命周期 MCP。
- `tests/db/schema.test.ts`：v3 -> v4。
- `tests/memory/memoryLifecycleStore.test.ts`：状态机、事务、FTS、历史。
- `tests/distill/candidateService.test.ts`：候选 supersede。
- `tests/cli/memory-lifecycle-cli.test.ts`：CLI 闭环。
- `tests/mcp/tools.integration.test.ts`：MCP 闭环。
- README、Progress、Obsidian：使用与实施记录。

## 任务

1. schema v4 和 active-only FTS：迁移测试 RED -> DDL/trigger GREEN。
2. Memory 类型与 accepted event：Store 测试 RED -> existing API 兼容 GREEN。
3. 生命周期事务：update/archive/restore/history 测试 RED -> Store GREEN。
4. 检索隔离：FTS/list/top/context 测试 RED -> active-only GREEN。
5. 候选 supersede：审核测试 RED -> Candidate Service GREEN。
6. CLI：get/update/archive/restore/history 端到端 RED -> GREEN。
7. MCP：get/update/archive/history 与 supersedes 参数 RED -> GREEN。
8. 文档、Obsidian、完整测试、构建、审查和独立提交。

## 审查加固

- v3 -> v4 使用事务内严格表重建，迁移后 CHECK、FK、NOT NULL、索引和 FTS 与全新数据库一致。
- 内容唯一索引仅约束 active Memory，允许历史链出现 `A -> B -> A`；非内容冲突不再返回未落库对象。
- 重复提炼只归档 Mira 管理的 distill 来源，保留同 Thread 的手工与候选 Memory。
- 候选只与 active Memory 去重，successor 继承 predecessor Thread，所有返回包含完整生命周期字段。
- `memory clear` 与 `thread delete` 明确为隐私硬删除，CLI 强制 `--confirm-hard-delete`。
- successor 插入能力收敛为 Store 内部实现，公开 `addMemory` 不能绕过状态机或伪造生命周期事件。
- Project、Thread、Memory 的硬删除入口统一要求显式确认；MCP/CLI accepted 事件记录可信入口 actor。
- FK 校验在 schema 版本更新和事务提交前完成；现有 v4 数据库重开不再重建 FTS。

## 验证

```bash
npm test -- tests/db/schema.test.ts tests/memory tests/distill/candidateService.test.ts tests/mcp/tools.integration.test.ts tests/cli/memory-lifecycle-cli.test.ts
npm test
npm run build
git diff --check
```

提交信息：`feat: add auditable memory lifecycle`
