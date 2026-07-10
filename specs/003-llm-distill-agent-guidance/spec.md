# LLM Distill and Agent Guidance Spec

Feature ID: `003-llm-distill-agent-guidance`
Status: Complete

## 目标

P1 让 Mira 从确定性规则提炼扩展到可审查的 LLM 提炼流程，并补齐 Codex / Claude Code 的行为引导模板。

## 范围

- 生成针对单个 Thread 的 LLM memory distill 提示词。
- 校验 LLM 返回的候选 Memory JSON。
- 将候选 Memory 写入当前项目，作为该 Thread 的提炼结果。
- 更新 AGENTS / Claude Code 模板，明确会话开始、过程中、结束前如何使用 Mira。

## 非目标

- 不直接绑定 OpenAI、Claude 或其他在线 API。
- 不在本阶段保存 evidence 字段到数据库。
- 不实现自动 transcript 捕获。
- 不实现 UI 审核队列。

## 功能需求

- `mira memory llm-prompt --thread <id>` 输出可复制给 LLM 的 Markdown 提示词。
- 提示词必须包含 JSON 输出 schema、允许的 Memory kind、原始 Thread 文本。
- `mira memory apply-candidates --thread <id> --path <json>` 读取 LLM 候选记忆并写入数据库。
- 候选 JSON 支持数组或 `{ "memories": [...] }` 包装。
- 只接受现有 `MemoryKind`。
- `confidence` 默认 `0.8`，范围必须为 `0..1`。
- `importance` 默认 `5`，范围必须为 `1..10`。
- 写入前清除该 Thread 已有 memories，使同一候选文件重复 apply 保持幂等。

## 验收标准

- LLM prompt 单元测试覆盖 schema、kind 和 Thread 文本。
- LLM candidate parser 单元测试覆盖数组、对象包装和非法 kind。
- apply candidates 单元测试覆盖清除旧记忆、写入新记忆。
- CLI 测试覆盖 `memory llm-prompt` 和 `memory apply-candidates`。
- 文档模板包含 LLM distill 审核工作流。
- `npm test` 和 `npm run build` 通过。
