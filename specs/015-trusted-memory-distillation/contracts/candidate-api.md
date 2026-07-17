# Memory Candidate API Contract

## Candidate Input

```ts
interface MemoryCandidateInput {
  title: string;
  kind: MemoryKind;
  content: string;
  evidence: string;
  confidence: number;
  importance: number;
}
```

`evidence` 必须是目标 Thread 正文中的原文片段。Mira 不接受只给推理结果、不给来源证据的候选。

## Candidate Result

```ts
interface MemoryCandidateResult {
  candidate: MemoryCandidate;
  outcome: "accepted" | "pending_review" | "rejected" | "duplicate";
  reasons: CandidateReviewReason[];
  memory?: Memory;
}
```

持久化 Candidate 还包含 `threadInputHash`，用于审核时确认来源 Thread 版本未变化。

`CandidateReviewReason` MVP 值：

- `low_confidence`
- `high_impact_kind`
- `conflict`
- `duplicate`

非法字段、无原文证据和敏感信息不创建 Candidate，直接返回输入错误。

## MCP: submit_memory_candidates

Input:

```json
{
  "threadId": "thread_codex_session",
  "sourceAgent": "codex",
  "sourceModel": "gpt-5",
  "candidates": [
    {
      "title": "SQLite migration policy",
      "kind": "convention",
      "content": "Schema changes must use numbered migrations.",
      "evidence": "Schema changes must use numbered migrations.",
      "confidence": 0.98,
      "importance": 0.8
    }
  ]
}
```

Output: `{ results: MemoryCandidateResult[] }`。

## MCP: list_memory_candidates

Input:

```json
{
  "status": "pending_review",
  "limit": 50
}
```

Output: `{ candidates: MemoryCandidate[] }`。`limit` 范围为 1–100，默认 50。

## MCP: review_memory_candidate

Input:

```json
{
  "candidateId": "candidate_...",
  "decision": "accept",
  "reason": "Confirmed during review"
}
```

Output: `MemoryCandidateResult`。`reason` 最大 1000 字符。

三个 MCP 工具都使用 Server 启动时绑定的项目，不接受 `projectRoot` 字段；这避免调用方把候选写入另一个项目数据库。

## Provider Response

```json
{
  "candidates": [MemoryCandidateInput]
}
```

Provider 可能返回 fenced JSON；解析器只提取一个顶层对象，拒绝非对象、超过 50 条、未知 kind、非有限数值或超长字段。
