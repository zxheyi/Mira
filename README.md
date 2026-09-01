# Mira

Mira 是一个本地优先的项目连续记忆与证据约束型研究系统。它让 Codex、Claude Code、Cursor、OpenClaw 等开发者 Agent 在同一个项目里连续工作，并在投资研究场景中把 Evidence、Claim 和 Review 明确分离。

一句话定位：

> Mira 不是另一个通用 AI 工作台，也不是消费者个人记忆产品。它以项目级连续记忆为底座，并提供不自动修改 thesis 的证据约束型投资研究认知层。

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

### Research Case

一个按项目和 as-of date 隔离的研究问题。Research Case 以 `Evidence Item → Claim → Review Event` 保存来源、支持/反驳关系、证据状态、审核状态、置信度、失效条件和 Thesis Impact Proposal。Proposal 只表达分析意图；Mira 不拥有或修改 thesis、仓位和交易状态。

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
- 支持可审计的 Research Case、Evidence/Claim 关系、stale 传播、不可变 Claim 修订和人工审核。
- 通过 CLI、MCP 和本地 Viewer 使用同一套研究治理规则，并确定性导出 Markdown 审计视图。

MVP 暂不做：

- 多用户账号、云同步、计费或公开 Web App。
- 通用消费者个人记忆。
- 邮件、会议、浏览器和 Slack 等大集成。
- 完整知识图谱 UI。
- 插件市场。
- 大而全的 Agent 工作台。
- 复杂向量检索，先用 SQLite FTS 跑通闭环。
- thesis 状态、估值/目标价、仓位管理和交易执行。

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
mira ui
mira project list
mira project delete --id project_123 --confirm-hard-delete
mira import --source codex --path ./codex-session.md
mira import --source claude-code --path ./claude-session.md --id claude_session_1
mira import --source claude-code --format jsonl --path ./claude-transcript.jsonl
mira import --source codex --format jsonl --path ./codex-transcript.jsonl
mira history import --dry-run --since 2026-07-01 --max-file-size 20 --limit 20 --root-alias /old/path/Mira-legacy
mira history import --since 2026-07-01 --max-file-size 20 --limit 20 --root-alias /old/path/Mira-legacy --distill --report ./history-import.json
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
mira context prepare --query "local database"
mira context recalls
mira context feedback --recall recall_123 --outcome missed --missing-memory memory_456 --reason "Expected Memory was absent"
mira context quality
mira vault sync
mira vault sync --out ./notes/mira
mira export --format json --out ./export
mira export --format markdown --out ./export
mira research submit --path ./research-packet.json
mira research list
mira research show --case research_case_123
mira research context --case research_case_123
mira research verify --case research_case_123 --evidence research_evidence_123
mira research review --claim research_claim_123 --decision approve --reason "Checked primary sources"
mira research evidence-stale --evidence research_evidence_123 --reason "Superseded by a later filing"
mira research snapshot-stale --snapshot source_snapshot_123 --reason "Superseded by a later snapshot"
mira research revise --claim research_claim_123 --path ./claim-revision.json --reason "Reframed after new evidence"
mira research export --case research_case_123 --out ./research-case.md
```

`mira thread save` 中 `--raw-format` 是 `--format` 的别名，保留 `--raw-format` 是为了与数据模型里的 `rawFormat` 命名一致。`mira wm` 是 `mira working` 的短别名。`project delete`、`memory clear` 与 `thread delete` 是隐私擦除入口，会连同生命周期历史和事件账本永久删除数据，因此必须显式传入 `--confirm-hard-delete`；日常停用记忆应使用 `memory archive`。

全局选项需要放在子命令前：`--db` 与 `--project-root` 需要写在子命令前，例如 `mira --project-root /path --db /path/.mira/mira.sqlite memory search "Mira"`。

`mira doctor` 是只读诊断命令：它报告当前项目根目录、数据库路径、schema 版本、项目/Thread/Memory/候选/历史导入批次数量、Codex / Claude Code 集成状态，以及 `.mira/integrations.log` 的最新时间戳。数据库不存在时它不会创建 `.mira` 或初始化 schema，适合在真实接入前先确认 Mira 是否看得到当前项目。

`mira ui` 启动本地管理 Viewer，默认绑定 `127.0.0.1:4317` 并输出 JSON URL。中文界面展示总览、会话、导入批次、简报/上下文预览、记忆、候选审核、研究案例、召回审计和后台任务。支持明确确认后的候选批准/拒绝、记忆纠正/归档/恢复、Research Claim 审核、Evidence stale 处理、研究 Markdown 预览、历史查看和失败任务重新排队；不提供永久删除、导入、调用模型、thesis mutation 或安装集成按钮。预览不刷新 Briefing、不生成召回审计。只允许 loopback 绑定，写入校验 Host、Origin、JSON 和每次启动生成的防跨站令牌；未提供远程访问模式。

```bash
mira --project-root /path/to/project ui
mira --project-root /path/to/project ui --port 4318
```

默认数据库为当前项目的 `.mira/mira.sqlite`。脚本和测试也可以显式传入：

```bash
mira --project-root /path/to/project --db /path/to/.mira/mira.sqlite init
```

`mira import` 目前支持 Codex、Claude Code 和通用 Markdown 会话摘要，也支持 Codex / Claude Code 的 JSONL transcript。导入后会保存为 Thread；Markdown 未传 `--title` 时优先使用第一个 H1，没有 H1 时使用文件名。JSONL 会被 normalize 成可读 Markdown 后保存，`rawFormat` 保留为 `jsonl`。

`mira history import` 用于补录当前项目的本机历史会话。它扫描 `$CODEX_HOME/sessions`、`$CODEX_HOME/archived_sessions` 与 `$CLAUDE_CONFIG_DIR/projects`，只导入 cwd 等于当前项目或显式 `--root-alias` 的主会话；不会猜测路径，也不会导入 Claude subagent。重复运行会按稳定 Thread ID 与 SHA-256 指纹分类为 `imported`、`updated`、`unchanged`、`skipped` 或 `failed`。默认不调用 LLM，`--distill` 只为新增或更新 Thread 幂等入队 Provider 任务。

`--root-alias` 示例中的 `/old/path/Mira-legacy` 是旧工作目录占位路径，请替换为历史会话中记录的实际 cwd；该目录无需仍然存在。

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

Context Bundle 的顺序是 Working Memory、Project Briefing 元数据、相关 Warning Memory、相关长期 Memory。Briefing 全文单独读取，避免再次混入不相关记忆。显式 query 下警告也必须匹配；支持中文子串检索。超长记忆整条跳过，并继续尝试后续短记忆。

`--max-characters` 与 `--max-tokens` 可同时使用；后者使用保守的 UTF-8 字节数上界（适用于 byte-level tokenizer），不是模型专属 token 实测值。`mira context prepare` / MCP `prepare_context` 返回 `{markdown, receipt}`；原 `context bundle` 保持 Markdown 输出。默认记录候选、完整注入、预算省略的记忆 ID、项目/任务、输出 hash 和耗时；用 `mira context recalls` / MCP `list_recall_events` 查询。注入不等于成功使用。`context prepare --preview` / MCP `preview: true` 不记录召回，也不重建 Briefing。

只有用户明确评价某次通用 Memory 召回时，才使用 `mira context feedback` / MCP `record_recall_feedback` 绑定 Recall Receipt 与 relevant、missing、irrelevant、corrected Memory ID；Agent 不能根据调用成功自动标记 useful。反馈中的 `correctedMemoryIds` 只是用户标注；实际纠正须在 `memory update` / `update_memory` 中传入 `recallId`，由不可变 Memory 事件形成 `confirmedCorrectionMemoryIds`。用 `mira context quality` / `get_recall_quality_report` 区分真实检索缺失、排序淘汰、预算淘汰和 Memory 质量问题。

质量报告在至少 20 条人工标注前返回 `insufficient_data`；达到 20 条后，至少 5 条 receipt 出现 Memory 未进入候选集才返回 `evaluate_hybrid`，否则返回 `keep_fts`。该结果只提供决策证据，不会自动启用 hybrid/vector，也不会修改 Research 或 thesis 状态。

`npm run benchmark:recall` 在内存数据库上运行 20 题可重复召回基线，不读取或修改用户数据库。初始词法检索结果为 `Recall@1 = 0.75`、`Recall@5 = 0.75`、`MRR = 0.75`；5 个语义改写题未命中，用于指导后续检索优化，而不是作为自动写入或发布门禁。

`npm run verify:research-pilot` 在临时数据库中重放 Apple FY2024 公开来源案例，覆盖官方来源边界、反驳证据、授权审核、stale 传播、不可变修订、CLI/MCP/UI 一致性，以及不写入 Memory/thesis 的隔离约束。案例材料见 [Apple FY2024 来源笔记](docs/research/apple-fy2024-source-notes.md) 和 [可重放 fixture](examples/research/apple-fy2024-pilot.json)。

`npm run verify:multi-case-research` 在临时数据库中重放 Apple FY2024、Microsoft FY2024 和 NVIDIA FY2025 三个官方申报案例，覆盖审核前排除、授权批准、案例发现、case 隔离召回、无正文召回审计，以及不写入 Memory、Candidate 或 thesis 的边界。案例材料见 [三案例来源笔记](docs/research/official-multi-case-source-notes.md) 和 [可重放 fixture](examples/research/official-multi-case-pilot.json)。

`mira vault sync` 默认完整重建 `<project>/.mira/vault/`，也可通过 `--out` 指定相对项目根目录或绝对路径。Vault 包含索引、Project Briefing、Working Memory、每条 Memory、每个 Thread 和待审核候选；全生命周期状态、来源和前驱/后继关系均可追溯。同步先写 staging，再原子替换目标，失败会恢复上一版。SQLite 始终是唯一事实源，Vault 中的手动编辑不会回写，并会在下次同步时被覆盖。为保护项目，输出目标不能是项目根目录、其祖先、`.git` 或 `.mira` 控制目录。

Phase 2 进一步提供可信自动提炼。Agent 可通过 `submit_memory_candidates` MCP 工具提交带 Thread 原文证据的候选；也可配置 OpenAI-compatible Provider，让 Hook 在保存 transcript 后幂等入队并 detached 启动后台 Worker：

后台 Worker 会排空待处理任务及调度重试后退出，不安装常驻服务。五分钟租约过期后，下次启动自动回收；旧尝试不能提交迟到结果。网络错误、HTTP 429/5xx 按退避最多尝试三次，非法候选/敏感信息/其他 HTTP 错误直接终止。`mira distill jobs run --once` 只处理一个任务，`--drain` 连同待重试任务一起处理；`jobs retry --id ...` 显式增加三次预算。配置 Provider 的 SessionStart 可唤醒历史队列，Hook 不等待模型返回。中断后恢复需要下一次会话、捕获或手动启动，并非 OS 级自动唤醒。

```bash
export MIRA_LLM_BASE_URL="https://provider.example/v1"
export MIRA_LLM_MODEL="model-name"
export MIRA_LLM_API_KEY="optional-api-key"
```

只有 `confidence >= 0.9`、证据可定位、未命中敏感信息、无重复/冲突且 kind 为 `fact`、`convention`、`lesson` 或 `failed_attempt` 的候选会自动接受。`decision`、`architecture`、`constraint`、`preference` 等高影响类型默认待审。候选绑定提取时的 Thread 版本，正文变化后必须重新提交；项目内跨 Thread 的相同 Memory 只建立追溯关系，不重复写入。

Provider 是显式 opt-in。Mira 会在请求前拦截常见私钥和 Token 模式，但无法识别所有敏感内容；未命中的完整 Thread 会发送到你配置的 Provider，请只在确认其隐私与数据保留策略后启用。未配置 Provider 时自动捕获保持原行为，Agent MCP 候选通道仍可用。

## Memory 生命周期

Memory 内容不原地覆盖。更新会创建 active successor，并在同一事务中把 predecessor 标记为 superseded；历史内容和事件账本始终可审计。归档会让 Memory 退出默认搜索和 Context Bundle，合法恢复后重新进入：

CLI、MCP 与管理 UI 的写入统一经过记忆治理服务。`add/update/archive/restore` 是用户或协议已确认的操作；自动归纳只能提交 candidate。除来源片段必须存在、低风险、高置信度、无冲突外，自动接受还要求内容在 evidence 中逐字出现（忽略空白差异）。改写或推论标记 `non_verbatim_claim`，留待显式审核。这个保守规则不是语义真实性证明；Mira 记忆层不因此获得修改投资 thesis 的权限。写入内容、来源、审核/归档理由含可识别密钥时，整次操作拒绝且不改变旧记忆。已审核的 `apply-candidates` 和手动 `memory distill` 仍为显式批量写入，也经过相同检查。

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

## 投资研究 Domain Skill

仓库内置 [Mira Investment Research Skill](skills/mira-investment-research/SKILL.md)。把整个 `skills/mira-investment-research` 目录复制到 Codex skills 目录后，可通过 `$mira-investment-research` 调用。npm 发布清单也包含 `skills/`。

这个 runtime profile 编排 `prepare context → evidence ledger → claim review → candidate proposal`。它只把稳定方法和已核验来源事实提交为 candidate；推导性投资结论与 thesis 影响保留在研究审核包，确认写入仍要求 Mira 宿主权限，thesis 状态由核心之外的领域审核协议管理。该 Skill 不执行交易或修改投资组合。

## MCP 快速配置

Mira MVP 提供每项目一个 stdio MCP server。推荐使用绝对路径绑定项目和数据库：

```bash
mira mcp serve --project-root /path/to/project --db /path/to/project/.mira/mira.sqlite
```

Agent 可用工具：

```text
list_host_adapters
before_turn
after_turn
get_context_bundle
prepare_context
list_recall_events
record_recall_feedback
get_recall_quality_report
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
submit_research_packet
list_research_cases
get_research_case
prepare_research_context
list_research_context_recalls
revise_research_claim
verify_research_evidence
mark_research_evidence_stale
review_research_claim
export_research_case
```

MVP 中 `save_thread` 的输入是 Agent 生成的会话摘要或关键摘录，不是假设 Agent 能读取完整 transcript。

`record_recall_feedback` 只接受宿主已确认的用户反馈；工具参数不能自授予权限。其质量报告只评估通用 Memory 检索，Research Context 的 case-scoped receipt 继续单独审计。

`prepare_research_context` 是对研究事实只读的独立研究上下文出口：它只返回 active、approved 且由 current、verified supporting Evidence 支撑的 Claim。draft、未验证或 stale 研究不会进入结果；该工具不授予审核权，也不修改研究事实、Memory 或 thesis；每次 MCP 调用会追加一条不含 Markdown 正文的 recall receipt，可通过 `list_research_context_recalls` 审计。

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
- [召回质量基线 Spec](specs/026-recall-quality-baseline/spec.md)
- [召回反馈与检索升级证据 Spec](specs/029-recall-feedback/spec.md)
- [Mira Investment Research Skill](skills/mira-investment-research/SKILL.md)
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
