# Agent Session Import Plan

Feature ID: `002-agent-session-import`
Status: Complete

## 设计原则

- 先支持用户可控的 Markdown 文件，不触碰 auth、缓存和私有数据库。
- 统一导入层只负责 normalize 和保存 Thread，不承担 memory distill。
- Codex、Claude Code、通用 Markdown 在 P0 共享 Markdown importer，通过 `source` 区分来源。

## 模块设计

- `src/importers/agentSessionImporter.ts`
  - 定义 `AgentSessionSource`、`AgentSessionImportInput`、`NormalizedAgentSession`。
  - 暴露 `importAgentSessionFromFile(input)`。
  - 暴露 `normalizeMarkdownSession(input)`，方便单元测试。

## CLI 设计

```bash
mira import --source codex --path ./codex-session.md
mira import --source claude-code --path ./claude-session.md --id claude_001
mira import --source markdown --path ./notes.md --title "Planning Notes"
```

CLI 行为：

- 自动使用当前项目 root 和 `.mira/mira.sqlite`。
- 自动创建项目记录。
- 保存 Thread。
- 输出 Thread JSON。

## 数据映射

| Import Field | Mira Thread Field |
| --- | --- |
| `id` | `threads.id` |
| `source` | `threads.source` |
| `title` | `threads.title` |
| `rawFormat` | `threads.raw_format` |
| `rawText` | `threads.raw_text` |

## 验证计划

- 单元测试：Markdown normalize。
- CLI 测试：Codex Markdown 导入。
- CLI 测试：Claude Code Markdown 导入后 distill/search。
- 全量验证：`npm test`、`npm run build`。
