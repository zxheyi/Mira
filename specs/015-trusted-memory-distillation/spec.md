# Phase 2 可信自动记忆提炼规格

Feature ID: `015-trusted-memory-distillation`
Status: Complete

2026-08-31 边界补充：以 [统一记忆治理](../024-memory-curation/spec.md) 为准。自动接受要求归纳内容在原文 evidence 中逐字存在（忽略空白差异）；非原文声明使用 `non_verbatim_claim` 进入待审。置信度仍是提取方自报分数，不等同于真实性或投资 thesis 批准。

## 目标

让 Mira 在 Codex 与 Claude Code 会话被自动捕获后，能够异步生成带原文证据的记忆候选，并依据确定性策略自动接受低风险、高置信候选；其余候选进入人工审核队列。整个链路必须可追溯、幂等、可重试，并且 Hook 不能等待外部模型。

## 用户闭环

1. Phase 1 Hook 保存或更新稳定 Thread。
2. 配置了外部 Provider 时，Hook 幂等创建提炼任务并启动后台 Worker；[025](../025-recovery-and-management-ui/spec.md) 增加租约恢复、有限退避重试和排空后退出。
3. Worker 调用 OpenAI-compatible Chat Completions 接口，取得结构化候选。
4. Agent 也可通过 MCP 直接提交自己生成的候选，不依赖外部 Provider。
5. Mira 校验证据、字段、安全性、重复与冲突后执行策略：
   - 满足自动接受条件的候选立即写入长期 Memory。
   - 其他合法候选进入 `pending_review`。
   - 含敏感信息或无有效证据的输入在持久化前拒绝。
6. 用户或 Agent 可查看并接受、拒绝待审候选；任务失败后可从 CLI 重试。

## 数据模型

SQLite schema 升级到 v3。

### distill_jobs

- `id`: 稳定任务 ID。
- `project_id`, `thread_id`: 任务归属。
- `trigger`: `hook | cli`。
- `channel`: MVP 为 `provider`；Agent 直提候选不要求创建任务。
- `input_hash`: Thread 当前正文的 SHA-256，用于同一版本幂等入队。
- `status`: `pending | running | completed | failed`。
- `attempts`, `last_error`, `created_at`, `updated_at`。
- `(project_id, thread_id, channel, input_hash)` 唯一。

### memory_candidates

- `id`, `project_id`, `thread_id`, `job_id`。
- `title`, `kind`, `content`, `confidence`, `importance`。
- `source_agent`, `source_model`, `extraction_method`。
- `thread_input_hash`: 候选提取时 Thread 正文的 SHA-256；审核接受前必须仍与当前 Thread 一致。
- `evidence`: 必须是 Thread 正文中可定位的原文片段。
- `content_hash`, `risk_level`。
- `status`: `pending_review | accepted | rejected`。
- `review_reason`, `reviewed_at`, `accepted_memory_id`, `created_at`。
- 同一 Thread 正文版本、kind、内容和提炼方式只保留一个候选；Thread 更新后允许重新提交。

## 候选策略

### 合法性

- 单次最多 50 条候选。
- `title` 1–200 字符，`content` 1–10000 字符，`evidence` 1–4000 字符。
- `confidence` 与 `importance` 位于 0–1。
- `kind` 必须属于 Mira Memory kind 枚举。
- `evidence` 去除首尾空白后必须原样出现在对应 Thread 的 `raw_text` 中。
- 命中私钥、常见访问令牌、云访问密钥或显式 password/token/secret 赋值模式时，拒绝整条输入且不落库。

### 自动接受

候选同时满足以下条件才可自动接受：

- `confidence >= 0.9`。
- kind 属于低风险集合：`fact`、`convention`、`lesson`、`failed_attempt`、`constraint`。
- 证据及字段校验通过，且未命中敏感信息。
- 不与既有 Memory 或候选重复。
- 不与同 kind、同规范化标题但内容不同的 active Memory 冲突。

`decision`、`architecture`、`preference` 等高影响类型默认进入审核队列。合法但未自动接受的候选必须带机器可读审核原因。

### 接受与拒绝

- 接受操作在一个事务中创建或复用 Memory，并更新候选状态与 `accepted_memory_id`。
- 由候选创建的 Memory 使用 `source = candidate:<candidate_id>`，保留 Thread 关联。
- 接受、拒绝都是幂等操作；已完成审核的候选不可改为相反结果。
- 手工接受允许覆盖自动策略，但不能绕过字段、证据和敏感信息校验。

## Provider 通道

- 通过 `MIRA_LLM_BASE_URL`、`MIRA_LLM_MODEL` 和可选的 `MIRA_LLM_API_KEY` 配置 OpenAI-compatible Provider。
- 请求使用 `/chat/completions`，要求 JSON 对象 `{ "candidates": [...] }`。
- Provider 响应仍需经过与 Agent 通道完全相同的候选校验和接受策略。
- Provider 是显式 opt-in，调用前会扫描完整 Thread 的常见密钥模式；命中时拒绝发送。未命中的 Thread 正文会发送给用户配置的外部 Provider，使用者需自行确认其隐私策略。
- HTTP、解析或校验失败必须把任务标记为 `failed`，保存脱敏且有长度上限的错误信息。
- 未配置 Provider 时，Hook 只保存 Thread，不创建失败任务，也不影响 Agent 通道。

## Hook 与 Worker

- Hook 成功保存 Thread 后才入队。
- 同一 Thread 正文版本重复 Hook 不重复创建任务。
- Hook 只启动 detached、stdio ignore 的 Worker，不等待网络调用；Worker 排空任务及有限重试后退出。
- Worker 原子领取一个 pending job；failed 可立即 retry，running 只有超过 5 分钟租约后才可恢复，避免双 Worker。
- CLI 提供 enqueue、list、run-once 和 retry，确保无 Hook 环境也可运维。

## CLI 契约

```text
mira distill jobs enqueue --thread <id>
mira distill jobs list [--status pending|running|completed|failed]
mira distill jobs run --once
mira distill jobs retry --id <job-id>
mira memory candidate list [--status pending_review|accepted|rejected]
mira memory candidate review --id <candidate-id> --decision accept|reject [--reason <text>]
```

任务与候选 CLI 固定输出 JSON，便于脚本消费；无需额外 `--json` 参数。CLI 参数在进入 Store 前执行运行时枚举与数值校验。

## MCP 契约

新增：

- `submit_memory_candidates`
- `list_memory_candidates`
- `review_memory_candidate`

详细字段见 `contracts/candidate-api.md`。MCP 与 CLI 必须调用同一 Core Service，不能复制接受策略。

## 非目标

- 不让 Hook 同步等待 LLM。
- 不自动接受高影响决策与偏好。
- 不实现多 Provider 路由、模型降级、常驻 daemon 或定时调度。
- 不在本阶段实现 supersedes、归档、衰减和事件账本；这些属于 Phase 3。
- 不替换现有确定性 distill 与显式 `apply-candidates` 兼容入口。

## 验收标准

1. v2 数据库可无损升级到 v3，新库直接创建全部表、索引和约束。
2. Agent 与 Provider 候选走同一校验、敏感信息拦截和自动接受策略。
3. 高置信低风险且有证据的候选自动进入 Memory；高影响、低置信和冲突候选待审。
4. 重复提交和重复 Hook 不产生重复候选、任务或 Memory。
5. 手工接受/拒绝幂等，并保留候选到 Memory 的追溯关系。
6. Provider 错误可观测、可重试，错误文本不包含密钥且有长度上限。
7. Hook 未配置 Provider 时保持 Phase 1 行为；配置后只异步启动 Worker。
8. CLI 完成 enqueue -> run -> review -> search 的端到端闭环。
9. MCP 覆盖提交、列表、审核，并与 Core 行为一致。
10. `npm test`、`npm run build`、`git diff --check` 全部通过。
