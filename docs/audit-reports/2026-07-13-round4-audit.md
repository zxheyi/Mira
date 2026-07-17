# Mira 第四轮全面审计报告

审计日期：2026-07-13
代码状态：22 个测试文件 ~100+ 个用例全部通过，`npm run build` 通过
前置报告：`2026-07-13-budget-guards-audit.md`（6 项中优先级 + 16 项低优先级）
审计维度：修复完整性验证、MCP 工具交互体验、安全与输入边界、数据模型与生命周期、代码质量、测试覆盖

---

## 一、上轮中优先级修复验证（6/6 全部通过）

| ID | 问题 | 状态 | 证据 |
|----|------|------|------|
| S1 | `toFtsQuery` orTerms 空 terms 守卫 | **已修复** | `memoryStore.ts:101-103` — `if (terms.length === 0) return quoteFtsTerm(query)` |
| M1 | `search_memory` 描述字段层级误导 | **已修复** | `server.ts:33` — "returns SearchResult[] as { memory: { title, kind, ... }, score }" |
| M2 | `save_thread` 描述补 rawFormat 可选值 | **已修复** | `server.ts:38` — "rawFormat must be markdown or jsonl" |
| M3 | `get_context_bundle` 返回格式说明 | **已修复** | `server.ts:32` — "one concise Markdown string, not JSON" |
| D1 | `memories.thread_id` 缺少单列索引 | **已修复** | `schema.ts:71-72` — `CREATE INDEX idx_memories_thread ON memories(thread_id)` |
| T1 | 补 `searchMemories` 空查询防御测试 | **已修复** | `memoryStore.test.ts:259-265` — 覆盖 phrase 和 orTerms 两种模式 |

### 上轮低优先级修复验证（14 项去重后）

| ID | 状态 | 说明 |
|----|------|------|
| C1 | **非问题** | 原报告误判。`callMiraTool` 的 `name` 参数是 `string` 类型，`isMiraMcpToolName` 守卫是必要的 |
| C2 | **已修复** | `server.ts:219-222` — 使用 `const exhaustive: never = name` 穷尽性守卫 |
| C3 | **已修复** | `contextBundle.ts:74,85` — 使用 `maxCharacters !== undefined` 替代 falsy 检查 |
| C4 | **已修复** | `maxCharacters <= 3` 硬编码阈值已移除，改用统一的 `slice` 兜底 |
| C5 | **已修复** | `contextBundle.ts:107-114` — Working Memory 现在通过 `pushBudgetedEntries` 受预算控制 |
| C6 | **未修复** | CLI 与 MCP 的 kind 校验逻辑仍然重复（可接受，因输入形状不同） |
| S2 | **已修复** | `index.ts:134-139` — `requireRawFormat()` 校验 markdown/jsonl |
| S3 | **已修复** | `index.ts:443-445` — `numberInRange()` 校验 memoryLimit 和 maxCharacters |
| M4 | **部分修复** | MCP `maxCharacters` 改为 `min(100)`，但 CLI 仍允许 `min(1)` |
| M5 | **已修复** | `server.ts:58` — `limit: z.number().int().min(1).max(50).optional()` |
| M6 | **已修复** | `server.ts:37` — 描述包含 "de-duplicates by projectId, kind, threadId, and content hash" |
| M7 | **已修复** | `threadStore.ts:3` — `ThreadRawFormat = "markdown" | "jsonl""`，Zod 用 `z.enum` |
| M8 | **已修复** | `server.ts:35` — "with no arguments" |
| M9 | **已修复** | `tools.integration.test.ts:71-93` — 覆盖 top-N 和 maxCharacters 路径 |
| D2 | **已修复** | `threadStore.ts:91-93` — 简单 DELETE，依赖 CASCADE 清理 |
| D5 | **已修复** | `schema.ts:84-103` — insert/update/delete 三个 FTS 触发器完整 |
| D6 | **未修复** | `distillThread.ts:172-174` — 空结果时仍不清理旧 memories |

**总结**：6/6 中优先级全部修复。低优先级 11 项已修复，1 项部分修复，1 项非问题（原报告误判），2 项未修复（C6 可接受、D6 可后续处理）。

---

## 二、新发现：高优先级问题（2 项）

### H1: CASCADE 删除不触发 FTS 清理触发器

- **严重度**：HIGH
- **位置**：`client.ts` 缺少 `recursive_triggers` pragma；`schema.ts` triggers
- **问题**：SQLite 默认行为下，ON DELETE CASCADE 触发的行删除**不会执行 AFTER DELETE triggers**。这意味着：
  - 删除 project → CASCADE 删除所有 memories → `memory_fts` 表残留孤儿记录
  - 删除 thread → CASCADE 删除关联 memories → `memory_fts` 表残留孤儿记录
- **影响**：FTS 表持续膨胀，虽然 `searchMemories` 使用 JOIN 不会返回已删除的数据，但 FTS 表包含无效条目会浪费磁盘和降低搜索性能
- **修复**：在 `client.ts` 的 `openDatabase` 中添加 `db.pragma("recursive_triggers = ON")`（一行代码）

### H2: `search_memory` 使用 phrase 匹配但描述未说明

- **严重度**：HIGH
- **位置**：`server.ts:33` 描述 + `memoryStore.ts:98-108` 实现
- **问题**：`search_memory` 将多词查询视为精确短语匹配（如 `"auth token"` 要求连续出现），而非关键词 OR 匹配。Agent 习惯关键词搜索，会频繁得到空结果却不理解原因
- **对比**：`get_context_bundle` 有 orTerms 降级回退机制，但 `search_memory` 没有
- **修复**：三选一：(a) 给 `search_memory` 加 `queryMode` 参数；(b) 像 `get_context_bundle` 一样自动降级；(c) 至少在描述中注明 "uses exact-phrase matching"

---

## 三、新发现：中优先级问题（11 项）

### MCP 工具交互体验（5 项）

| # | 问题 | 位置 |
|---|------|------|
| M-1 | `get_context_bundle` 描述未说明默认 `memoryLimit=8`，Agent 不知道默认只返回 8 条 | `server.ts:32,180` |
| M-2 | `list_working_memory` 描述称 "ordered for resuming active task state" 但实现是 `ORDER BY rowid ASC`（插入顺序），优先级排序只在 `contextBundle` 中生效 | `workingMemoryStore.ts:66-76` |
| M-3 | `add_memory` 描述未说明 `confidence` 默认 1、`importance` 默认 5，且 Zod schema 未用 `.default()` 因此 JSON Schema 不包含默认值 | `server.ts:206-207` |
| M-4 | `preference`/`decision`/`note` 同时存在于 MEMORY_KINDS 和 WORKING_MEMORY_KINDS，但描述未解释 session-scoped 与 permanent 的区别 | `server.ts:34,37` |
| M-5 | 无工具可删除/更新单条 long-term memory（`clearMemoriesForThread` 和 `deleteMemoriesForProject` 存在但未暴露为 MCP 工具），过时 memory 无法清理 | `memoryStore.ts:189-199` |

### 安全与输入边界（2 项）

| # | 问题 | 位置 |
|---|------|------|
| S-1 | CLI 入口多个字符串字段缺少长度限制（title/content/source/query 等），与 MCP 的 Zod `.max()` 校验不对齐。通过 CLI 可写入任意大的 SQLite 行 | `index.ts` 多处 |
| S-2 | CLI `maxCharacters` 最小值为 1，MCP 最小值为 100，不一致 | `index.ts:445` vs `server.ts:53` |

### 代码质量（2 项）

| # | 问题 | 位置 |
|---|------|------|
| C-1 | Section headers（`## Working Memory`、`## Warnings`、`## Long-Term Memory`）和 `"No matching long-term memory."` 通过 `lines.push()` 直接添加，不经过 budget 检查。虽有最终 `slice` 兜底，但破坏了 `pushBudgetedEntries` "保持条目完整" 的设计约束 | `contextBundle.ts:103,118,129,131` |
| C-2 | server.ts 中 63 行手动 arg helper（`stringArg`/`numberArg`/`memoryKindArg` 等）在 Zod 验证之后永远不会触发异常，是冗余代码。根因是 `result.data as ToolArgs` 丢弃了 Zod 推断的精确类型 | `server.ts:92-154,251` |

### 数据模型（2 项）

| # | 问题 | 位置 |
|---|------|------|
| D-1 | `kind`/`confidence`/`importance` 字段无数据库层 CHECK 约束，完全依赖应用层校验 | `schema.ts:42-55` |
| D-2 | `save_thread` 返回完整 Thread 对象（含 `rawText`），对 5MB 的线程会生成 >5MB 的 JSON 响应 | `threadStore.ts:56-77`, `server.ts:259` |

---

## 四、新发现：低优先级问题（12 项）

| # | 维度 | 问题 | 位置 |
|---|------|------|------|
| L-1 | MCP 体验 | `set_working_memory` 描述未说明 one-per-kind singleton 约束 | `server.ts:34` |
| L-2 | MCP 体验 | 无 `list_threads`/`get_thread` MCP 工具，Agent 无法回顾历史线程 | `threadStore.ts:79-89` |
| L-3 | MCP 体验 | `clear_working_memory` 始终返回 `{ ok: true }`，不告知实际删除了多少条 | `server.ts:197-198` |
| L-4 | MCP 体验 | 描述中未列出 `kind` 的合法值列表（依赖 JSON Schema enum 传递，但部分 Agent 只读描述） | 多处 |
| L-5 | 安全 | 错误信息包含完整文件系统路径（本地工具可接受） | `client.ts:22`, `projectStore.ts:89` |
| L-6 | 安全 | `export --out` / `import --path` 可操作任意文件路径（本地 CLI 预期行为） | `exportProject.ts:113`, `agentSessionImporter.ts:252` |
| L-7 | 代码质量 | `deleteMemoriesForProject` 已导出但仅在测试中使用，CASCADE 可完成同等功能 | `memoryStore.ts:197` |
| L-8 | 代码质量 | `ensureProjectForRoot` 双重路径规范化（调用 `findProjectByRoot` 再次 normalize） | `projectStore.ts:67-68` |
| L-9 | 代码质量 | `pushBudgetedEntries` 内 `[...lines, entry, ""].join("\n")` 每次迭代重建整个字符串，O(n²)。当前数据量下不是问题 | `contextBundle.ts:73` |
| L-10 | 代码质量 | `withToolSession` 每次 `callMiraTool` 调用都执行 `migrate(db)`，对批量操作有冗余开销 | `server.ts:158` |
| L-11 | 数据模型 | `distillMemoriesFromText` 空结果时不清除旧 memories（同 D6，设计决策） | `distillThread.ts:172-174` |
| L-12 | 数据模型 | `saveThread` 的 INSERT + SELECT 不在显式事务中（better-sqlite3 同步 API 下无实际风险） | `threadStore.ts:56-76` |

---

## 五、测试覆盖率评估

**总体评级：A-**（22 文件 ~100+ 用例）

### 各模块评级

| 模块 | 评级 | 用例数 | 说明 |
|------|------|--------|------|
| memoryStore | A | 15 | 三条去重路径全覆盖（含 catch re-throw），FTS、kind filter、limit、orTerms |
| contextBundle | A | 9 | 预算控制 break 语义、warning 预算、working memory 预算、排序、空状态 |
| server (MCP) | A | 17 | 全链路 CRUD、schema 边界、handler 错误包装、shared session、kind 校验 |
| distillThread | A | 9 | heading 解析、续行合并、**事务回滚**、空结果保留旧数据 |
| llmDistill | A | 8 | prompt 构建、候选解析、kind/length 校验、apply 替换 |
| threadStore | A | 5 | CRUD、cascade、createdAt 不可变 |
| workingMemoryStore | A | 4 | set/list/clear/upsert，含 clear-all |
| agentSessionImporter | A | 9 | Markdown/JSONL、slug、稳定 ID、非 ASCII |
| exportProject | A | 3 | 缺失 projectId 错误、JSON/Markdown 导出、空项目 |
| projectStore | B+ | 5 | `deleteProject` 无直接 cascade 测试 |
| schema | B+ | 3 | FTS insert/update trigger 已覆盖，delete 间接覆盖 |
| client | B | 1 | "file is not a database" 已覆盖 |
| projectRoot | B+ | 3 | .git 查找、fallback、fellBack 标志 |

### Top 5 应补测试场景

| 优先级 | 场景 | 说明 |
|--------|------|------|
| P2 | `deleteProject` cascade 完整性 | 验证删除 project 后 threads/memories/working_memory/FTS 全部清理 |
| P2 | `addMemory` 无 threadId 的去重路径 | 源码有独立 SQL 分支 `thread_id IS NULL`，未单独验证 |
| P2 | `ensureProjectForRoot` 真实并发模拟 | INSERT OR IGNORE 路径仅通过幂等测试间接覆盖 |
| P3 | 多项目数据隔离 | 同一 DB 中两个 project 的数据不互相污染 |
| P3 | MCP server `close()` 生命周期 | 验证 DB 连接正确关闭 |

---

## 六、跨维度汇总：优先级矩阵

### 高优先级（2 项，建议立即修复）

| # | 维度 | 问题 | 改动量 |
|---|------|------|--------|
| H1 | 数据模型 | CASCADE 删除不触发 FTS 清理，`memory_fts` 残留孤儿 | ~1 行 pragma |
| H2 | MCP 体验 | `search_memory` phrase 匹配语义未告知 Agent | 描述文案或加 queryMode 参数 |

### 中优先级（11 项，建议近期修复）

| # | 维度 | 问题 | 改动量 |
|---|------|------|--------|
| M-1 | MCP 体验 | `get_context_bundle` 默认 memoryLimit=8 未说明 | 描述文案 |
| M-2 | MCP 体验 | `list_working_memory` 描述与实际排序不一致 | 描述文案或改查询 |
| M-3 | MCP 体验 | `add_memory` 默认值未文档化，Zod 无 `.default()` | Zod + 描述 |
| M-4 | MCP 体验 | session-scoped vs permanent memory 区别未说明 | 描述文案 |
| M-5 | MCP 体验 | 无 delete/update memory MCP 工具 | ~40 行新代码 |
| S-1 | 安全 | CLI 字符串字段缺长度限制 | ~15 行校验 |
| S-2 | 安全 | CLI maxCharacters min 与 MCP 不一致 | ~1 行 |
| C-1 | 代码质量 | Section headers 不受 budget 控制 | ~6 行 |
| C-2 | 代码质量 | 63 行冗余 arg helpers + `as ToolArgs` 类型丢失 | 重构 |
| D-1 | 数据模型 | kind/confidence/importance 无 CHECK 约束 | ~3 行 SQL |
| D-2 | 数据模型 | save_thread 返回完整 rawText 可能 >5MB | ~5 行 |

### 低优先级（12 项，可后续处理）

L-1 ~ L-12 详见第四节。

---

## 七、四轮审计修复追踪

| 轮次 | 高优先级 | 中优先级 | 修复状态 |
|------|----------|----------|----------|
| 第一轮（post-fix-audit） | 9 项 | — | **9/9 全部修复** |
| 第二轮（hardening-audit） | 6 项 | — | **6/6 全部修复** |
| 第三轮（budget-guards-audit） | 0 项 | 6 项 | **6/6 全部修复** |
| 本轮 | 2 项 | 11 项 | 待修复 |

### 代码质量趋势

- **安全基线**：SQL 全参数化、FTS 转义正确、MCP Zod schema 完整、CLI kind/format/range 校验到位
- **测试质量**：从第一轮 87 个用例增长到 100+ 个，三条并发去重路径、事务回滚、预算控制策略均有精确测试
- **本轮新发现**：H1 是首次发现的真实数据完整性 bug（CASCADE + triggers 交互问题），H2 是 Agent 可用性问题
- **改进空间**：主要集中在 MCP 工具描述的 Agent 友好度（默认值、匹配语义、有效值列表）和 CLI/MCP 校验对齐
