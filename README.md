# Mira

Mira 是一个本地优先的项目记忆系统，目标是让 Codex、Claude Code、Cursor、OpenClaw 等开发者 Agent 在同一个项目里连续工作，而不是每次新会话都从零开始理解上下文。

一句话定位：

> Mira 不是另一个通用 AI 工作台，也不是消费者个人记忆产品。Mira 是给 AI 编程 Agent 用的项目级连续记忆层，负责记录项目为什么走到今天，以及下一步应该怎么继续。

## 为什么需要 Mira

开源世界已经有 Rowboat、Khoj、AnythingLLM、mem0、Supermemory、Letta、projectmem 等项目。Mira 的意义不在于做得更大，而在于做得更窄、更贴近真实开发工作流：

- Agent 换了，项目上下文不能丢。
- 会话结束了，关键决策不能只留在聊天记录里。
- Bug 调过了，失败尝试不能被下一个 Agent 重复。
- 项目推进中，当前任务、近期决策和偏好需要有一个短小、可靠的入口。
- 记忆必须本地可控、可导出、可审计，而不是黑盒平台状态。

Mira 关注的是项目连续性，不追求成为完整桌面 AI coworker、企业知识库、通用自动化平台或个人生活助理。

## 核心概念

### Thread

一次真实 Agent 会话的原始记录。它可以来自 Codex、Claude Code、Cursor 或其他工具。Thread 是记忆提炼的来源，也是必要时回溯上下文的证据。

### Memory

从 Thread 中提炼出的长期项目记忆。它应该短、稳定、可检索，例如架构决策、编码约定、失败尝试、用户偏好、项目事实和后续任务。

### Working Memory

当前项目的短期工作快照。它回答“现在正在做什么”：当前目标、当前阶段、最近决策、阻塞点、下一步动作和用户偏好。MVP 中 Working Memory 是 Agent 恢复上下文的第一入口。

### Context Bundle

为 Agent 生成的 Markdown 上下文包。它优先包含 Working Memory，再包含与当前项目相关的长期 Memory，便于注入新会话或通过 MCP 返回给 Agent。

## MVP 边界

MVP 只做一条闭环：

```text
保存会话 -> 提炼项目记忆 -> 维护工作记忆 -> 搜索记忆 -> 输出上下文包 -> 通过 CLI/MCP 给 Agent 使用
```

MVP 包含：

- 本地 `.mira/mira.sqlite` 存储。
- 自动探测当前 Git 项目根目录。
- 保存 Agent 会话为项目关联 Thread。
- 从会话中提炼确定性 Memory。
- 支持 Agent 通过 MCP 主动保存 Thread 和写入 Memory。
- 维护 Working Memory。
- 使用 SQLite FTS5 搜索项目记忆。
- 生成短小的 Markdown Context Bundle。
- 支持 Markdown / JSON 导出，保证本地可审计。
- 提供 CLI 命令给人类使用。
- 提供 MCP stdio server 给 Agent 使用。
- 提供 Claude Code、Cursor 等接入示例，以及 AGENTS.md 行为引导模板。

MVP 暂不做：

- 多用户账号、云同步、计费或公开 Web App。
- 通用消费者个人记忆。
- 邮件、会议、浏览器和 Slack 等大集成。
- 完整知识图谱 UI。
- 插件市场。
- 大而全的 Agent 工作台。
- 复杂向量检索，先用 SQLite FTS 跑通闭环。

## 设计原则

- **项目优先**：记住项目的决策、约定、任务和踩坑，而不是泛化成用户画像产品。
- **Working Memory 优先**：先让 Agent 快速知道当前项目状态，再按需检索长期记忆。
- **本地优先**：数据默认保存在项目 `.mira/` 目录，可备份、可删除、可检查。
- **朴素可维护**：MVP 使用 SQLite、Markdown、CLI、MCP，不引入重服务栈。
- **可审计**：原始 Thread 保留，Memory 可以追溯来源。
- **可注入**：输出必须是 Agent 易消费的短 Markdown，而不是只给人看的长文档。

## MVP 架构决策

MVP 采用每项目一个 Mira 实例的模型：

- 数据库默认位于项目内 `.mira/mira.sqlite`。
- `mira mcp serve` 启动时绑定一个 `--project-root` 和一个 `--db`。
- MCP 工具入参仍可携带 `projectRoot`，但未传时使用启动时绑定的项目。
- 如果命令或工具探测到项目根目录，但数据库里没有 Project 记录，Mira 自动创建 Project，名称使用目录名。
- Claude Code、Cursor 等 Agent 配置示例必须使用绝对路径，避免 MCP client 从用户 home 目录启动时找错数据库。
- 全局多项目数据库和跨项目记忆放到 post-MVP。

Agent 使用 Mira 的基本习惯：

- 会话开始先读取 `get_context_bundle`。
- 涉及历史决策、踩坑或约定时调用 `search_memory`，结果包含 Memory 和匹配分数。
- 做出重要决策后调用 `add_memory` 或更新 Working Memory。
- 会话结束前通过 `save_thread` 保存本轮摘要；完整 transcript 自动捕获放到 post-MVP。

## CLI 快速使用

Phase 4 已提供本地 CLI 闭环。常用命令示例：

```bash
mira init
mira project list
mira import --source codex --path ./codex-session.md
mira import --source claude-code --path ./claude-session.md --id claude_session_1
mira import --source claude-code --format jsonl --path ./claude-transcript.jsonl
mira import --source codex --format jsonl --path ./codex-transcript.jsonl
mira thread save --id thread_1 --title "Session" --source codex --format markdown --text "## Key Decisions\n- Use Mira."
mira memory distill --thread thread_1
mira memory llm-prompt --thread thread_1
mira memory apply-candidates --thread thread_1 --path ./candidates.json
mira memory add --title "Preference" --kind preference --content "Keep output script-friendly." --source manual
mira memory search --query "script-friendly"
mira working set --kind current_task --content "Continue Phase 4."
mira working list
mira context bundle --query "Mira"
mira export --format json --out ./export
mira export --format markdown --out ./export
```

默认数据库为当前项目的 `.mira/mira.sqlite`。脚本和测试也可以显式传入：

```bash
mira --project-root /path/to/project --db /path/to/.mira/mira.sqlite init
```

`mira import` 目前支持 Codex、Claude Code 和通用 Markdown 会话摘要，也支持 Codex / Claude Code 的 JSONL transcript。导入后会保存为 Thread；Markdown 未传 `--title` 时优先使用第一个 H1，没有 H1 时使用文件名。JSONL 会被 normalize 成可读 Markdown 后保存，`rawFormat` 保留为 `jsonl`。

`mira memory llm-prompt` 和 `mira memory apply-candidates` 提供可审查的 LLM 提炼流程：先生成提示词，再把审查后的候选记忆 JSON 写入 Memory。

## MCP 快速配置

Mira MVP 提供每项目一个 stdio MCP server。推荐使用绝对路径绑定项目和数据库：

```bash
mira mcp serve --project-root /path/to/project --db /path/to/project/.mira/mira.sqlite
```

Agent 可用工具：

```text
get_context_bundle
search_memory
set_working_memory
list_working_memory
clear_working_memory
add_memory
save_thread
```

MVP 中 `save_thread` 的输入是 Agent 生成的会话摘要或关键摘录，不是假设 Agent 能读取完整 transcript。

## 项目文档

- [Mira MVP 实施计划](docs/superpowers/plans/2026-07-09-mira-mvp.md)
- [Mira MVP Spec](specs/001-mira-mvp/spec.md)
- [Mira MVP Tasks](specs/001-mira-mvp/tasks.md)
- [Agent Session Import Spec](specs/002-agent-session-import/spec.md)
- [Agent Session Import Tasks](specs/002-agent-session-import/tasks.md)
- [LLM Distill Spec](specs/003-llm-distill-agent-guidance/spec.md)
- [Transcript JSONL Import Spec](specs/004-transcript-jsonl-import/spec.md)
- [Mira Progress](.agents/progress.md)
- [Mira Agent Context](.agents/agent-context.md)
- [Mira 开发节奏](.agents/development-rhythm.md)
- [AGENTS.md 行为引导模板](docs/agent-config/AGENTS-template.md)
- [CLAUDE.md 行为引导模板](docs/agent-config/CLAUDE-template.md)
- [Claude Code MCP 配置示例](docs/agent-config/claude-code.md)
- [Cursor MCP 配置示例](docs/agent-config/cursor.md)
- [Session 019f45f0-40bf-7261-8685-d5e0a6a8bf13](docs/sessions/019f45f0-40bf-7261-8685-d5e0a6a8bf13.md)

## 研究笔记

- [Nowledge Mem 多角度分析](docs/research/nowledge-mem-analysis.md)
- [Nowledge Mem 逆向分析报告](docs/research/nowledge-mem-reverse-engineering.md)
- [Rowboat 项目文档总结](docs/research/rowboat-summary.md)
