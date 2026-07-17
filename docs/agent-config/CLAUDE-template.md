# CLAUDE.md Template for Mira

本项目使用 Mira 作为本地项目记忆层。Claude Code 在处理任务时应主动读取和维护 Mira 记忆。

## 开始任务

- 如果项目已安装 Mira 自动集成，先使用 `SessionStart` 注入的 Context Bundle；上下文缺失或需要刷新时调用 `get_context_bundle`。
- 如果任务涉及历史决策、架构、编码约定、失败尝试或用户偏好，调用 `search_memory`。
- 不要只依赖当前聊天上下文判断项目历史。

## 进行任务

- 做出稳定决策时调用 `add_memory`。
- 当前任务、阻塞点、下一步变化时调用 `set_working_memory`。
- 阻塞点解决后调用 `clear_working_memory` 或写入更新后的列表。
- 不要写入 token、密钥、cookie、私人凭据、临时日志噪音或未经确认的推测。

## 结束任务

- 真实 transcript 由 Mira `Stop` / `SessionEnd` Hook 自动保存；只在自动接入不可用或需要独立摘要时调用 `save_thread`。
- 更新 Working Memory，明确当前状态和下一步。
- 确认稳定决策和失败经验已写入长期 Memory；不要重复保存 Hook 已捕获的完整 transcript。


## MCP 参数要求

- `add_memory` 必填：`title`、`kind`、`content`、`source`；可选：`threadId`、`confidence`、`importance`。
- `save_thread` 必填：`title`、`source`、`rawFormat`、`rawText`；可选：`id`。MVP 中 `rawText` 通常是 Agent 生成的会话摘要。
- `search_memory` 必填：`query`；可选：`kind`。
- `set_working_memory` 必填：`kind`、`content`。

## LLM Distill

当需要批量提炼长 Thread：

```bash
mira memory llm-prompt --thread <thread_id>
```

把输出交给 LLM 后，只接受如下 JSON：

```json
{
  "memories": [
    {
      "title": "Short title",
      "kind": "decision",
      "content": "Stable project memory.",
      "confidence": 0.8,
      "importance": 5
    }
  ]
}
```

审查 JSON 后再应用：

```bash
mira memory apply-candidates --thread <thread_id> --path ./candidates.json
```

`apply-candidates` 会替换该 Thread 已有的提炼记忆。应用前确认候选内容稳定、可追溯、无敏感信息。

Memory kind 可使用：`decision`、`convention`、`architecture`、`preference`、`task`、`fact`、`failed_attempt`、`lesson`、`constraint`、`todo`、`note`。

Working Memory kind 可使用：`current_task`、`current_phase`、`recent_decision`、`blocker`、`next_step`、`preference`、`decision`、`note`。
