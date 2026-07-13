# Mira MVP 多角度审计报告

审计日期：2026-07-10
审计范围：数据层、CLI 层、MCP 层、Agent 闭环可用性、测试覆盖、安全与工程健壮性
代码状态：18 个测试文件、51 个用例全部通过，`npm run build` 通过

---

## 一、计划与实现一致性

上一轮审计发现的核心问题修复情况：

| 上轮问题 | 状态 |
|----------|------|
| 搜索排序不一致 | ✅ 已修复，现在是 `importance → confidence → score → created_at` |
| CLI 参数命名差异 | ✅ 已修复，`thread save` 同时支持 `--format` 和 `--raw-format`，`memory search` 同时支持位置参数和 `--query` |
| Memory kind 缺 `task`/`fact`/`failed_attempt` | ✅ 已修复，现在 11 种 kind 完整包含 |
| Working Memory kind 缺 `current_phase`/`recent_decision` | ⚠️ 代码仍为 8 种（多了 `decision`/`note`，但缺 `current_phase`/`recent_decision`），不过 AGENTS-template.md 已自洽 |

**唯一遗留**：MVP 计划文档（`2026-07-09-mira-mvp.md`）中的 kind 枚举列表仍是旧版（7 种 Memory kind、6 种 Working Memory kind），与实际代码不一致。需要同步更新计划文档。

---

## 二、Agent 闭环可用性

| 级别 | 问题 | 位置 |
|------|------|------|
| **🔴 严重** | **所有 7 个 MCP 工具的 description 是无意义占位符**（`"Mira get_context_bundle tool"` 这种格式）。没有预配 CLAUDE.md 行为引导的 Agent 完全无法理解工具用途，闭环在入口断裂 | `src/mcp/server.ts:180` |
| ⚠️ 中等 | `search_memory` 只接受 `query`，无法按 `kind` 过滤。想精确搜 `failed_attempt` 只能把 kind 拼进搜索词碰运气 | `src/mcp/server.ts` |
| ⚠️ 中等 | `save_thread` 要求 Agent 提供 `id`（UUID），但 description 和 AGENTS.md 都没说明 id 格式，Agent 可能传入不合规 id | tool schema |
| ⚠️ 低 | claude-code.md / cursor.md 配置文档缺少前置步骤：未提到需要先 `npm run build`，也未说明 `.mira/` 目录不存在时是否自动创建 | `docs/agent-config/` |

**AGENTS.md 模板**：行为引导清晰完整，覆盖开始/过程/结束三阶段。CLAUDE-template.md 存在且与 AGENTS-template.md 一致性好。

**Context Bundle 格式**：输出顺序正确（先 Working Memory 后 Long-Term Memory），每条 Memory 带 kind/source/confidence 标签，Markdown 格式 Agent 友好。

---

## 三、测试覆盖与质量

### 覆盖概况

18 个测试文件、51 个用例，全部通过。端到端集成测试 `localLoop.test.ts` 覆盖完整闭环（init → save → distill → search → working → bundle → export）。

### 测试分类

- **单元测试（10）**：schema、projectStore、projectRoot、threadStore、memoryStore、workingMemoryStore、contextBundle、distillThread、llmDistill、exportProject
- **CLI 测试（5）**：cli-smoke、phase4-cli、import-cli、llm-distill-cli、mcp-serve
- **集成测试（2）**：localLoop（端到端闭环）、tools.integration（MCP 工具链路）

### 未覆盖的模块/场景

| 盲区 | 风险 |
|------|------|
| MCP 工具异常路径（缺参、非法 kind、不存在的 thread ID） | 最大盲区——MCP 是 Agent 唯一入口，异常处理直接影响 Agent 体验 |
| `src/mcp/transport.ts`（stdio 端到端） | 只测了 `--help`，没有实际 stdio 连接测试 |
| `distillThread` 对不存在的 thread ID 的行为 | 应抛错但没测 |
| `exportProject` 空项目导出 | 可能产出非法结构 |
| `distillThread` 的 4 种 heading 映射未覆盖（architecture、preferences、notes、todos） | `kindForHeading` 部分分支没测 |
| `contextBundle` 极端 `maxCharacters`（≤3） | 边界分支未覆盖 |

### 建议补充的高价值测试（Top 5）

1. **MCP 工具异常路径测试** — 调用 `callMiraTool` 传入缺少必填参数、非法 kind 值、不存在的 thread ID，验证抛出合理错误
2. **`distillThread` 不存在的 thread** — `distillThreadMemories` 对不存在的 threadId 应抛 `Thread not found`
3. **`exportProject` 空项目** — 项目无任何 memory 和 working memory 时导出 JSON/Markdown 应生成合法的空结构
4. **`contextBundle` 零数据和极小 maxCharacters** — 无 memory 无 working memory 时 bundle 内容，以及 `maxCharacters=3` 的极端截断
5. **`distillThread` 缺失 heading 类型覆盖** — 补充 architecture、preferences、notes、todos 四种 heading 映射的测试

---

## 四、安全与工程健壮性

| 检查项 | 状态 |
|--------|------|
| SQL 注入 | ✅ 全部使用参数化查询（`?` 占位符或 `@named`），FTS 查询用 `toFtsQuery()` 转义双引号 |
| 路径遍历 | ✅ 文件读取使用 `resolve()` 规范化路径；导出用 `join()` 拼接。`--out` 参数未做白名单校验但 MVP 是本地单用户工具，风险可接受 |
| 输入验证 | ⚠️ MCP 工具的 `kind` 参数使用 `z.string()` 验证类型但**未做白名单校验**——`stringArg(args, "kind") as MemoryKind` 是直接类型断言，传入任意字符串会写进数据库 |
| 依赖安全 | ✅ 依赖少且版本合理（`better-sqlite3`、`commander`、`zod`、MCP SDK），无已知高危漏洞 |
| 数据库安全 | ✅ `foreign_keys = ON`；⚠️ 未启用 WAL 模式，并发写入时可能锁表（MVP 单进程场景问题不大） |
| `.gitignore` | ✅ `.mira/`、`.env`、`node_modules/`、`dist/`、`.DS_Store` 全部忽略 |
| MCP stdio | ✅ 只走 stdio（不开 HTTP），无网络暴露风险 |
| 错误处理 | ✅ 异常信息不泄露数据库内容；⚠️ `withToolSession` 每次调用都 `openDatabase + migrate + close`，频繁调用性能不优 |

---

## 五、行动建议（按优先级排列）

| 优先级 | 行动 | 说明 |
|--------|------|------|
| **P0** | **重写 MCP 工具 description** | 当前是 `"Mira ${toolName} tool"` 占位符。每个工具需要一句精确描述用途的英文句子，这是 Agent 自主调用的唯一依据 |
| **P1** | MCP `kind` 参数加白名单校验 | 目前 `as MemoryKind` 是类型断言不是运行时校验，任意字符串都能写入数据库 |
| **P1** | 补 MCP 工具异常路径测试 | 缺参、非法 kind、不存在的 ID——最大测试盲区 |
| **P2** | 同步更新计划文档的 kind 枚举 | 计划文档仍列 7 种 Memory kind / 6 种 Working Memory kind |
| **P2** | `search_memory` 增加可选 `kind` 过滤参数 | 不改核心逻辑，在 WHERE 子句加一个条件即可 |
| **P2** | `save_thread` 的 `id` 改为可选，server 端自动生成 | 降低 Agent 使用门槛 |
| **P2** | Agent 配置文档补充前置步骤（build、init） | 用户照抄目前会启动失败 |
| **P3** | 补 `distillThread` 不存在 thread、空项目导出、极端 maxCharacters 测试 | 边界场景 |
| **P3** | MCP server 考虑连接复用（不要每次调用都 open+migrate+close） | 性能优化 |
| **P3** | 启用 SQLite WAL 模式 | 未来多工具并发时需要 |

---

## 六、总体评价

MVP 的核心功能闭环已经完整跑通，数据层、CLI 层实现质量很高。48 → 51 个测试全部通过，代码使用参数化 SQL、严格 TypeScript、事务写入，工程质量扎实。

最大的问题是 **MCP 工具 description 是占位符**——这是 Agent 能否自主使用 Mira 的关键，修复成本极低（每个工具写一句话）但影响极大。其次是 MCP 层缺少运行时 kind 校验和异常路径测试。

修复 P0 + P1 后，Mira MVP 即可投入实际使用。
