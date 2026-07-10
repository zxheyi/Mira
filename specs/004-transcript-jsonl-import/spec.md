# Transcript JSONL Import Spec

Feature ID: `004-transcript-jsonl-import`
Status: Complete

## 目标

P2 让 Mira 支持 Codex 和 Claude Code 的真实 transcript 文件导入。第一步只处理 JSONL 文件，把不同消息结构 normalize 成可读 Markdown Thread，后续继续复用 distill、LLM distill、search 和 context bundle。

## 范围

- 支持 `mira import --source codex --format jsonl --path <file>`。
- 支持 `mira import --source claude-code --format jsonl --path <file>`。
- 支持 `--format auto` 根据扩展名推断 `.jsonl` 或 Markdown。
- JSONL 每行必须是 JSON object。
- 保留消息角色、时间、文本内容和工具调用摘要。
- 导入结果保存为 Thread，`raw_format=jsonl`。

## 非目标

- 不读取 Codex 或 Claude Code 私有本地数据库。
- 不自动发现 transcript 路径。
- 不捕获正在运行的会话。
- 不保证覆盖所有历史版本 transcript schema。
- 不改变数据库 schema。

## 功能需求

- `AgentSessionRawFormat` 支持 `markdown` 和 `jsonl`。
- `importAgentSessionFromFile` 支持 `format?: "auto" | "markdown" | "jsonl"`。
- JSONL 导入输出的 `rawText` 是规范化 Markdown：
  - 以 H1 标题开头。
  - 每条消息使用 `## <role>` heading。
  - 有 timestamp 时显示为 `Time: ...`。
  - tool call 显示为 `Tool: <name>`。
- 支持常见消息形态：
  - `{ "role": "user", "content": "..." }`
  - `{ "type": "user", "message": { "role": "user", "content": "..." } }`
  - `{ "type": "assistant", "message": { "role": "assistant", "content": [{ "type": "text", "text": "..." }] } }`
  - `{ "role": "assistant", "content": [{ "type": "tool_use", "name": "Edit", "input": {...} }] }`
- 空行被忽略。
- 非 JSON 行报错并包含行号。

## 验收标准

- 单元测试覆盖 Claude Code JSONL transcript normalize。
- 单元测试覆盖 Codex JSONL transcript normalize。
- 单元测试覆盖非法 JSON 行报错。
- CLI 测试覆盖 `--format jsonl` 导入后能 distill/search。
- `npm test` 和 `npm run build` 通过。
