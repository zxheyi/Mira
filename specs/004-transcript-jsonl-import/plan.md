# Transcript JSONL Import Plan

Feature ID: `004-transcript-jsonl-import`
Status: Complete

## 设计决策

JSONL importer 不保存结构化 message 表，先把 transcript 转成 Markdown Thread：

- 现有 Thread schema 不变。
- 确保人工可读、可导出、可审计。
- 确保现有 deterministic distill 和 LLM distill 能继续工作。

## 模块设计

扩展 `src/importers/agentSessionImporter.ts`：

- `AgentSessionRawFormat = "markdown" | "jsonl"`。
- `AgentSessionImportInput.format?: "auto" | "markdown" | "jsonl"`。
- 新增 `normalizeJsonlSession(input)`。
- 新增 JSONL line parser 和 content extractor。

## CLI 设计

```bash
mira import --source codex --format jsonl --path ./codex-transcript.jsonl
mira import --source claude-code --format jsonl --path ./claude-transcript.jsonl
mira import --source codex --format auto --path ./session.jsonl
```

`--format` 默认 `auto`。

## Transcript Markdown Shape

```markdown
# <title>

Source: claude-code
Format: jsonl

## user

Time: 2026-07-10T10:00:00.000Z

User message.

## assistant

Assistant message.

Tool: Edit
```

## 验证计划

- TDD: importer 单元测试先失败。
- TDD: CLI JSONL 导入测试先失败。
- 实现最小 parser。
- 跑 targeted tests。
- 跑 `npm test` 和 `npm run build`。
