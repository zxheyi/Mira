# Mira MVP 审计报告（第三轮）

审计日期：2026-07-10
代码状态：18 个测试文件、54 个用例全部通过，`npm run build` 通过
对比基准：上一轮审计报告（同日）

---

## 上轮问题修复情况

| 上轮问题 | 优先级 | 状态 |
|----------|--------|------|
| MCP 工具 description 是无意义占位符 | P0 | ✅ 已修复。7 个工具全部改为有意义描述，测试断言 description 长度 >40 且不含旧占位符 |
| MCP `kind` 参数缺少运行时白名单校验 | P1 | ✅ 已修复。`memoryKindArg` / `workingMemoryKindArg` 对 `MEMORY_KINDS` / `WORKING_MEMORY_KINDS` 做 `includes` 检查并抛异常，schema 层也用 `z.enum()` 约束 |
| MCP 工具异常路径测试缺失 | P1 | ✅ 已修复。新增两个测试用例：非法 kind 抛异常、缺少必填参数抛异常 |
| 计划文档 kind 枚举与代码不一致 | P2 | ✅ 已修复。计划文档已更新为 11 种 Memory kind、8 种 Working Memory kind，与代码完全一致 |
| `search_memory` 无 `kind` 过滤参数 | P2 | ❌ 未修复。仍只接受 `query` 参数 |
| `save_thread` 的 `id` 改为可选 | P2 | ❌ 未修复。`id` 仍为必填，Agent 需自行生成 |
| Agent 配置文档补充前置步骤 | P2 | ❌ 未修复。claude-code.md / cursor.md 仍缺少 `npm run build` 和 `mira init` 前置说明 |
| `distillThread` 不存在 thread 测试 | P3 | ❌ 未覆盖 |
| 空项目导出测试 | P3 | ❌ 未覆盖 |
| 极端 `maxCharacters` 测试 | P3 | ❌ 未覆盖 |

**总结：4 个 P0/P1 问题全部修复，3 个 P2 和 3 个 P3 仍未处理。**

---

## 当前状态各维度评价

### 一、MCP Agent 接口 — ✅ 核心可用

- ✅ 7 个工具 description 清晰，Agent 可自主理解何时调用
- ✅ `kind` 参数有运行时白名单校验 + schema `z.enum()` 双重保护
- ✅ 异常路径有测试守护
- ⚠️ `search_memory` 无 `kind` 过滤——搜 `failed_attempt` 需依赖 FTS 文本匹配
- ⚠️ `save_thread.id` 仍为必填——Agent 需生成 ID，文档未说明格式约定

### 二、计划与代码一致性 — ✅ 已对齐

- ✅ Memory kind（11 种）、Working Memory kind（8 种）计划/代码/AGENTS 模板三方一致
- ✅ distill heading 映射使用 10 种 kind，`constraint` 通过其他路径写入，无冲突
- ✅ 搜索排序（`importance → confidence → score → created_at`）已一致

### 三、测试覆盖 — ⚠️ 核心路径完备，边界仍有盲区

已覆盖：
- ✅ MCP 异常路径（非法 kind、缺参）
- ✅ distill heading 映射（新增 task/fact/failed_attempt）

仍未覆盖：
- ❌ `distillThread` 对不存在的 thread ID
- ❌ `exportProject` 空项目导出
- ❌ `contextBundle` 极端 `maxCharacters`（≤3）
- ❌ distill heading 中 architecture/preferences/notes/todos 四种映射

### 四、Agent 配置文档 — ⚠️ 语义已清晰，操作步骤仍缺

- ✅ `save_thread` 语义已在 AGENTS-template.md、CLAUDE-template.md、README.md 中明确为"Agent 生成的摘要"
- ❌ claude-code.md / cursor.md 缺少前置步骤（`npm install && npm run build`、`mira init`）
- ❌ `save_thread` 的 `id` 格式约定未记录

---

## 仍需处理的行动项

| 优先级 | 行动 | 说明 |
|--------|------|------|
| P2 | Agent 配置文档补前置步骤 | claude-code.md / cursor.md 加上 `npm install && npm run build` 和 `mira init` 说明，否则用户照抄会启动失败 |
| P2 | `search_memory` 增加可选 `kind` 过滤 | 在 WHERE 子句加一个条件，让 Agent 能精确搜特定类型记忆 |
| P2 | `save_thread.id` 改为可选 | server 端自动生成 UUID，降低 Agent 使用门槛 |
| P3 | 补边界测试（4 个场景） | 不存在 thread ID、空项目导出、极端 maxCharacters、剩余 heading 映射 |

---

## 整体评价

Mira MVP 经过三轮审计迭代，核心功能闭环已完整可用：

- **数据层**：Schema 完整、去重可靠、FTS 索引覆盖 title + content
- **CLI 层**：14 个命令全部实现，参数兼容性良好，输出 JSON 可脚本读取
- **MCP 层**：7 个工具描述清晰、输入校验严格、异常路径有测试守护
- **Agent 闭环**：get_context_bundle → search → add_memory → set_working_memory → save_thread 完整
- **文档**：AGENTS.md / CLAUDE.md 模板行为引导清晰，计划文档与代码已对齐

剩余 P2/P3 项均为体验优化和边界覆盖，不影响 MVP 投入使用。**建议优先处理 Agent 配置文档的前置步骤，这是用户接入时最先遇到的问题。**
