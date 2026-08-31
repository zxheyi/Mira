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

### Markdown Vault

SQLite 项目记忆的 Obsidian-ready 只读物化视图。它把 Briefing、Working Memory、全生命周期 Memory、Thread 和待审核候选组织成带 frontmatter 与 WikiLink 的 Markdown 文件，便于人类浏览和审计。

## MVP 边界

MVP 只做一条闭环：

```text
自动捕获会话 -> 提炼项目记忆 -> 维护工作记忆 -> 搜索记忆 -> 新会话自动注入上下文 -> Agent 继续工作
```

MVP 包含：

- 本地 `.mira/mira.sqlite` 存储。
- 自动探测当前 Git 项目根目录。
- 保存 Agent 会话为项目关联 Thread。
- 从会话中提炼确定性 Memory。
- 支持 Agent 候选与可选 OpenAI-compatible Provider 的可信自动提炼。
- 高置信低风险候选自动接受，高影响、低置信或冲突候选进入审核队列。
- 支持 Agent 通过 MCP 主动保存 Thread 和写入 Memory。
- 维护 Working Memory。
- 使用 SQLite FTS5 搜索项目记忆。
- 生成短小的 Markdown Context Bundle。
- 确定性生成可直接用 Obsidian 浏览的 Markdown Vault。
- 支持 Markdown / JSON 导出，保证本地可审计。
- 提供 CLI 命令给人类使用。
- 提供 MCP stdio server 给 Agent 使用。
- 支持 Codex 与 Claude Code 的项目级 Hook/MCP 一键安装。
- 会话开始自动注入 Context Bundle，会话停止或结束自动保存真实 transcript。
- 一键扫描并批量导入当前项目的 Codex / Claude Code 历史主会话，支持旧项目路径别名、幂等重跑和失败审计。
- 提供持久化捕获检查点，避免重复处理未变化 transcript，失败后可在下次 Hook 重试。
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

### 项目身份与并行任务（schema v7）

Mira 将项目 ID 与工作目录分开保存。同一台机器、同一文件系统上的 Git 仓库改名后保留项目 ID 和旧根路径别名；linked worktree 默认使用主仓库的 `.mira/mira.sqlite`，显式 `--db` 优先。独立 clone 不按远程 URL 自动合并。

旧版本单项目默认数据库随目录一起搬迁、且原目录已不存在时，可以保留原项目。共享数据库或跨文件系统迁移不能安全自动判定时，使用 `mira --db /path/to/mira.sqlite project bind --id <project-id> --root /new/root` 显式绑定；已属于另一项目的根路径会被拒绝。迁移真实数据前应先备份数据库。目录改名后，应重新运行 `integration install` 更新含绝对路径的宿主配置。

并行任务使用全局 `--task <id>`：例如 `mira --task importer working set --kind next_step --content "补充导入测试"` 和 `mira --task importer context bundle`。MCP 的工作记忆与上下文工具支持 `taskId`；一个任务持续使用同一个 ID。未指定时保留项目共享状态，linked worktree 默认使用独立 workspace 作用域。Hook 输出带会话任务 ID，Agent 回写时沿用该 ID。任务读取、清理不会影响其他任务；上下文合并共享状态与选定任务的覆盖项。Project Briefing 仍是项目共享视图。

接口与验收依据：[项目身份与任务作用域规格](specs/022-project-identity-and-task-scope/spec.md)。

MVP 采用每项目一个 Mira 实例的模型：

- 数据库默认位于项目内 `.mira/mira.sqlite`。
- `mira mcp serve` 启动时绑定一个 `--project-root` 和一个 `--db`。
- MCP Server 启动时绑定项目，工具调用复用该项目数据库，不依赖 MCP Client 的工作目录。
- 如果命令或工具探测到项目根目录，但数据库里没有 Project 记录，Mira 自动创建 Project，名称使用目录名。
- Claude Code、Cursor 等 Agent 配置示例必须使用绝对路径，避免 MCP client 从用户 home 目录启动时找错数据库。
- 全局多项目数据库和跨项目记忆放到 post-MVP。

Agent 使用 Mira 的基本习惯：

- 安装自动集成后，会话开始由 Hook 注入 Context Bundle；未安装或需要刷新时主动调用 `get_context_bundle`。
- 涉及历史决策、踩坑或约定时调用 `search_memory`，结果包含 Memory 和匹配分数。
- 做出重要决策后调用 `add_memory` 或更新 Working Memory。
- 会话结束前更新 Working Memory 和稳定 Memory；真实 transcript 由 Hook 自动捕获，`save_thread` 保留为手动摘要兜底。

## 安装与首次运行

从源码仓库使用时，先安装依赖并构建 CLI：

```bash
npm install
npm run build
```

随后可以通过 `npm run dev -- <command>` 运行源码版，或在安装为 bin 后直接使用 `mira <command>`。

## CLI 快速使用

Phase 4 已提供本地 CLI 闭环。常用命令示例：

```bash
mira init
mira doctor
mira project list
mira project delete --id project_123 --confirm-hard-delete
mira import --source codex --path ./codex-session.md
mira import --source claude-code --path ./claude-session.md --id claude_session_1
mira import --source claude-code --format jsonl --path ./claude-transcript.jsonl
mira import --source codex --format jsonl --path ./codex-transcript.jsonl
mira history import --dry-run --since 2026-07-01 --max-file-size 20 --limit 20 --root-alias /old/path/AnchorMem
mira history import --since 2026-07-01 --max-file-size 20 --limit 20 --root-alias /old/path/AnchorMem --distill --report ./history-import.json
mira history runs --limit 20
mira history failures --limit 100
mira thread save --id thread_1 --title "Session" --source codex --format markdown --text "## Key Decisions\n- Use Mira."
mira thread save --id thread_2 --title "Session File" --source codex --raw-format markdown --file ./session.md
mira thread delete --id thread_2 --confirm-hard-delete
mira memory distill --thread thread_1
mira memory llm-prompt --thread thread_1
mira memory apply-candidates --thread thread_1 --path ./candidates.json
mira distill jobs enqueue --thread thread_1
mira distill jobs list --status pending
mira distill jobs run --once
mira memory candidate list --status pending_review
mira memory candidate review --id candidate_123 --decision accept --reason "Confirmed"
mira memory add --title "Preference" --kind preference --content "Keep output script-friendly." --source manual
mira memory search --query "script-friendly"
mira memory search "script-friendly"
mira memory clear --thread thread_1 --confirm-hard-delete
mira working set --kind current_task --content "Continue Phase 4."
mira working list
mira working clear --kind blocker
mira wm list
mira briefing show
mira briefing rebuild
mira briefing history --limit 20
mira context bundle --query "Mira"
mira context bundle --max-tokens 1000
mira vault sync
mira vault sync --out ./notes/mira
mira export --format json --out ./export
mira export --format markdown --out ./export
```

`mira thread save` 中 `--raw-format` 是 `--format` 的别名，保留 `--raw-format` 是为了与数据模型里的 `rawFormat` 命名一致。`mira wm` 是 `mira working` 的短别名。`project delete`、`memory clear` 与 `thread delete` 是隐私擦除入口，会连同生命周期历史和事件账本永久删除数据，因此必须显式传入 `--confirm-hard-delete`；日常停用记忆应使用 `memory archive`。

全局选项需要放在子命令前：`--db` 与 `--project-root` 需要写在子命令前，例如 `mira --project-root /path --db /path/.mira/mira.sqlite memory search "Mira"`。

`mira doctor` 是只读诊断命令：它报告当前项目根目录、数据库路径、schema 版本、项目/Thread/Memory/候选/历史导入批次数量、Codex / Claude Code 集成状态，以及 `.mira/integrations.log` 的最新时间戳。数据库不存在时它不会创建 `.mira` 或初始化 schema，适合在真实接入前先确认 Mira 是否看得到当前项目。

默认数据库为当前项目的 `.mira/mira.sqlite`。脚本和测试也可以显式传入：

```bash
mira --project-root /path/to/project --db /path/to/.mira/mira.sqlite init
```

`mira import` 目前支持 Codex、Claude Code 和通用 Markdown 会话摘要，也支持 Codex / Claude Code 的 JSONL transcript。导入后会保存为 Thread；Markdown 未传 `--title` 时优先使用第一个 H1，没有 H1 时使用文件名。JSONL 会被 normalize 成可读 Markdown 后保存，`rawFormat` 保留为 `jsonl`。

`mira history import` 用于补录当前项目的本机历史会话。它扫描 `$CODEX_HOME/sessions`、`$CODEX_HOME/archived_sessions` 与 `$CLAUDE_CONFIG_DIR/projects`，只导入 cwd 等于当前项目或显式 `--root-alias` 的主会话；不会猜测路径，也不会导入 Claude subagent。重复运行会按稳定 Thread ID 与 SHA-256 指纹分类为 `imported`、`updated`、`unchanged`、`skipped` 或 `failed`。默认不调用 LLM，`--distill` 只为新增或更新 Thread 幂等入队 Provider 任务。

容量治理参数会在读取 transcript 正文前生效：`--since YYYY-MM-DD`、`--until YYYY-MM-DD` 按文件 mtime 限定日期范围，`--max-file-size <MB>` 跳过超大文件，`--limit <N>` 只预览或导入前 N 个匹配会话。报告里的 `summary` 会展示匹配数量、匹配字节数、按日期/大小/limit 跳过的数量，以及最多 10 个最大的项目候选文件，方便先估算数据库增长。

首次使用建议先运行 `--dry-run`；如果数据库尚不存在，预览不会创建 `.mira/mira.sqlite`。正式导入始终写入 schema v6 审计批次，单文件失败不会阻断其他文件；命令仍输出完整汇总并返回退出码 `2`，可用 `history failures` 查看路径、阶段与脱敏原因。批次级启动或迁移失败返回 `1`。

真实项目建议先跑一条最小闭环：

```bash
mira doctor
mira history import --dry-run --since 2026-07-01 --max-file-size 20 --limit 20 --report ./history-dry-run.json
mira history import --since 2026-07-01 --max-file-size 20 --limit 20 --report ./history-import.json
mira briefing rebuild
mira vault sync
mira context bundle --max-tokens 1000
```

这条闭环只接入一个受限批次，确认数据库统计、历史导入、Briefing、Vault 和 Context Bundle 都能跑通后，再逐步扩大日期范围或提高 limit。

`mira memory llm-prompt` 和 `mira memory apply-candidates` 提供可审查的 LLM 提炼流程：先生成提示词，再把审查后的候选记忆 JSON 写入 Memory。

`mira briefing show` 从 Working Memory、active Memory 和 Thread provenance 确定性生成版本化 Project Briefing。Memory 或 Working Memory 变化后，旧快照自动标记 stale；下一次 `briefing show`、MCP 读取或 Context Bundle 会执行一次本地重建。重建失败时继续使用最后一份 complete 快照。Briefing 是可重建派生数据，SQLite 仍是唯一事实源。

Context Bundle 的顺序是 Working Memory、Project Briefing、Warning Memory、相关长期 Memory。`--max-characters` 与 `--max-tokens` 可同时使用，Mira 按 `1 token ≈ 4 characters` 估算并采用更严格的预算。

`mira vault sync` 默认完整重建 `<project>/.mira/vault/`，也可通过 `--out` 指定相对项目根目录或绝对路径。Vault 包含索引、Project Briefing、Working Memory、每条 Memory、每个 Thread 和待审核候选；全生命周期状态、来源和前驱/后继关系均可追溯。同步先写 staging，再原子替换目标，失败会恢复上一版。SQLite 始终是唯一事实源，Vault 中的手动编辑不会回写，并会在下次同步时被覆盖。为保护项目，输出目标不能是项目根目录、其祖先、`.git` 或 `.mira` 控制目录。

Phase 2 进一步提供可信自动提炼。Agent 可通过 `submit_memory_candidates` MCP 工具提交带 Thread 原文证据的候选；也可配置 OpenAI-compatible Provider，让 Hook 在保存 transcript 后幂等入队并 detached 启动一次性 Worker：

```bash
export MIRA_LLM_BASE_URL="https://provider.example/v1"
export MIRA_LLM_MODEL="model-name"
export MIRA_LLM_API_KEY="optional-api-key"
```

只有 `confidence >= 0.9`、证据可定位、未命中敏感信息、无重复/冲突且 kind 为 `fact`、`convention`、`lesson`、`failed_attempt` 或 `constraint` 的候选会自动接受。`decision`、`architecture`、`preference` 等高影响类型默认待审。候选绑定提取时的 Thread 版本，正文变化后必须重新提交；项目内跨 Thread 的相同 Memory 只建立追溯关系，不重复写入。

Provider 是显式 opt-in。Mira 会在请求前拦截常见私钥和 Token 模式，但无法识别所有敏感内容；未命中的完整 Thread 会发送到你配置的 Provider，请只在确认其隐私与数据保留策略后启用。未配置 Provider 时自动捕获保持原行为，Agent MCP 候选通道仍可用。

## Memory 生命周期

Memory 内容不原地覆盖。更新会创建 active successor，并在同一事务中把 predecessor 标记为 superseded；历史内容和事件账本始终可审计。归档会让 Memory 退出默认搜索和 Context Bundle，合法恢复后重新进入：

```bash
mira memory get --id memory_123
mira memory update --id memory_123 --content "Updated durable fact" --reason "Decision changed"
mira memory archive --id memory_456 --reason "No longer current"
mira memory restore --id memory_456
mira memory history --id memory_456
```

冲突候选可独立接受，也可显式替代一个 active Memory：

```bash
mira memory candidate review --id candidate_123 --decision accept --supersedes memory_456
```

MVP Memory kind 是兼容性超集：`decision`、`convention`、`architecture`、`preference`、`task`、`fact`、`failed_attempt`、`lesson`、`constraint`、`todo`、`note`。Working Memory kind 是：`current_task`、`current_phase`、`recent_decision`、`blocker`、`next_step`、`preference`、`decision`、`note`。

## Codex / Claude Code 自动接入

完成构建后，在目标项目中执行一次安装。全局选项仍需放在子命令前：

```bash
mira --project-root /path/to/project integration install --agent all --dry-run
mira --project-root /path/to/project integration install --agent all
mira --project-root /path/to/project integration status
```

也可以把 `all` 换成 `codex` 或 `claude-code`。安装后：

- Codex 使用 `.codex/hooks.json` 和 `.codex/config.toml`。
- Claude Code 使用 `.claude/settings.local.json` 和 `.mcp.json`。
- `SessionStart` 自动输出有字符预算的 Context Bundle。
- Codex `Stop`、Claude Code `Stop` / `SessionEnd` 自动导入 Hook 提供的主 transcript。
- 同一 Agent 会话映射到稳定 Thread ID；transcript 未变化时根据 SQLite 检查点跳过重复解析。
- Hook 错误不会阻塞 Agent，诊断写入 `.mira/integrations.log`，且不记录 transcript 正文。
- 配置 Provider 后，内容变化会创建幂等提炼任务；Hook 不等待网络请求，任务失败可由 CLI 查看和重试。
- 本机绝对路径配置会加入 `.git/info/exclude` 的 Mira 托管块，避免误提交且不修改团队 `.gitignore`。

首次在项目中启用 Hook/MCP 时，Codex 或 Claude Code 仍可能显示官方信任确认；Mira 不绕过该安全机制。卸载只移除 Mira 管理的条目：

```bash
mira --project-root /path/to/project integration uninstall --agent all
```

完整行为与排障说明见 [自动接入指南](docs/agent-config/automatic-integration.md)。

## MCP 快速配置

Mira MVP 提供每项目一个 stdio MCP server。推荐使用绝对路径绑定项目和数据库：

```bash
mira mcp serve --project-root /path/to/project --db /path/to/project/.mira/mira.sqlite
```

Agent 可用工具：

```text
get_context_bundle
get_project_briefing
rebuild_project_briefing
search_memory
set_working_memory
list_working_memory
clear_working_memory
add_memory
save_thread
submit_memory_candidates
list_memory_candidates
review_memory_candidate
get_memory
update_memory
archive_memory
get_memory_history
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
- [Phase 0/1 自动接入 Spec](specs/014-phase0-phase1-auto-integration/spec.md)
- [Phase 2 可信自动提炼 Spec](specs/015-trusted-memory-distillation/spec.md)
- [Phase 2 Candidate API 契约](specs/015-trusted-memory-distillation/contracts/candidate-api.md)
- [Phase 3 Memory 生命周期 Spec](specs/016-memory-lifecycle/spec.md)
- [Phase 3 Lifecycle API 契约](specs/016-memory-lifecycle/contracts/lifecycle-api.md)
- [Phase 4 Project Briefing Spec](specs/017-project-briefing/spec.md)
- [Phase 4 Briefing API 契约](specs/017-project-briefing/contracts/briefing-api.md)
- [Phase 5 Markdown Vault Spec](specs/018-markdown-vault/spec.md)
- [Phase 5 Vault 布局契约](specs/018-markdown-vault/contracts/vault-layout.md)
- [历史会话批量导入 Spec](specs/019-history-bulk-import/spec.md)
- [历史会话批量导入设计](docs/superpowers/specs/2026-07-20-mira-history-bulk-import-design.md)
- [Codex / Claude Code 自动接入指南](docs/agent-config/automatic-integration.md)
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
