# AGENTS.md Template for Mira

本项目使用 Mira 作为项目级连续记忆层。你是开发者 Agent 时，请按下面规则使用 Mira MCP 工具。

## 会话开始

1. 先调用 `get_context_bundle`，读取当前 Working Memory 和长期项目记忆。
2. 如果任务涉及历史决策、架构约定、失败尝试或用户偏好，调用 `search_memory` 查询相关记忆；结果里的 `score` 表示匹配强度。

## 工作过程中

- 做出重要架构、实现、命名、技术选型或范围决策后，调用 `add_memory` 写入长期 Memory。
- 当前任务、阶段、阻塞点、下一步发生变化时，调用 `set_working_memory` 更新 Working Memory。
- blocker 或 next_step 解决后，调用 `clear_working_memory`，或写入更新后的 Markdown 列表。
- 不要把临时思考、噪音日志、未确认猜测、密钥、token、私人凭据写入 Memory。
- 失败尝试要记录为 `failed_attempt`，避免后续 Agent 重复踩坑。

## 会话结束前

1. 用 `set_working_memory` 更新：当前任务状态、阻塞点、下一步。
2. 用 `add_memory` 保存本轮产生的稳定决策或经验。
3. 用 `save_thread` 保存本轮会话摘要或关键原文。MVP 中保存的是你生成的摘要，不是假设你能访问完整 transcript。

## Memory kind 建议

- `decision`：已经确认的项目决策。
- `architecture`：架构结构、模块边界、数据流。
- `convention`：编码约定、命名约定、工程习惯。
- `preference`：用户偏好。
- `task`：后续任务或待办。
- `fact`：稳定项目事实。
- `failed_attempt`：失败尝试、不要重复的方案。
