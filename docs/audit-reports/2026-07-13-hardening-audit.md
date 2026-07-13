# Mira 加固后多维度审计报告

审计日期：2026-07-13
代码状态：21 个测试文件 94 个用例全部通过，`npm run build` 通过
前置报告：`2026-07-13-post-fix-audit.md`（9 项高优先级待修复）
审计维度：修复完整性验证、代码质量与新增逻辑、测试覆盖与质量、安全与输入边界、MCP 工具交互体验、数据模型与生命周期

---

## 一、上轮高优先级修复验证（9/9 全部通过）

### D1: ON DELETE SET NULL → CASCADE

- 状态: **已修复**
- 位置: `schema.ts:54` — `on delete cascade`
- 说明: 外键策略改为 CASCADE，与 `deleteThread` 中 `clearMemoriesForThread` 方向一致。`threadStore.test.ts:82-107` 新增 CASCADE 级联删除测试验证了 schema 层的实际行为。

### S1: MCP confidence/importance 范围校验

- 状态: **已修复**
- 位置: `server.ts:73-74` — `.min(0).max(1)` / `.int().min(1).max(10)`
- 测试: `tools.integration.test.ts:67-68` 验证边界拒绝

### S2+S3: MCP 字符串大小限制

- 状态: **已修复**
- 位置:
  - `add_memory.title`: `.max(500)` (server.ts:68)
  - `add_memory.content`: `.max(50_000)` (server.ts:70)
  - `save_thread.rawText`: `.max(5_000_000)` (server.ts:81)
  - `set_working_memory.content`: `.max(100_000)` (server.ts:61)
  - `search_memory.query`: `.max(1_000)` (server.ts:56)
- 测试: `tools.integration.test.ts:69-73` 验证超限拒绝

### M1: 移除 thread 双参数

- 状态: **已修复**
- 位置: `server.ts:68-75` — 只有 `threadId`，schema 使用 `.strict()` 拒绝未知字段
- 测试: `tools.integration.test.ts:66,176-183` 验证 `thread` 被拒绝

### M2: rawFormat 改 enum

- 状态: **已修复**
- 位置: `server.ts:80` — `z.enum(["markdown", "jsonl"])`
- 测试: `tools.integration.test.ts:71-72` 验证 `"plain"` 被拒绝

### M3: search_memory vs get_context_bundle 描述区分

- 状态: **已修复**
- 位置: `server.ts:32-33` — 分别使用 "session start / Markdown" 和 "targeted / SearchResult[]"
- 测试: `tools.integration.test.ts:58-63` 验证区分关键词

### T1: addMemory 并发 fallback 测试

- 状态: **已修复**
- 位置: `memoryStore.test.ts:288-323` — 通过 SQLite trigger 模拟竞态，验证 INSERT OR IGNORE + changes=0 回查路径
- 说明: 覆盖的是事务内 fallback 路径（memoryStore.ts:165-166），catch 块的外层异常路径仍未测试

### T2: orTerms 搜索模式测试

- 状态: **已修复**
- 位置: `memoryStore.test.ts:259-286` — 验证 phrase 模式返回空，orTerms 模式返回两条

### T3: MCP handler 错误封装测试

- 状态: **已修复**
- 位置: `tools.integration.test.ts:196-220` — 直接调用 `_registeredTools.add_memory.handler` 验证 `isError: true` 且含工具名

### callMiraTool 验证一致性（附带修复）

- 状态: **已修复**
- 位置: `server.ts:217` — `callMiraTool` 现在也调用 `parseMiraToolArgs`，两条入口走相同的 Zod 验证路径

---

## 二、代码质量与新增逻辑

**总体评价：新代码质量高，未发现阻塞性 bug。**

### 确认通过项

- `findDuplicateMemory` 对 threadId=null 和 threadId!=null 的查询分支正确，与 partial unique index 的 WHERE 条件完全对应
- `parseMiraToolArgs` 在两条入口路径行为一致
- 新增测试断言精确，竞态模拟设计精巧

### 发现的问题

| # | 问题 | 严重度 | 位置 |
|---|------|--------|------|
| C1 | `executeMiraTool` 的 switch 没有 default 分支，新增 tool name 时不会编译报错，会静默返回 undefined | 中 | server.ts:162-209 |
| C2 | `deleteThread` 中 `clearMemoriesForThread` 与 CASCADE 冗余——显式删除在 CASCADE 之前执行，CASCADE 触发时已无 memory 可删，功能正确但多一次无谓查询 | 低 | threadStore.ts:90-94 |
| C3 | server.ts:91-145 的手动验证辅助函数（stringArg/memoryKindArg 等）在 parseMiraToolArgs 已验证后永远不会 throw，成为冗余防御层 | 低 | server.ts:91-145 |
| C4 | `toMcpErrorResult` 中 `message.includes(toolName)` 判断略脆弱——如果非 parseMiraToolArgs 的错误消息恰好包含工具名字符串，会跳过前缀 | 极低 | server.ts:250 |

---

## 三、测试覆盖与质量

**总体评级：A-**（94 个用例，断言精度高，关键并发路径有覆盖）

### 各模块评级

| 模块 | 评级 | 用例数 | 说明 |
|------|------|--------|------|
| memory/memoryStore.ts | A | 11 | 去重、竞态、FTS、kind 过滤、orTerms、排序、限制。仅 catch 兜底未覆盖 |
| mcp/server.ts | A | 13 | strict 校验、错误封装、共享会话、kind 校验、边界值 |
| context/contextBundle.ts | A | 6 | 排序、截断、空状态、warning 分组、预算跳过 |
| distill/distillThread.ts | A- | 8 | heading 解析、continuation、idempotent。缺事务回滚测试 |
| distill/llmDistill.ts | A | 8 | prompt 构建、候选解析、边界校验、应用替换 |
| threads/threadStore.ts | A | 4 | CRUD、upsert preserveCreatedAt、CASCADE |
| projects/projectStore.ts | A | 5 | CRUD、ensureProjectForRoot 幂等性 |
| workingMemory/workingMemoryStore.ts | A | 4 | set/list/clear/upsert |
| importers/agentSessionImporter.ts | A | 9 | Markdown/JSONL 解析、slug、错误源 |
| export/exportProject.ts | B+ | 2 | 正常导出 + 空项目 |
| db/schema.ts | B+ | 3 | 表创建、版本检查、索引 |
| db/client.ts | C | 0 | 无专项测试，"file is not a database" 未覆盖 |
| mcp/transport.ts | D | 1 | 仅 help 文本 |
| index.ts (CLI) | B+ | 14 | 大部分命令覆盖，部分危险命令未直接测试 |

### Top 5 应补测试场景

| 优先级 | 场景 | 影响 | 位置 |
|--------|------|------|------|
| 1 | `addMemory` catch 兜底路径（事务异常→回查→重抛） | 并发安全最后防线 | memoryStore.ts:181-187 |
| 2 | `openDatabase` "file is not a database" 错误转换 | 用户感知最强的错误场景 | client.ts:13-19 |
| 3 | `searchMemories` 空查询/纯空白查询防御 | 公开导出函数，CLI 直接调用 | memoryStore.ts:239-241 |
| 4 | `distillThreadMemories` 事务回滚验证 | 失败时旧 memory 必须恢复 | distillThread.ts:176-179 |
| 5 | `saveThread` rawText 空白校验（store 层直接测试） | MCP 绕过 CLI 时的唯一防线 | threadStore.ts:49 |

---

## 四、安全与输入边界

**整体评估：无 HIGH 级别问题。SQL 全部参数化，FTS5 转义正确，MCP 错误不泄露堆栈。**

### 确认安全项

- SQL 注入：全部参数化查询，唯一拼接的 `${kindClause}` 是固定字符串
- FTS5 MATCH 注入：`quoteFtsTerm` 双引号包裹 + `"` 转义为 `""`，符合 FTS5 规范
- MCP 错误：`toMcpErrorResult` 只返回 message，CLI catch 块不打印堆栈
- `npm audit` 0 漏洞

### 发现的问题

| # | 问题 | 严重度 | 位置 | 建议 |
|---|------|--------|------|------|
| S1 | `get_context_bundle` 的 `query` 缺少 `.max()` 限制，可传入任意长字符串 | 中 | server.ts:51 | 加 `.max(1_000)` |
| S2 | CLI `memory add --kind` 无运行时枚举校验，可写入无效 kind | 中 | index.ts:256 | 加 `MEMORY_KINDS.includes()` 检查 |
| S3 | CLI `working set --kind` 无运行时枚举校验 | 中 | index.ts:364 | 加 `WORKING_MEMORY_KINDS.includes()` 检查 |
| S4 | CLI `context bundle --memory-limit/--max-characters` 无范围校验 | 低 | index.ts:409-416 | 用已有的 `numberInRange` |
| S5 | CLI `thread save --format` 无枚举校验 | 低 | index.ts:199 | 加 `["markdown","jsonl"].includes()` |
| S6 | `toFtsQuery` orTerms 模式下 terms 全部过滤后可能产生空字符串传给 MATCH | 低 | memoryStore.ts:99-101 | 加 `if (terms.length === 0) return '""'` 守卫 |

---

## 五、MCP 工具交互体验

### 中严重度（4 项）

| # | 问题 | 位置 | 建议 |
|---|------|------|------|
| M1 | `search_memory` 描述中 SearchResult 字段层级有误导——kind/title/source/confidence 实际嵌套在 memory 对象内 | server.ts:33 | 改为 "returns SearchResult[] with score and nested Memory object" |
| M2 | `save_thread` 描述未提 rawFormat 可选值 | server.ts:38 | 补充 "rawFormat must be 'markdown' or 'jsonl'" |
| M3 | `get_context_bundle` 返回 raw Markdown 而非 JSON，但描述未说明返回格式差异 | server.ts:32 | 补 "Returns raw Markdown text (not JSON)" |
| M4 | `get_context_bundle.maxCharacters` 最小值 1 允许无意义的输出（如 `maxCharacters=1` 返回 `"#"`） | server.ts:53 | 改为 `.min(100)` |

### 低严重度（7 项）

| # | 问题 | 位置 |
|---|------|------|
| M5 | `search_memory` 未暴露 `limit`/`queryMode` 参数，Agent 无法控制结果数量和搜索模式 | server.ts:55-58 |
| M6 | `source` 参数语义不明确，Agent 不知道该填什么值 | server.ts:71,79 |
| M7 | `add_memory`/`set_working_memory` 描述未列出可用的 kind 值 | server.ts:34,37 |
| M8 | `memoryLimit` 命名歧义，可能被误解为字符上限 | server.ts:52 |
| M9 | `clear_working_memory` 返回 `{ok:true}` 不含实际删除数量 | server.ts:187-188 |
| M10 | Zod strict() 拒绝未知字段时不提示可用参数列表 | server.ts:222 |
| M11 | MCP 测试未覆盖 `get_context_bundle` 无 query 的 top-N 路径和 `maxCharacters` 截断 | tools.integration.test.ts |

---

## 六、数据模型与生命周期

### 高严重度（2 项）

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| D1 | **Warning memories 完全不受 maxCharacters 预算控制**——直接写入 lines 不经过 `pushBudgetedEntries`，大量 warning memories 会导致输出远超预算 | contextBundle.ts:105-109 | 挤占或溢出 Agent 上下文窗口 |
| D2 | **pushBudgetedEntries 用 continue 而非 break**——高 importance 的长 memory 被跳过，低 importance 的短 memory 被保留，违反重要性优先直觉 | contextBundle.ts:76 | 重要决策可能被省略 |

### 中严重度（3 项）

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| D3 | `saveThread` 的 upsert 允许通过不同 project_id 跨项目移动 thread，但关联 memories 的 project_id 不随之更新 | threadStore.ts:55-65 | 数据完整性问题（thread 与 memories 分属不同 project） |
| D4 | 唯一索引跨 thread 去重语义：不同 thread 可以各自存一条相同 (project_id, kind, content_hash) 的记录 | schema.ts:57-63 | 可能产生重复内容的 memories |
| D5 | distillThreadMemories 空结果时不清理旧 memories——如果 raw_text 被编辑为无可识别 section 的内容，旧 memories 残留 | distillThread.ts:171-173 | 过时 memories 不被清除 |

### 低严重度（4 项）

| # | 问题 | 位置 |
|---|------|------|
| D6 | `deleteThread` 中 `clearMemoriesForThread` 与 CASCADE 冗余 | threadStore.ts:90-94 |
| D7 | 缺少 `idx_memories_kind` 索引，kind 过滤在大数据下需扫描 | schema.ts |
| D8 | `listMemoriesForProject` (ASC) 和 `listTopMemoriesForProject` (DESC) 排序方向相反 | memoryStore.ts |
| D9 | `maxCharacters <= 3` 的极小值保护阈值硬编码，缺少注释 | contextBundle.ts:127 |

---

## 跨维度汇总：优先级矩阵

### 应修复（高优先级，6 项）

| # | 维度 | 问题 | 改动量 |
|---|------|------|--------|
| D1 | 数据模型 | Warning memories 不受 maxCharacters 预算控制 | ~10 行 |
| D2 | 数据模型 | pushBudgetedEntries continue→break 截断策略 | ~1 行 |
| C1 | 代码质量 | executeMiraTool switch 缺 default 分支 | ~2 行 |
| S1 | 安全 | get_context_bundle query 缺 .max() | ~1 行 |
| S2+S3 | 安全 | CLI kind 无运行时枚举校验 | ~6 行 |
| T1 | 测试 | 补 addMemory catch 兜底路径测试 | ~15 行 |

### 建议改进（中优先级，10 项）

| # | 维度 | 问题 |
|---|------|------|
| M1 | MCP 体验 | search_memory 描述字段层级误导 |
| M2 | MCP 体验 | save_thread 描述补 rawFormat 可选值 |
| M3 | MCP 体验 | get_context_bundle 说明返回 Markdown 非 JSON |
| M4 | MCP 体验 | maxCharacters 最小值改 100 |
| D3 | 数据模型 | saveThread upsert 跨项目移动防护 |
| D4 | 数据模型 | 跨 thread 去重语义明确化 |
| D5 | 数据模型 | distill 空结果时是否清理旧 memories |
| T2 | 测试 | 补 openDatabase 错误转换测试 |
| T3 | 测试 | 补 searchMemories 空查询防御测试 |
| T4 | 测试 | 补 distill 事务回滚测试 |

### 可后续处理（低优先级，14 项）

C2-C4 代码冗余、S4-S6 CLI 次要校验、M5-M11 描述细节、D6-D9 索引/排序/冗余

---

## 修复进展总结

上轮报告（post-fix-audit）提出 **9 项高优先级**：
- **全部修复（9/9）**，修复质量高，未引入功能性新问题
- `callMiraTool` 附带修复了 Zod 验证一致性

本轮新发现 **约 30 项**，其中：
- 高优先级 6 项（2 个 context bundle 策略问题、1 个 switch exhaustiveness、1 个 MCP query 上限、2 个 CLI 枚举校验、1 个测试空白）
- 中优先级 10 项（MCP 描述优化、数据模型语义、测试补充）
- 低优先级 14 项

**代码质量评价**：上轮 9 项高优先级全部精准修复，新增测试覆盖了关键并发路径和 schema 行为。当前最需关注的是 context bundle 的预算控制策略（D1/D2）和 CLI 端与 MCP 端的枚举校验对齐（S2/S3）。
