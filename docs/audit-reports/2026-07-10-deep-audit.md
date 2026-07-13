# Mira MVP 深度审计报告

审计日期：2026-07-10
代码状态：18 个测试文件、54 个用例全部通过，`npm run build` 通过
审计维度：代码质量与架构、Distill 规则完整性、数据生命周期、CLI UX、Context Bundle 实用性、Import/LLM Distill 扩展

---

## 一、代码质量与架构

### 逐模块评价

| 模块 | 评价 | 说明 |
|------|------|------|
| db/ | ✅ | client.ts / schema.ts 简洁干净，migrate 幂等设计合理 |
| projects/ | ✅ | 类型定义清晰，Row→Domain 映射统一 |
| threads/ | ✅ | upsert 用 `ON CONFLICT` 正确，saveThread 后回读保证返回值一致 |
| workingMemory/ | ✅ | upsert 正确，clearWorkingMemory 支持按 kind 或全部清除 |
| memory/ | ✅ | 事务包裹 insert + FTS 同步写入，去重通过 content_hash 实现 |
| context/ | ✅ | 纯函数组装 Markdown，职责单一 |
| distill/ | ⚠️ | `distillThread.ts` 和 `llmDistill.ts` 有 `getThreadRawText` 重复查询逻辑 |
| export/ | ⚠️ | `ProjectRow` 类型重复定义（与 projectStore 的 ProjectRow 相同） |
| importers/ | ⚠️ | 最大文件（261 行），`inferTitle` 和 `inferFileTitle` 功能高度重叠 |
| mcp/server.ts | ⚠️ | Zod schema 和手写 arg 提取函数并存但互不关联，`args as ToolArgs` 跳过了 Zod 验证 |
| mcp/transport.ts | ✅ | 薄封装，职责清晰 |
| cli (index.ts) | ✅ | `withDatabase` / `withProject` 确保 db.close() 在 finally 中执行 |

### 架构级问题

**MCP server `withToolSession` 每次 open+migrate+close**：每个 tool 调用都重新打开数据库、执行全部 `CREATE TABLE IF NOT EXISTS`、再关闭。改进方案：在 `createMiraMcpServer` 中一次性 open+migrate，将 db 实例存储在闭包中，所有 tool 调用共享，server 生命周期结束时 close。

### Top 3 改进建议

1. **MCP server 连接池化** — 将 open+migrate+close 改为 server 级别单例连接，消除最大架构浪费
2. **统一参数校验** — Zod schema 和手写 arg 函数应统一，当前双轨并行容易不一致
3. **消除重复代码** — `getThreadRawText`（distill 两文件重复）、`ProjectRow`（export 重复定义）、`inferTitle/inferFileTitle`（importer 内重复）

---

## 二、Distill 规则完整性

### 当前覆盖范围

确定性规则仅依赖 heading 精确匹配（10 种 heading 映射到 10 种 kind）。提取逻辑：优先逐行 bullet，无 bullet 则拼接为整段。无前缀匹配规则。

### 真实会话模拟

用 `019f45f0-...` 会话文件模拟：`## Key Decisions` 下 7 条 bullet 会被正确提取为 `decision`（importance=8）。**但 `## MVP Shape`、`## Data Model Sketch`、`## Project Context` 全部被丢弃**——它们不在 heading 映射表中。这三个 section 含核心架构信息，全部遗漏。

### 关键遗漏场景

1. **自定义 heading 全部丢弃** — `MVP Shape`、`Data Model Sketch`、`Implementation Plan` 等非标准 heading 下的内容被静默忽略，无 fallback
2. **Debug 会话的过程知识不可提取** — Agent 尝试多种方案的过程信息散布在对话正文中，没有 heading 结构，规则无法捕获
3. **`constraint` 无入口** — `MEMORY_KINDS` 包含 `constraint`，但 `kindForHeading` 无任何 heading 映射到它
4. **多行 bullet 被截断** — 缩进续行不会被合并到上一条，而是被丢弃或拼接为新段落
5. **原始对话部分不被分析** — 会话文件常在末尾附完整对话记录，完全不被提取

### 改进建议

1. 添加 `constraint` 的 heading 映射（`["constraints", "project constraints"]` → `constraint`）
2. fallback 机制：未匹配的 heading 默认归为 `note`（importance=4），避免静默丢弃
3. 支持多行 bullet 合并：检测缩进续行并拼入上一条 entry

---

## 三、数据生命周期完整性

### 创建/写入一致性

| 实体 | 路径 | 一致性 |
|------|------|--------|
| Project | CLI `project add` + `ensureProjectForRoot` | ✅ 一致 |
| Thread | CLI `thread save` + `import` + MCP `save_thread` | ✅ 三条路径都调用同一个 `saveThread()` |
| Memory | CLI `memory add` + `memory distill` + MCP `add_memory` | ✅ 三条路径都调用同一个 `addMemory()` |
| Working Memory | CLI `working set` + MCP `set_working_memory` | ✅ 一致 |

### 更新幂等性

| 操作 | 机制 | 状态 |
|------|------|------|
| Thread 重复保存 | `ON CONFLICT(id) DO UPDATE` | ✅ upsert |
| Memory 重复写入 | `findDuplicateMemory` + content_hash | ✅ 幂等 |
| Working Memory | `ON CONFLICT(project_id, kind) DO UPDATE` | ✅ upsert |

### 删除/清理 — 存在缺口

| 问题 | 严重度 | 说明 |
|------|--------|------|
| **memory_fts 幽灵记录** | 🔴 高 | 级联删除 project/thread 时 `memories` 表行被删除，但 `memory_fts` 虚拟表中对应记录不会被清理（FTS 不支持外键级联），导致搜索出幽灵记录 |
| Thread 和 Project 无删除接口 | ⚠️ 中 | 数据只增不减，没有 `deleteThread` 或 `deleteProject` 接口 |
| `clearMemoriesForThread` 未暴露给用户 | ⚠️ 低 | 仅在 distill 前内部使用，用户无法手动清除某个 thread 的记忆 |

### 导出 — 不完整

| 问题 | 说明 |
|------|------|
| 导出不包含 threads | 无法重建 thread 关联，也无法重新 distill |
| 导出产物无法重新导入 | `mira import` 导入的是 agent session 文件，不是 mira export 产物，不构成完整备份/恢复方案 |

---

## 四、CLI 用户体验

### 正面评价

- 命令层级清晰：`mira {resource} {verb}`
- 成功输出统一用 `printJson()` 到 stdout，适合脚本消费
- 错误输出到 stderr + exit 1，一致性好
- `--db` / `--project-root` 全局选项默认值合理

### 问题点

| 问题 | 严重度 | 说明 |
|------|--------|------|
| **项目根探测失败时静默回退 cwd** | ⚠️ 中 | 非 git 目录运行会在当前目录创建 `.mira/` 而不自知 |
| 自定义错误缺少 usage 提示 | ⚠️ 中 | 只输出 error message，没有 "Run 'mira <cmd> --help'" 提示 |
| `thread save` 的 `--format` 和 `--raw-format` 重复 | ⚠️ 低 | help 里两个选项描述都是 "Raw format"，用户不知道该用哪个 |
| `working` 命名不够直觉 | ⚠️ 低 | 新用户看到 `mira working set` 会困惑，建议加 alias `wm` |
| 读操作在空库时无提示 | ⚠️ 低 | `memory search` 在空库时返回空结果，不提示 "Run 'mira init' first?" |

---

## 五、Context Bundle 实用性

### 正面评价

- 结构清晰：Working Memory 在前、Long-Term Memory 在后
- Markdown 格式对 Agent 友好
- 每条 Memory 带 kind/source/confidence 标签

### 问题与改进建议

| 问题 | 严重度 | 改进建议 |
|------|--------|----------|
| **截断策略暴力** | 🔴 高 | `truncateToBudget` 对完整 Markdown 做 `slice`，可能截断到 Memory 中间。应改为按条目级别截断：先保留完整 Working Memory，再逐条加入 Long-Term Memory 直到预算耗尽 |
| Working Memory 缺乏语义排序 | ⚠️ 中 | 当前按插入顺序排列，但 `blocker` 和 `current_task` 应优先于 `note`。建议按 kind 优先级排列 |
| 缺少"警告/踩坑"分区 | ⚠️ 中 | `failed_attempt`/`lesson`/`constraint` 类型的 memory 没有独立分组突出，Agent 最容易重蹈覆辙的信息淹没在普通 memory 中 |
| Long-Term Memory 元数据冗余 | ⚠️ 低 | 每条输出 kind/source/confidence 三行，`source: manual`、`confidence: 1` 对 Agent 价值低，建议仅在非默认值时输出 |
| 缺少时间锚点 | ⚠️ 低 | Bundle 没有 `createdAt` / `updatedAt`，Agent 无法判断信息新鲜度 |

---

## 六、Import 和 LLM Distill 扩展

### agentSessionImporter.ts — ✅ 质量良好，可安全使用

- 支持 codex / claude-code / markdown source，markdown / jsonl format
- JSONL 解析健壮：空行跳过、逐行 try/catch 报行号、兼容 Claude Code 嵌套结构和 Codex 扁平结构
- stable ID 基于 `sha256(source + path + content)` 保证重复导入幂等
- 测试覆盖 6 个用例，含错误路径

### llmDistill.ts — ✅ 质量良好，有一个设计点需注意

- Prompt 质量好：含 JSON schema 示例、完整 kind 列表、规则约束
- 输出解析严格：支持纯数组和包装格式，字段有类型和范围校验
- Apply 逻辑安全：先校验 thread 存在，clear-before-write 保证幂等
- **缺少候选数量上限** — LLM 幻觉返回 500 条 memory 会全部写入，建议加上限（如 50 条）

### Spec 偏差

- Spec 002 标记 JSONL 为"非目标"，但实现已支持——spec 需要更新

---

## 综合行动建议

### P0 — 数据正确性

| 行动 | 说明 |
|------|------|
| 修复 memory_fts 幽灵记录 | 级联删除 project/thread 时需同步清理 FTS 表。可通过 SQLite trigger 或在删除操作中手动清理 |

### P1 — 核心体验

| 行动 | 说明 |
|------|------|
| Context Bundle 改为条目级截断 | 先保留完整 Working Memory，再逐条加入 Memory 直到预算耗尽 |
| MCP server 连接池化 | 将 withToolSession 的 open+migrate+close 改为 server 级别单例连接 |
| 统一 MCP 参数校验 | Zod schema 和手写 arg 函数应统一为一套 |
| 项目根探测失败时输出警告 | 而非静默回退 cwd |

### P2 — 实用性增强

| 行动 | 说明 |
|------|------|
| Context Bundle 增加 Warnings 分区 | `failed_attempt`/`lesson`/`constraint` 独立分组 |
| Context Bundle Working Memory 按 kind 优先级排序 | `blocker` > `current_task` > `next_step` > ... |
| distill fallback 机制 | 未匹配的 heading 默认归为 `note`，避免静默丢弃 |
| 添加 `constraint` heading 映射 | 一行修复 |
| LLM distill 加候选数量上限 | 防止 LLM 幻觉批量写入 |
| export 包含 threads | 导出完整性 |
| CLI 错误信息加 usage 提示 | "Run 'mira <cmd> --help' for usage" |

### P3 — 打磨

| 行动 | 说明 |
|------|------|
| 消除重复代码 | `getThreadRawText`、`ProjectRow`、`inferTitle/inferFileTitle` |
| `working` 命令加 alias `wm` | 降低命名困惑 |
| 读操作空库时提示 | "No memories found. Run 'mira init' first?" |
| Context Bundle 加时间锚点 | Working Memory 条目中标注 `updatedAt` |
| 更新 spec 002 JSONL 范围 | 实现已超前支持 |
| distill 多行 bullet 合并 | 处理缩进续行 |

---

## 整体评价

Mira MVP 的工程质量扎实，核心闭环完整可用。经过前三轮审计迭代，P0/P1 级别的功能性问题（MCP description、kind 校验、计划对齐）已全部修复。

本轮深度审计发现的问题集中在两个方向：

1. **数据完整性**：`memory_fts` 在级联删除时不同步清理，会产生幽灵搜索结果。这是当前最高优先级的 bug。
2. **Context Bundle 实用性**：截断策略过于暴力、缺少 Warnings 分区和语义排序，影响 Agent 恢复上下文的效率。这是 Mira 核心价值交付的关键路径。

其余问题（MCP 连接池化、distill fallback、CLI UX 打磨）均为体验优化，不阻碍 MVP 投入使用。
