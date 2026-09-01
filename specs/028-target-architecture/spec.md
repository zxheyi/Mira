# Mira Target Architecture v1

状态：Approved
日期：2026-09-01

## 决策摘要

Mira 保持本地优先的模块化单体。所有 Host 通过 Host Adapter Registry 进入统一 Turn Lifecycle Port；Before Turn 只负责 Context Orchestration，After Turn 只负责 Capture 与非权威候选提交。Investment Research 使用不可变 Source Snapshot 验证 Evidence，再进入 Claim 与授权 Review。所有事实状态写入 SQLite；需要异步跟进的提交同时产生 Domain Event 与 Outbox Message；Briefing、Context Bundle、Vault、Viewer 和导出均为派生读取。

```text
Codex / Claude Code / Cursor / CLI / MCP / Viewer
                        |
              Host Adapter Registry
                        |
             Unified Turn Lifecycle Port
            Before Turn          After Turn
                |                    |
       Context Orchestrator    Capture Pipeline
                |                    |
          Project Memory      Candidate / Quarantine
                |                    |
                +---------+----------+
                          |
             Investment Research Context
        Source Snapshot -> Evidence -> Claim -> Review
                          |
                SQLite + Event / Outbox
                          |
         Briefing / Context / Vault / Viewer / Export
```

## 实施前基线

当前 revision 已有 Project/Task 作用域、Thread、Working Memory、Memory Candidate、受控 Memory 生命周期、统一 `prepareContext`、Recall Receipt、Research Case、Evidence/Claim/Review、CLI/MCP/Viewer 和 SQLite WAL。当前 Host Hook 仍以 SessionStart 与会话结束 transcript 为主；没有一等 Lifecycle Session/Turn；Evidence 仍只保存调用方提供的 URL、locator 与 excerpt；异步跟进主要由专用 distill job 和调用后 callback 驱动。

## 实现结果

- 六类入口均通过可发现的 Host Adapter Registry 和 Unified Turn Lifecycle Port；Descriptor 同时区分 Source Host 与 Transport。
- schema v13 已落地 Lifecycle Session/Turn、Capture Record、Domain Event/Outbox、Source Snapshot、Evidence Verification 和 handler receipt。
- Research approve gate 要求 current verified supporting Evidence；结构化反证处置、Snapshot stale 级联和旧 Claim 重开均已实现。
- Briefing 只展示 Research 状态摘要；独立 Research Context 只投影 active approved Claim 和 current verified support，并通过 CLI、Viewer 与 MCP `prepare_research_context` 暴露；MCP 对研究事实只读并追加不含正文的 recall receipt，通用 `prepareContext` 不自动混入研究结论。
- Research Export、Markdown Vault 与 Viewer 公开 Snapshot 元数据、hash 和 Verification receipt，但不复制 Snapshot 正文。
- `verify:target-architecture`、`verify:research-pilot`、真实浏览器宽/窄屏验收和全量测试共同证明运行时链路。

## 目标

- 六类 Host 使用同一 Host Adapter interface 和稳定的 Host 能力声明。
- Before Turn 与 After Turn 通过一个 Turn Lifecycle interface 执行，具有项目隔离、幂等和审计语义。
- Before Turn 只从 Context Orchestrator 获取 Context Packet，不允许 Host 自行拼装正式上下文。
- After Turn 原子保存 Capture Record、Domain Event 和 Outbox Message，不直接接受 Memory 或审核 Research Claim。
- 自动提取只产生处于 Quarantine 的 Memory Candidate 或 Research Packet Candidate。
- Evidence 在批准 Claim 前必须通过 Source Snapshot 验证和 as-of 检查。
- Domain Event 与需要的 Outbox Message 同事务提交；worker 具有租约、重试、失败与幂等语义。
- Briefing、Context Bundle、Vault、Viewer 和 Export 只读取 SQLite 事实源，不反向修改事实状态。

## 非目标

- 不把 Mira 拆成常驻网络微服务。
- 不实现通用个人 L1/L2/L3 World Model 或自动 Skill 结晶。
- 不让 Memory、Research Claim 或模型 confidence 自动修改 thesis。
- 不在本阶段实现完整浏览器抓取器、付费源登录、OCR 或文档版权管理。
- 不建立云同步、多人 RBAC、仓位或交易执行系统。

## 公开 seam

### Host Adapter Registry

```ts
type MiraHost = "codex" | "claude-code" | "cursor" | "cli" | "mcp" | "ui";

interface HostAdapterRegistry {
  list(): HostAdapterDescriptor[];
  normalizeBeforeTurn(host, input): BeforeTurnCommand;
  normalizeAfterTurn(host, input): AfterTurnCommand;
}
```

Registry 只做格式、能力和稳定身份转换。未知 Host、缺失稳定 ID、超长字段或不支持的 phase 必须在进入领域写入前拒绝。

Descriptor 明确区分 `source_host`（Codex、Claude Code、Cursor）和 `transport`（CLI、MCP、Viewer）。两者共享 Lifecycle Port，但 Transport 不是会话内容的原始生产宿主；Turn Domain Event 同时记录 `sourceHost` 与 `transport`，审计时不会混淆来源与接入通道。

### Turn Lifecycle Port

```ts
interface TurnLifecyclePort {
  beforeTurn(command: BeforeTurnCommand): BeforeTurnResult;
  afterTurn(command: AfterTurnCommand): AfterTurnResult;
}
```

`beforeTurn` 返回 `Lifecycle Session + Turn + Context Packet`。相同 `projectId + host + hostSessionId + hostTurnId` 重试返回同一 Turn 和同一已持久化 Recall Receipt，不重复记录召回。

`afterTurn` 要求已有或可幂等补建的 Turn，原子保存 outcome/Capture Record、`turn_completed` Domain Event 和至少一个需要的 Outbox Message。重复完成不得覆盖不同结果；完全相同输入返回原 receipt。

### Evidence Verification

```ts
interface EvidenceVerifier {
  registerSourceSnapshot(input): SourceSnapshot;
  verifyEvidence(caseId, evidenceId): EvidenceVerification;
}
```

Source Snapshot 使用 SHA-256 content hash；同一项目内相同 hash/URI/version 幂等。验证状态为 `pending | verified | failed | stale`，保存检查代码与不含完整正文的 receipt。

### Outbox Runner

```ts
interface OutboxRunner {
  runNext(projectId, handlers): OutboxRunResult | undefined;
}
```

Runner 以 immediate transaction 领取消息。租约过期可恢复；handler 成功后才标记 completed；失败错误脱敏，按指数退避，超过预算标记 failed。handler 必须以 Outbox Message ID 作为幂等键。

## 数据模型

### Lifecycle Session

- `id / projectId / host / hostSessionId`
- `status`: `open | closed`
- `openedAt / lastSeenAt / closedAt?`
- 唯一：`projectId + host + hostSessionId`

### Lifecycle Turn

- `id / projectId / sessionId / hostTurnId / taskId?`
- `query / outcomeStatus / response?`
- `status`: `started | completed`
- `recallEventId? / captureRecordId?`
- `startedAt / completedAt?`
- 唯一：`projectId + sessionId + hostTurnId`

### Capture Record

- `id / projectId / turnId / threadId?`
- `contentHash / capturedAt`
- 不保存第二份完整 transcript；正文由 Thread 或 Turn 引用。

### Domain Event

- `id / projectId / aggregateType / aggregateId / eventType`
- `payload / createdAt`
- append-only；payload 禁止复制完整 transcript、Evidence Snapshot 正文或密钥。

### Outbox Message

- `id / projectId / eventId / topic / payload`
- `status`: `pending | running | completed | failed`
- `attempts / maxAttempts / availableAt / leaseExpiresAt? / lastError?`
- `createdAt / updatedAt`

### Source Snapshot

- `id / projectId / canonicalUri / sourceTitle`
- `publishedAt? / accessedAt / mediaType`
- `content / contentHash / state`
- `state`: `current | stale | archived`

### Evidence Verification

- `id / projectId / caseId / evidenceId / snapshotId`
- `status`: `pending | verified | failed | stale`
- `checks`: integrity、locator、excerpt、publication、freshness
- `receipt / verifiedAt? / createdAt / updatedAt`
- 每个 Evidence 只有一个 current Verification；重新验证创建 successor 或更新当前状态时必须保留 Domain Event。

## Research Gate v1

Claim approve 必须满足 Research Case v0 条件，并增加：

- 每个用于 `supports` 的 Evidence 至少一个 current `verified` Verification。
- Snapshot content hash 与实际 content 一致。
- locator 可在 Snapshot 中定位；规范化 excerpt 必须存在于 Snapshot content。
- Snapshot `publishedAt` 不得晚于 Case `asOfDate`。
- Evidence `accessedAt` 不得早于 Snapshot `publishedAt`，`validThrough` 不得早于 `publishedAt`。
- 存在 current `contradicts` link 时，批准命令必须包含逐条、按 `evidenceId` 绑定的结构化 Contradiction Disposition；自然语言 reason 不替代 disposition，缺失时只能 request changes/reject。
- 自动 verifier 可以判定结构验证，不能把 Claim semantic entailment 自动标记为人工批准。

旧 v11 Evidence 在迁移后保持可读，但 Verification 为 pending；既有 approved Claim 进入 changes_requested，直到完成验证。

## Host 行为

- Codex、Claude Code 原生 Hook 调用相应 Adapter；Cursor 通过 MCP 或 CLI 调用 Cursor Adapter。历史扫描仍是离线 Source Import，不伪装成实时 Turn。
- CLI `turn before/after` 提供可脚本化生命周期入口。
- MCP `before_turn/after_turn` 默认可写 Capture Record，但只能提交候选；受控 Memory/Research 操作仍需 confirmation policy。
- Viewer 的人工按钮仍代表显式本地授权；Viewer 发起的上下文预览使用 preview，不记录 Recall Receipt。
- 不支持原生 Hook 的 Host 可通过 CLI/MCP Adapter 使用同一协议。

## Outbox topic

- `capture.distill.requested`: 为 Capture Record 对应 Thread 创建或确认 distill job。
- `research.evidence.verify.requested`: 验证 Evidence 与 Source Snapshot。
- `projection.refresh.requested`: 重建可能 stale 的 Briefing/Vault 元数据；派生失败不回滚事实提交。

## 失败与恢复

- Before Turn 失败不得创建半个 Turn；已写 Turn 但 Context 失败时记录失败 Event，并允许同 ID 重试。
- After Turn 的状态、Capture Record、Event、Outbox 必须同事务提交。
- Outbox handler 崩溃后由 lease recovery 重试；旧 lease 不能完成新 attempt。
- Snapshot 校验失败只影响 Verification 和关联 Claim review 状态，不删除 Snapshot/Evidence。
- 任一 Host Adapter 错误不应阻塞其他 Host。
- 所有错误输出经过敏感信息脱敏；原始正文不进入事件 receipt、Outbox lastError 或日志。

## 兼容与迁移

- v11→v12：增加 Lifecycle Session、Turn、Capture Record、Domain Event 和 Outbox；保留现有 Thread、Memory、jobs、recall 和 Research 数据。
- v12→v13：增加 Source Snapshot 与 Evidence Verification，并把旧 Evidence 标记为 pending verification。
- 旧 Hook 命令保持可用，但内部改为 Adapter + Lifecycle Port。
- `buildContextBundle` 保持兼容 wrapper，内部继续委托 `prepareContext`。
- 现有 Research packet v0 输入在过渡期可读取；新提交必须包含 snapshot binding 或先注册 Snapshot。

## 自动化验收

- Host Registry seam：六类 Host descriptor、规范化、未知 Host 与非法 phase 拒绝。
- Lifecycle seam：before/after 幂等、项目隔离、同 ID 冲突、Recall/Capture receipt、事务回滚。
- Capture seam：After Turn 只产生 Candidate/Quarantine 或 Outbox，不创建正式 Memory/approved Claim。
- Evidence seam：hash、excerpt、locator、as-of、freshness、stale 传播、contradiction disposition。
- Outbox seam：同事务、claim lease、重试、恢复、幂等完成、脱敏错误。
- Surface seam：Codex/Claude/Cursor/CLI/MCP/UI 通过 Registry/Lifecycle，且 CLI/MCP snapshot 一致。
- Projection seam：Briefing/Context/Vault/Viewer/Export 读取同一 SQLite 状态，派生输出不可回写事实。
- Migration：fresh v13、v11→v13 数据保留、旧 Claim 重开、未来版本拒绝。
- Runtime：真实临时项目完成 `beforeTurn → afterTurn → outbox drain → candidate review → source snapshot → evidence verify → claim review → export`。
- 全量：`npm test`、`npm run build`、`git diff --check`，Viewer 需要真实浏览器宽/窄屏与零 JavaScript error。

## 完成判定

目标架构只有在上述所有 seam 均由当前 revision 的测试或 runtime artifact 证明、六类 Host 可发现、v13 migration 可重复、真实研究案例通过新 Evidence Verification、且所有派生读取一致时才算完成。目录、类型声明或未接入的适配器不计为完成。
