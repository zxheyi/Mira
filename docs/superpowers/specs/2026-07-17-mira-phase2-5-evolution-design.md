# Mira Phase 2-5 进化设计

状态：已批准

日期：2026-07-17

## 1. 目标

在已完成的自动会话捕获基础上，把 Mira 从“自动保存 Thread”推进为日常真正可用的项目记忆层：自动产生可信候选、管理记忆演变、持续维护项目当前状态，并以 Obsidian 可读 Markdown 展示全部结果。

推进顺序固定为：

```text
Phase 2 可信记忆提炼
  -> Phase 3 记忆生命周期与证据链
  -> Phase 4 主动 Project Briefing
  -> Phase 5 Obsidian-ready Markdown Vault
```

每个 Phase 必须独立完成 SDD、TDD、迁移测试、全量验证和 commit，当前 Phase 未通过门禁时不得混入下一 Phase。

## 2. 已确认决策

1. 自动接受策略采用“高置信度自动写入，其余进入审核队列”。
2. LLM 采用双通道：Codex/Claude Code 可提交候选；Mira 也提供可选 OpenAI-compatible Provider。
3. Phase 5 只做 Markdown Vault + Obsidian，不做 Web UI。
4. SQLite 始终是唯一写入事实源；Markdown 只做单向物化。
5. Phase 2-4 优先完成核心闭环，展示能力不得反向污染核心数据模型。

## 3. 总体数据流

```text
Codex / Claude Code Stop
  -> 保存稳定 Thread
  -> 创建持久化 Distill Job
  -> Hook 立即返回，不等待 LLM

Distill Worker
  -> Agent 候选或 Provider 候选
  -> Schema / provenance / sensitive / duplicate / conflict guards
  -> Memory Candidate
  -> policy decision
       high confidence + low risk -> accepted Memory
       otherwise                  -> pending review

Accepted Memory / Working Memory changed
  -> lifecycle event
  -> Project Briefing marked stale
  -> rebuild briefing snapshot
  -> Context Bundle uses active memory + briefing
  -> Vault materializes read-only Markdown
```

## 4. Phase 2：可信自动记忆提炼

### 4.1 边界

Phase 2 负责从 Thread 产生、校验、审核和接受候选，不负责旧 Memory 的版本替代；发现冲突时只能保留为 pending，替代语义由 Phase 3 实现。

### 4.2 核心模型

`distill_jobs`：

- `id`
- `project_id`
- `thread_id`
- `trigger`: `hook | cli | mcp`
- `channel`: `agent | provider`
- `status`: `pending | running | completed | failed`
- `attempts`
- `last_error`
- `created_at / updated_at`

`memory_candidates`：

- `id`
- `project_id / thread_id / job_id`
- `title / kind / content / confidence / importance`
- `source_agent / source_model / extraction_method`
- `evidence`
- `content_hash`
- `risk_level`: `low | high`
- `status`: `pending | accepted | rejected`
- `review_reason / reviewed_at`
- `created_at`

### 4.3 接受策略

候选仅在以下条件全部满足时自动接受：

- `confidence >= 0.9`。
- evidence 非空并可追溯到来源 Thread。
- 通过现有 kind、标题、内容、置信度、重要性边界校验。
- 不包含配置的敏感信息模式。
- 与 active Memory 不重复。
- 未检测到潜在冲突。
- kind 位于默认低风险集合：`fact`、`convention`、`lesson`、`failed_attempt`、`constraint`。

`decision`、`architecture`、`preference`、`task`、`todo`、`note` 默认进入 pending。自动接受策略允许项目级配置收紧，不允许绕过结构、安全和 provenance 校验。

### 4.4 双通道

- Agent 通道：新增 MCP `submit_memory_candidates`，由当前 Codex/Claude Code 提交结构化候选。
- Provider 通道：定义 provider-neutral 接口，第一版实现 OpenAI-compatible HTTP Adapter。
- Provider 未配置时作业保持可诊断状态，不影响 Agent 或 Thread 保存。
- Stop Hook 只创建作业；一份 detached one-shot worker 处理 pending job，失败记录后退出，不引入常驻 daemon。
- CLI 提供显式 `jobs run --once` 作为恢复和排障入口。

### 4.5 接口

- CLI：`memory candidate list/review`、`distill jobs list/retry/run`。
- MCP：`submit_memory_candidates`、`list_memory_candidates`、`review_memory_candidate`。
- 正式 Memory 仍通过现有 Memory Store 写入，保持去重和 FTS 契约。

## 5. Phase 3：记忆生命周期与证据链

### 5.1 原则

Memory 内容不原地覆盖。更新会创建新 Memory，并把旧 Memory 标记为 superseded，从而保留完整演变历史。

### 5.2 模型

Memory 增加：

- `status`: `active | superseded | archived | rejected`
- `supersedes_memory_id`
- `updated_at`

新增 `memory_events`：

- `memory_id / project_id`
- `event_type`: `accepted | updated | superseded | archived | rejected | restored`
- `actor / reason / metadata`
- `created_at`

### 5.3 行为

- `update` 创建 successor，并在同一事务中 supersede predecessor。
- `archive` 使 Memory 退出默认检索和 Context Bundle。
- `restore` 只恢复没有 active successor 的 archived Memory。
- `delete` 仅作为明确的隐私硬删除，不替代 archive。
- 冲突候选可在审核时选择 reject、accept independent 或 supersede existing。
- FTS 只返回 active Memory；历史查询通过专用接口读取。

### 5.4 接口

- CLI：`memory get/update/archive/history/restore`。
- MCP：`get_memory`、`update_memory`、`archive_memory`、`get_memory_history`。
- 所有操作产生 `memory_events`，并保留 Thread、candidate 和 actor provenance。

## 6. Phase 4：主动 Project Briefing

### 6.1 原则

Briefing 是派生快照，不是第二事实源。它只能从 Working Memory、active Memory 和 Thread provenance 生成。

### 6.2 内容

- 当前目标和阶段。
- 最近关键决策。
- 已知约束。
- 当前 blocker。
- 失败尝试和经验。
- 待确认问题。
- 下一步动作。

### 6.3 模型与更新

`project_briefings` 保存版本化 Markdown snapshot、来源 ID 列表、生成方式、字符/Token 估算、状态和时间。

- Memory 接受、替代、归档或 Working Memory 改变时，将当前 Briefing 标记 stale。
- one-shot worker 重建最新 snapshot；失败时继续使用最后一个 complete snapshot。
- 每个结论携带来源 Memory 或 Thread ID。
- 过期 blocker/next_step 仅标记 warning，不自动删除事实。

### 6.4 Context Planner

Context Bundle 按以下顺序预算：

1. 高优先级 Working Memory。
2. 最新 complete Project Briefing。
3. Warning Memory。
4. 与 query 相关的 active Memory。

同时支持字符预算和近似 Token 预算。第一版使用稳定字符估算，不依赖 tokenizer 包。

## 7. Phase 5：Obsidian-ready Markdown Vault

### 7.1 输出结构

```text
.mira/vault/
  index.md
  project-briefing.md
  working-memory.md
  memories/
    <memory-id>.md
  threads/
    <thread-id>.md
  reviews/
    pending-candidates.md
```

### 7.2 物化规则

- SQLite 是唯一写入源，不解析用户对 Vault 文件的修改。
- 文件名使用稳定 ID；人类标题写入 frontmatter 和 H1。
- frontmatter 包含 kind、status、confidence、importance、source、thread、supersedes 和时间。
- 使用 WikiLink 连接 Memory、Thread、successor/predecessor 和 evidence。
- `mira vault sync [--out <path>]` 支持完整确定性重建。
- 先写 staging 目录，完整成功后原子替换；失败时保留上一个 Vault。
- 同一数据库状态重复 sync 必须产生相同内容和文件集合。

### 7.3 明确不做

- 不做双向编辑同步。
- 不做 Web UI。
- 不做向量数据库或知识图谱。
- 不做云同步、多人协作和冲突合并。

## 8. 跨 Phase 质量门禁

每个 Phase 必须满足：

1. 独立 `spec.md / plan.md / tasks.md` 与必要 contracts。
2. 迁移可从当前真实 schema 平滑升级，并拒绝未来 schema。
3. 每个新行为先产生预期 RED，再实现 GREEN。
4. Core、CLI、MCP 和端到端路径按风险覆盖。
5. `npm test`、`npm run build`、`git diff --check` 全部通过。
6. README、Agent guidance、`.agents/progress.md` 和 Obsidian 路线同步。
7. 当前 Phase 独立 commit，commit 后工作区干净，才进入下一 Phase。

建议提交信息：

```text
feat: add trusted automatic memory distillation
feat: add memory lifecycle and provenance
feat: add active project briefing
feat: add Obsidian-ready Markdown memory vault
```

## 9. 延后项

- Hybrid/vector search：只有真实评测证明 FTS 召回不足后再引入。
- Web 审核界面：CLI/MCP/Vault 无法满足审核效率时再评估。
- 双向 Vault：必须先有冲突协议和稳定身份模型。
- Knowledge Graph、云同步、团队协作：不属于 Phase 2-5。
