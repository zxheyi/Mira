# AGENTS.md Template for Mira

本项目使用 Mira 作为项目级连续记忆层。你是开发者 Agent 时，请按下面规则使用 Mira MCP 工具。

## 会话开始

1. 如果项目已安装 Mira 自动集成，先使用 `SessionStart` 注入的 Context Bundle；上下文缺失或需要刷新时调用 `get_context_bundle`。
2. 如果任务涉及历史决策、架构约定、失败尝试或用户偏好，调用 `search_memory` 查询相关记忆；结果里的 `score` 表示匹配强度。

## 工作过程中

- 并行任务使用稳定 `taskId` 调用 `get_context_bundle`、`set_working_memory`、`list_working_memory` 和 `clear_working_memory`；优先沿用 Hook 上下文给出的任务 ID。续接同一任务沿用同一个 ID，项目共同约定才写共享作用域。

- 做出重要架构、实现、命名、技术选型或范围决策后，调用 `add_memory` 写入长期 Memory。
- 当前任务、阶段、阻塞点、下一步发生变化时，调用 `set_working_memory` 更新 Working Memory。
- blocker 或 next_step 解决后，调用 `clear_working_memory`，或写入更新后的 Markdown 列表。
- 不要把临时思考、噪音日志、未确认猜测、密钥、token、私人凭据写入 Memory。
- 失败尝试优先记录为 `failed_attempt`；通用经验用 `lesson`，硬性限制或不可做事项用 `constraint`。

## 会话结束前

1. 用 `set_working_memory` 更新：当前任务状态、阻塞点、下一步。
2. 用 `add_memory` 保存本轮产生的稳定决策或经验。
3. 真实 transcript 由 Mira Hook 自动保存；只在自动接入不可用或需要独立摘要时用 `save_thread` 保存摘要或关键原文。


## MCP 参数要求

- `add_memory` 必填：`title`、`kind`、`content`、`source`；可选：`threadId`、`confidence`、`importance`。
- `save_thread` 必填：`title`、`source`、`rawFormat`、`rawText`；可选：`id`。MVP 中 `rawText` 通常是 Agent 生成的会话摘要。
- `search_memory` 必填：`query`；可选：`kind`。
- `set_working_memory` 必填：`kind`、`content`。

## LLM 提炼工作流

当需要从较长 Thread 中提炼结构化记忆时：

1. 先运行 `mira memory llm-prompt --thread <thread_id>` 生成提炼提示词。
2. 把提示词交给 LLM，要求它只返回 JSON。
3. 人类或 Agent 审查 JSON，删除不稳定、重复、敏感或推测性的候选记忆。
4. 将审查后的 JSON 保存为文件。
5. 运行 `mira memory apply-candidates --thread <thread_id> --path <candidates.json>` 写入 Memory。

不要把未经审查的 LLM 输出直接当成事实写入长期 Memory。

## Memory kind 建议

- `decision`：已经确认的项目决策。
- `architecture`：架构结构、模块边界、数据流。
- `convention`：编码约定、命名约定、工程习惯。
- `preference`：用户偏好。
- `task`：明确的后续任务或工作项。
- `fact`：稳定项目事实。
- `failed_attempt`：已经尝试但失败或不应重复的方案。
- `lesson`：经验、失败尝试、不要重复的方案。
- `constraint`：限制、边界、不可做事项。
- `todo`：后续任务或待办。
- `note`：稳定项目事实或补充说明。

## Working Memory kind 建议

- `current_task`：当前正在推进的任务。
- `current_phase`：当前阶段或交付门禁。
- `recent_decision`：最近刚做出、后续任务需要知道的决策。
- `blocker`：当前阻塞。
- `next_step`：下一步行动。
- `preference`：短期仍相关的偏好。
- `decision`：当前阶段临时决策。
- `note`：短期上下文补充。
