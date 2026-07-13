# Mira 预算与守卫加固后审计报告

审计日期：2026-07-13
代码状态：21 个测试文件 99 个用例全部通过，`npm run build` 通过
前置报告：`2026-07-13-hardening-audit.md`（6 项高优先级待修复）
审计维度：修复完整性验证、代码质量与新增逻辑、测试覆盖与质量、安全与输入边界、MCP 工具交互体验、数据模型与生命周期

---

## 一、上轮高优先级修复验证（6/6 全部通过）

### D1: Warning memories 不受 maxCharacters 预算控制

- 状态: **已修复**
- 位置: `contextBundle.ts:112-121` — warning memories 现在通过 `pushBudgetedEntries()` 写入，超出预算时显示 omitted 提示
- 测试: `contextBundle.test.ts:144-172` 验证过大 warning 被省略且输出不超限

### D2: pushBudgetedEntries continue → break

- 状态: **已修复**
- 位置: `contextBundle.ts:74-75` — 超出预算时 `return entries.length - index` 立即终止，后续条目也全部跳过
- 测试: `contextBundle.test.ts:174-211` 验证第一条超大后第三条虽小也不被加入

### C1: executeMiraTool switch 缺 default 分支

- 状态: **已修复**
- 位置: `server.ts:209-210` — `default: throw new Error(...)`
- 测试: `tools.integration.test.ts:69-72` 验证未知工具名被拒绝

### S1: get_context_bundle query 缺 .max()

- 状态: **已修复**
- 位置: `server.ts:51` — `.max(1_000)`
- 测试: `tools.integration.test.ts:65-67` 验证 1001 字符被拒绝

### S2+S3: CLI kind 无运行时枚举校验

- 状态: **已修复**
- 位置: `index.ts:118-132` — `requireMemoryKind()` / `requireWorkingMemoryKind()`
- 调用点: `index.ts:289`（memory add）、`index.ts:383`（working set）、`index.ts:410`（working clear）
- 测试: `phase4-cli.test.ts:253-264` 验证 `--kind surprise` 被拒绝

### T1: 补 addMemory catch 兜底路径测试

- 状态: **已修复**
- 位置: `memoryStore.test.ts:325-374` — 通过 proxy 包装 db.prepare 模拟事务异常，验证 catch 中找到重复记录并返回
- 质量: 测试设计精巧，覆盖了 `memoryStore.ts:181-187` 的 catch 兜底路径

---

## 二、代码质量与新增逻辑

**总体评价：新代码质量高，未发现阻塞性 bug。**

### 确认通过项

- `pushBudgetedEntries` 的 return 语义清晰，返回值被正确用于 omitted 提示
- Warning memories 的 omitted 提示也经过 `pushBudgetedLine` 预算检查
- `requireMemoryKind` / `requireWorkingMemoryKind` 错误消息包含所有合法值列表
- `parseMiraToolArgs` 在两条入口路径行为一致

### 发现的问题

| # | 问题 | 严重度 | 位置 |
|---|------|--------|------|
| C1 | `parseMiraToolArgs` 中 `isMiraMcpToolName(name)` 守卫是死代码——参数类型已是 `MiraMcpToolName`，检查永远为 true | 低 | server.ts:228-229 |
| C2 | `executeMiraTool` 的 default 分支类型上不可达。若目的是 exhaustiveness guard，建议用 `const _: never = name` 让编译器在新增枚举值时报错 | 低 | server.ts:209-210 |
| C3 | `pushBudgetedEntries` 和 `pushBudgetedLine` 中 `maxCharacters && ...` 条件：当 `maxCharacters === 0` 时为 falsy，等同无限预算。MCP schema 已限制 `min(1)` 所以当前不可达，但函数自身语义不完整 | 低 | contextBundle.ts:74,85 |
| C4 | `maxCharacters <= 3` 的硬编码兜底：4~50 区间的极小预算可能返回超长结果，行为不连续 | 低 | contextBundle.ts:143-145 |
| C5 | Working Memory 不受 `maxCharacters` 预算控制（直接 push 到 lines），可能独占全部预算 | 低 | contextBundle.ts:107-109 |
| C6 | `requireMemoryKind` / `requireWorkingMemoryKind`（index.ts）与 `memoryKindArg` / `workingMemoryKindArg`（server.ts）逻辑重复 | 低 | index.ts:118-132 vs server.ts:109-145 |

---

## 三、测试覆盖与质量

**总体评级：A-**（99 个用例，断言精度高，三条并发去重路径全覆盖）

### 各模块评级

| 模块 | 评级 | 用例数 | 说明 |
|------|------|--------|------|
| memory/memoryStore.ts | A | 13 | 三条去重路径全覆盖，orTerms、kind 过滤、limit、FTS 清理。仅缺 catch re-throw 和空查询 |
| context/contextBundle.ts | A | 8 | 预算控制 break 语义、warning 预算、排序、空状态、极端 maxCharacters |
| mcp/server.ts | A | 15 | CRUD 流程、schema 边界、错误包装、共享会话、kind 枚举、query max |
| distill/distillThread.ts | A | 8 | heading 解析、空输入保护、清旧写新 |
| distill/llmDistill.ts | A | 8 | prompt 构建、候选解析、长度限制、空候选保留 |
| threads/threadStore.ts | A | 4 | CRUD、upsert、CASCADE、FTS 清理 |
| projects/projectStore.ts | A | 5 | CRUD、幂等性 |
| workingMemory/workingMemoryStore.ts | A | 4 | set/list/clear/upsert |
| importers/agentSessionImporter.ts | A | 9 | Markdown/JSONL、slug、稳定 ID |
| export/exportProject.ts | A | 2 | JSON + Markdown 导出 |
| db/schema.ts | A | 3 | 表结构、版本检查、索引 |
| index.ts (CLI) | B | 14 | 全流程覆盖，kind 校验。部分命令未直接测试 |
| db/client.ts | C | 0 | 无专项测试 |
| mcp/transport.ts | C | 1 | 仅 help 文本 |

### Top 5 应补测试场景

| 优先级 | 场景 | 影响 | 位置 |
|--------|------|------|------|
| 1 | `searchMemories` 空查询/纯空白查询返回 [] | 公开导出函数，CLI 直接调用 | memoryStore.ts:239-241 |
| 2 | `openDatabase` "file is not a database" 错误转换 | 用户最可能遇到的数据库损坏场景 | client.ts:13-18 |
| 3 | `addMemory` catch 路径的 re-throw（无重复时抛出原始错误） | catch 块的第二分支 | memoryStore.ts:186 |
| 4 | `distillThreadMemories` 事务回滚（addMemory 失败时旧 memory 恢复） | 数据安全 | distillThread.ts:176-179 |
| 5 | `exportProject` 不存在的 projectId | 友好错误提示 | exportProject.ts:22-30 |

---

## 四、安全与输入边界

**整体评估：无 HIGH 级别问题。SQL 全部参数化，FTS5 转义正确，MCP Zod schema 完备。**

### 确认安全项

- SQL 注入：全部参数化查询，唯一动态片段 `${kindClause}` 是固定字符串
- FTS5：`quoteFtsTerm` 双引号包裹 + 转义正确
- MCP Zod schema：所有字符串有 max、所有数字有范围、使用 `.strict()` 拒绝未声明字段
- CLI kind 枚举校验：已到位（memory add、working set、working clear）
- 错误信息：MCP 和 CLI 均不泄露堆栈

### 发现的问题

| # | 问题 | 严重度 | 位置 | 建议 |
|---|------|--------|------|------|
| S1 | `toFtsQuery` orTerms 模式下 terms 全部过滤后产生空字符串。当前被 `searchMemories` 的 `trim()` 前置守卫保护，但函数自身缺少防御 | 中 | memoryStore.ts:99-101 | 加 `if (terms.length === 0) return quoteFtsTerm(query)` |
| S2 | CLI `thread save --format` 无枚举校验，任意字符串可存入数据库 | 低 | index.ts:229-232 | 加 `["markdown","jsonl"].includes()` 检查 |
| S3 | CLI `context bundle --memory-limit/--max-characters` 无范围校验 | 低 | index.ts:432-443 | 用 `numberInRange` 与 MCP schema 对齐 |

---

## 五、MCP 工具交互体验

### 中严重度（3 项，均为上轮中优先级遗留）

| # | 问题 | 位置 | 建议 |
|---|------|------|------|
| M1 | `search_memory` 描述中 SearchResult 字段层级有误导——kind/title/source/confidence 实际嵌套在 memory 对象内 | server.ts:33 | 改为 "returns SearchResult[] with { memory: { title, kind, ... }, score }" |
| M2 | `save_thread` 描述未提 rawFormat 可选值 | server.ts:38 | 补充 "rawFormat must be 'markdown' or 'jsonl'" |
| M3 | `get_context_bundle` 描述未明确返回 Markdown 字符串而非 JSON | server.ts:32 | 补 "returns a single Markdown string (not JSON)" |

### 低严重度（6 项）

| # | 问题 | 位置 |
|---|------|------|
| M4 | `maxCharacters` 允许 min(1)，极小值返回无用内容 | server.ts:53 |
| M5 | `search_memory` 未暴露 `limit` 参数 | server.ts:55-58 |
| M6 | `add_memory` 描述中去重四元组漏了 projectId | server.ts:37 |
| M7 | `SaveThreadInput.rawFormat` 类型是 `string` 而非枚举联合类型 | threadStore.ts:9 |
| M8 | `list_working_memory` 描述未说明无需传参 | server.ts:35 |
| M9 | MCP 测试未覆盖 `get_context_bundle` 的 maxCharacters 截断和无 query 的 top-N 路径 | tools.integration.test.ts |

---

## 六、数据模型与生命周期

### 中严重度（2 项，均为遗留）

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| D1 | `memories.thread_id` 缺少单列索引。复合索引 `(project_id, thread_id)` 不能被 CASCADE 删除时仅按 `thread_id` 查找所用，可能导致全表扫描 | schema.ts:41-55 | 大数据量下 CASCADE 删除性能 |
| D2 | `deleteThread` 中 `clearMemoriesForThread` 与 ON DELETE CASCADE 冗余——功能正确但增加维护认知负担 | threadStore.ts:90-95 | 建议二选一 |

### 低严重度（4 项）

| # | 问题 | 位置 |
|---|------|------|
| D3 | Working Memory 不受 maxCharacters 预算控制 | contextBundle.ts:107-109 |
| D4 | `maxCharacters <= 3` 硬编码阈值含义不清 | contextBundle.ts:143-146 |
| D5 | FTS 虚拟表缺少 INSERT/UPDATE 触发器，当前安全但如果将来增加 memory 更新功能将失去同步 | schema.ts:74-79 |
| D6 | `distillThreadMemories` 空结果时不清理旧 memories | distillThread.ts:171-173 |

---

## 跨维度汇总：优先级矩阵

### 建议修复（中优先级，6 项）

| # | 维度 | 问题 | 改动量 |
|---|------|------|--------|
| S1 | 安全 | toFtsQuery orTerms 空 terms 守卫 | ~3 行 |
| M1 | MCP 体验 | search_memory 描述字段层级误导 | 文档 |
| M2 | MCP 体验 | save_thread 描述补 rawFormat 可选值 | 文档 |
| M3 | MCP 体验 | get_context_bundle 返回格式说明 | 文档 |
| D1 | 数据模型 | memories.thread_id 缺少单列索引 | ~2 行 SQL |
| T1 | 测试 | 补 searchMemories 空查询防御测试 | ~5 行 |

### 可后续处理（低优先级，16 项）

C1-C6 代码冗余/风格、S2-S3 CLI 次要校验、M4-M9 MCP 描述细节、D2-D6 数据模型、T2-T5 测试补充

---

## 修复进展总结

### 三轮审计修复追踪

| 轮次 | 高优先级问题 | 修复状态 |
|------|-------------|----------|
| 第一轮（post-fix-audit） | 9 项（D1 CASCADE矛盾、S1-S3 MCP输入校验、M1-M3 MCP参数/描述、T1-T3 测试） | **9/9 全部修复** |
| 第二轮（hardening-audit） | 6 项（D1-D2 预算控制、C1 switch default、S1 query max、S2-S3 CLI kind、T1 catch测试） | **6/6 全部修复** |
| 本轮 | 0 项 HIGH | — |

### 代码质量评价

经过三轮迭代审计，Mira 的代码质量显著提升：
- 所有 HIGH 和 P0/P1 级别问题已清零
- SQL 注入、FTS 注入防护完备
- MCP 入口 Zod schema 完整覆盖所有参数边界
- CLI 入口与 MCP 入口的校验对齐度大幅改善
- 测试从 87 个增长到 99 个，三条并发去重路径和预算控制策略都有精确测试
- 剩余问题均为中/低优先级的描述优化、索引补充和防御性编程完善
