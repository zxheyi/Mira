# Agent Session Import Spec

Feature ID: `002-agent-session-import`
Status: Complete

## 目标

Mira 需要先支持 Codex 和 Claude Code 的会话导入，把 Agent 工作过程以统一格式保存为 Mira Thread，并继续复用现有 distill、search、context bundle 闭环。

## 范围

P0 只覆盖 Markdown / 纯文本会话文件导入：

- Codex Markdown 会话摘要导入。
- Claude Code Markdown 会话摘要导入。
- 通用 Markdown 会话导入。
- 导入后保存为当前项目的 Thread。

## 非目标

- 不解析 WorkBuddy。
- 不读取浏览器缓存、auth 文件或私有应用数据库。
- 不自动捕获 Codex / Claude Code 的完整 transcript。
- 不实现 JSONL transcript 解析。
- 不在导入时自动执行 distill。

## 用户故事

1. 作为 Mira 用户，我可以把 Codex 会话摘要 Markdown 导入 Mira，后续用 `memory distill` 提炼记忆。
2. 作为 Mira 用户，我可以把 Claude Code 会话摘要 Markdown 导入 Mira，并保留来源为 `claude-code`。
3. 作为 Mira 用户，我可以用同一个 CLI 命令导入不同 Agent 来源的 Markdown 文件。

## 功能需求

- `mira import --source <source> --path <file>` 应读取文件并保存 Thread。
- `source` 必须是 `codex`、`claude-code` 或 `markdown`。
- 导入的 `rawFormat` 为 `markdown`。
- 如果用户提供 `--id`，导入使用该 id。
- 如果用户不提供 `--id`，系统基于 source、文件绝对路径和内容生成稳定 id。
- 如果用户提供 `--title`，导入使用该标题。
- 如果用户不提供 `--title`，系统优先使用 Markdown 第一个 H1；没有 H1 时使用文件名。
- CLI 输出保存后的 Thread JSON。

## 验收标准

- Codex Markdown 文件可以通过 CLI 导入并保存为 `source=codex`。
- Claude Code Markdown 文件可以通过 CLI 导入并保存为 `source=claude-code`。
- 导入接口有单元测试覆盖标题推断、id 生成和 source 校验。
- CLI 有集成测试覆盖 import -> distill -> search 的最小闭环。
- `npm test` 和 `npm run build` 通过。
