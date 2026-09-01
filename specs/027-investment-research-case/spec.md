# Investment Research Case v0

状态：Approved
日期：2026-09-01

## 决策摘要

在 Mira 核心记忆层之上增加项目级 Research Case 模块，用可审计的 Evidence → Claim → Review 数据结构承载投资研究。模块不拥有 thesis、目标价、仓位或交易执行权限，也不把 Claim 自动转换为正式 Memory。

公开写入 seam 收敛为：

1. `submitResearchPacket`：原子提交一个 draft Research Case、Evidence Items、Claims 和 Claim Evidence Links。
2. `reviseResearchClaim`：授权后创建不可变 successor。
3. `markResearchEvidenceStale`：授权后标记来源过期并使相关 Claim 回到待审核。
4. `reviewResearchClaim`：授权后批准、拒绝或要求修改。
5. `getResearchCaseSnapshot` / `exportResearchCaseMarkdown`：读取完整可审计视图。

CLI、MCP 和管理 UI 都调用这些接口，不重复实现领域规则。

## 目标

- 一条 Claim 可以精确定位支持、反驳和背景 Evidence。
- Evidence Status、Review Status 和模型置信度保持三个独立概念。
- 来源过期、主张纠正和审核结果均留下 append-only Review Event。
- Thesis Impact Proposal 可读、可审核，但永远不执行 thesis mutation。
- 所有写入项目隔离、事务化并记录不含正文的审计 receipt。

## 非目标

- 不抓取网页、不托管完整财报或付费内容。
- 不计算估值、目标价、仓位或交易信号。
- 不建立 thesis 表或自动更新正式 Memory。
- 不在 v0 实现 embedding、向量数据库或自动研究 Agent。
- 不允许 MCP 参数自授予审核权限。

## 数据模型

### Research Case

- `id / projectId / title / question / asOfDate`
- `status`: `draft | in_review | completed | archived`
- `createdAt / updatedAt`

### Evidence Item

- `id / projectId / caseId`
- `sourceType`: `regulatory_filing | company_material | market_data | research_paper | secondary_analysis | other`
- `sourceUri / sourceTitle / locator / excerpt`
- `publishedAt? / accessedAt / validThrough?`
- `contentHash`
- `state`: `current | stale | archived`
- `createdAt / updatedAt`

Evidence Item 保存用于复核的短摘录和定位，不保存整份外部文档。`validThrough < ResearchCase.asOfDate` 或显式 stale 都视为过期。

### Claim

- `id / projectId / caseId / statement`
- `evidenceStatus`: `observed | supported | contested | unsupported | rejected`
- `reviewStatus`: `pending | approved | rejected | changes_requested`
- `confidence`: `0..1`
- `thesisImpact`: `none | watch | strengthen | weaken | invalidate`
- `invalidationConditions`
- `status`: `active | superseded`
- `supersedesClaimId? / createdAt / updatedAt`

修订创建 successor，旧 Claim 变为 superseded；历史内容不原地覆盖。

### Claim Evidence Link

- `claimId / evidenceId`
- `relation`: `supports | contradicts | contextual`
- `rationale`

Claim 与 Evidence 必须属于同一项目和同一 Research Case。

### Research Event

- `id / projectId / caseId / claimId? / evidenceId?`
- `eventType`: `packet_submitted | claim_revised | evidence_marked_stale | claim_reviewed`
- `receipt`: JSON，不复制 Evidence excerpt 或 Claim statement
- `createdAt`

`claim_reviewed` 是 Review Event。receipt 记录 actor、authority reason、decision、operation reason、相关 ID 和 outcome。

## Draft 提交契约

`submitResearchPacket` 接收调用者提供的局部 key，事务内解析为真实 ID：

```json
{
  "case": {
    "title": "Example",
    "question": "What changed?",
    "asOfDate": "2026-09-01"
  },
  "evidence": [{
    "key": "E1",
    "sourceType": "regulatory_filing",
    "sourceUri": "https://example.test/filing",
    "sourceTitle": "Quarterly filing",
    "locator": "p. 12",
    "excerpt": "Bounded source excerpt.",
    "publishedAt": "2026-08-01",
    "accessedAt": "2026-09-01",
    "validThrough": "2026-09-30"
  }],
  "claims": [{
    "key": "C1",
    "statement": "A scoped analytical statement.",
    "evidenceStatus": "supported",
    "confidence": 0.8,
    "thesisImpact": "watch",
    "invalidationConditions": "Re-evaluate after the next filing.",
    "links": [{
      "evidenceKey": "E1",
      "relation": "supports",
      "rationale": "The filing directly reports the scoped observation."
    }]
  }]
}
```

约束：

- packet 恰好创建一个 Case，Evidence key 和 Claim key 各自唯一。
- 至少一个 Evidence 和一个 Claim；每个 Claim 至少一个 link。
- 引用不存在的 key、跨 Case 关系、敏感信息、超长字段或非法日期使整个提交回滚。
- Draft submit 不需要 confirmed curation 权限，因为它不会创建 Memory 或 thesis 状态；它仍记录 `packet_submitted` receipt。

## Case 状态

- packet 提交后为 `draft`。
- 第一次 revise、stale 或 review 后进入 `in_review`。
- 每个 active Claim 都为 approved 或 rejected，且至少一个为 approved 时自动变为 `completed`。
- Evidence stale 或 Claim revision 会把 completed Case 退回 `in_review`。
- `archived` 为保留状态；v0 不提供归档写入口。

## Evidence Gate 与审核

`approve` 只允许 active Claim，并同时满足：

- Evidence Status 为 `observed` 或 `supported`。
- 至少一个 current、未过期的 `supports` link。
- `invalidationConditions` 非空。
- 所有 `contradicts` link 保留在快照中；审核 reason 必填，用于解释如何处理反证。

`reject` 和 `request_changes` 也要求 reason。任何审核都需要 project-bound Research Authority；该 opaque authority 只能由本地 CLI/UI 或宿主 confirmation policy 创建，工具参数不能伪造。

Evidence 标记 stale 后：

- Evidence state 变为 stale。
- 所有引用它的 active Claim 的 Review Status 变为 `changes_requested`。
- 已批准 Claim 不再表现为当前已批准结果。
- 操作和受影响 Claim IDs 在同一事务中审计。

Claim 修订后：

- predecessor 变为 superseded。
- successor 的 Review Status 重置为 pending。
- 新 link 集合必须显式提交，不从旧 Claim 隐式继承。
- predecessor 和 successor 都可从 Case snapshot 与事件历史读取。

## CLI / MCP

CLI：

```text
mira research submit --path <packet.json>
mira research show --case <id>
mira research revise --claim <id> --path <revision.json> --reason <text>
mira research evidence-stale --evidence <id> --reason <text>
mira research review --claim <id> --decision approve|reject|request_changes --reason <text>
mira research export --case <id> [--out <file>]
```

MCP：

```text
submit_research_packet
get_research_case
revise_research_claim
mark_research_evidence_stale
review_research_claim
export_research_case
```

MCP draft submit/read/export 默认可用。revise/stale/review 与正式 Memory curation 共用宿主 confirmation policy 作为授权来源，但使用独立、project-bound Research Authority。

## UI 与导出

- Viewer 增加“研究案例”导航，展示 Case 列表、Evidence、Claim、links、状态和 Review Events。
- UI 允许对 active Claim 执行 approve/reject/request_changes，并允许标记 Evidence stale；继续使用 loopback、Origin、Host、CSRF 和显式原因校验。
- Markdown 导出确定性排序，包含 as-of date、Evidence Ledger、Claim Matrix、反证、Thesis Impact Proposals、Review Events 和边界声明。
- 导出是派生输出，不回写数据库。

## Migration 与数据完整性

- schema v11 新增 `research_cases`、`research_evidence`、`research_claims`、`research_claim_evidence`、`research_events`。
- v10→v11 保留现有 Project、Thread、Memory、candidate、recall 和 curation 数据。
- 所有外键按 Project/Case 作用域校验；迁移和写入事务结束前执行 FK 完整性检查。
- 删除 Project 级联删除研究数据；Research Event 不允许单独修改。

## 真实案例验收

选一个公开公司和固定 as-of date，使用一手来源完成：

- 10–20 个 Evidence Items。
- 5–10 个 Claims。
- 至少一个 contradicts link。
- 一次 Claim revision。
- 一次 Evidence stale 处理。
- 对 active Claims 完成审核。
- CLI/MCP 读取一致，UI 可查看和审核，Markdown 可导出。

试点只验证研究可追溯性，不构成投资建议。

## 自动化验收 seam

- Governance interface：packet 原子性、同 Case 关系、证据 gate、授权、不可变修订、stale 传播和审计回滚。
- CLI/MCP：同一 snapshot、默认 draft 能力、确认操作权限和稳定错误。
- UI：真实路由数据、审核/过期操作、窄屏布局和无 JavaScript 错误。
- Migration：fresh v11、v10 保留数据、未来版本拒绝。
- 全量：`npm test`、`npm run build`、`git diff --check`。
