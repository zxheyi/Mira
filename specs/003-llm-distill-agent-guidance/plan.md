# LLM Distill and Agent Guidance Plan

Feature ID: `003-llm-distill-agent-guidance`
Status: Complete

## 设计决策

P1 采用 provider-neutral 设计：

- Mira 生成 prompt。
- 用户或 Agent 把 prompt 交给任意 LLM。
- LLM 返回 JSON 候选。
- Mira 校验并写入。

这样避免 MVP 早期绑定 API key、网络和供应商 SDK，同时保留未来接入在线 LLM provider 的接口空间。

## 模块设计

- `src/distill/llmDistill.ts`
  - `buildLlmDistillPromptForThread(db, projectId, threadId)`
  - `buildLlmDistillPrompt({ threadId, rawText })`
  - `parseLlmMemoryCandidates(rawText)`
  - `applyLlmDistillCandidates(db, projectId, threadId, candidates)`

## CLI 设计

```bash
mira memory llm-prompt --thread thread_1
mira memory apply-candidates --thread thread_1 --path ./candidates.json
```

## Candidate JSON

```json
{
  "memories": [
    {
      "title": "Use local SQLite",
      "kind": "decision",
      "content": "Mira stores project memory in local SQLite.",
      "confidence": 0.9,
      "importance": 8
    }
  ]
}
```

## 验证计划

- TDD: 先写 `tests/distill/llmDistill.test.ts`。
- TDD: 再写 CLI 测试。
- 完成后跑 `npm test` 和 `npm run build`。
