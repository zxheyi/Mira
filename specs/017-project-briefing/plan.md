# Phase 4 Project Briefing 实施计划

状态：已完成

> 按 SDD + TDD 实施。每个行为先确认 RED，再实现 GREEN；Phase 4 验收后独立提交。

## 文件映射

- `src/db/schema.ts`：schema v5、`project_briefings` 与 stale triggers。
- `src/briefing/projectBriefingStore.ts`：类型、读取、版本、失败记录与重建事务。
- `src/briefing/projectBriefingRenderer.ts`：确定性章节、来源标记和 Token 估算。
- `src/context/contextBundle.ts`：主动重建与四级预算规划。
- `src/index.ts`：Briefing CLI 与 `--max-tokens`。
- `src/mcp/server.ts`：Briefing MCP 与 Context token budget。
- `tests/db/schema.test.ts`：v4 -> v5、trigger 与启动成本。
- `tests/briefing/projectBriefingStore.test.ts`：生成、版本、stale、失败回退和确定性。
- `tests/context/contextBundle.test.ts`：顺序、去重边界与双预算。
- `tests/cli/project-briefing-cli.test.ts`：CLI 闭环。
- `tests/mcp/tools.integration.test.ts`：MCP 闭环与 schema 边界。
- README、Progress、Obsidian：使用与实施证据。

## 执行顺序

1. schema v5 测试 RED -> table/index/trigger/migration GREEN。
2. Renderer 测试 RED -> 确定性章节与 provenance GREEN。
3. Store 测试 RED -> version/rebuild/stale/failure fallback GREEN。
4. Context Planner 测试 RED -> Working/Briefing/Warning/query 和 char/token budget GREEN。
5. CLI 测试 RED -> show/rebuild/history/max-tokens GREEN。
6. MCP 测试 RED -> get/rebuild/maxTokens GREEN。
7. 文档、Obsidian、完整验证、独立审查和单独 commit。

## 验证

```bash
npm test -- --run tests/db/schema.test.ts tests/briefing/projectBriefingStore.test.ts tests/context/contextBundle.test.ts tests/cli/project-briefing-cli.test.ts tests/mcp/tools.integration.test.ts
npm test -- --run
npm run build
git diff --check
```

提交信息：`feat: add proactive project briefings`
