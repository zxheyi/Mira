# 当前项目历史会话批量导入规格

状态：Approved
日期：2026-07-20

## 目标

为 Mira 增加 `history` 子系统，一键扫描 Codex 与 Claude Code 的本机历史会话，只导入属于当前项目或显式旧路径别名的主会话，并为每次正式导入保留可查询的审计记录。

## 用户故事

1. 用户可在当前项目运行一条命令，导入 Codex 与 Claude Code 的全部相关历史主会话。
2. 项目重命名或移动后，用户可通过重复的 `--root-alias` 显式匹配旧路径。
3. 同一批历史记录可安全重跑；未变化会话不会重复写入或重复入队提炼。
4. 单个文件损坏时，其余会话仍继续导入，失败路径、阶段和原因可在事后查询。
5. 用户可先 dry-run 查看扫描与分类结果，不修改数据库。

## 功能要求

### 扫描

- Codex 扫描 `$CODEX_HOME/sessions/**/*.jsonl` 和 `$CODEX_HOME/archived_sessions/**/*.jsonl`。
- Codex 从 `session_meta.payload.id/session_id` 和 `cwd` 提取归属元数据。
- Claude Code 扫描 `$CLAUDE_CONFIG_DIR/projects/*/*.jsonl`。
- Claude Code 从主记录的 `sessionId` 和 `cwd` 提取归属元数据。
- Claude Code 默认排除 `subagents/`、非 JSONL 文件和越出配置目录的符号链接。
- 扫描结果按规范化文件路径稳定排序并顺序处理。

### 匹配与导入

- 项目匹配只接受规范化当前项目根路径和显式 `--root-alias`；不做模糊匹配。
- 路径别名不要求当前存在，也不持久化。
- 项目不匹配文件标记为 `skipped`，且不读取或保存 transcript 正文。
- 共享 Hook 的稳定 Thread ID 逻辑，确保历史导入与后续自动捕获更新同一 Thread。
- 使用 SHA-256 指纹与现有数据将项目分类为 `imported / updated / unchanged / skipped / failed`。
- 每个匹配文件独立事务，单项失败不回滚其他成功项。
- 成功写入后同步 capture cursor。
- `--distill` 仅为 `imported/updated` 的 Thread 幂等创建 Provider 提炼任务，不同步调用网络。

### 审计与报告

- schema v6 增加 `history_import_runs` 与 `history_import_items`。
- 批次状态为 `running / completed / completed_with_errors / failed / interrupted`。
- 新正式批次开始时，同项目遗留 `running` 批次标记为 `interrupted`。
- 失败原因最多 1000 字符，不保存 transcript 正文、提示词或工具参数。
- `--report` 通过同目录临时文件加原子替换写出完整 JSON 报告。
- dry-run 不写 Thread、游标、提炼任务或审计表。

## CLI 契约

```bash
mira history import \
  [--agent all|codex|claude-code] \
  [--root-alias <old-path>...] \
  [--dry-run] \
  [--distill] \
  [--report <file>]

mira history runs [--limit 20]
mira history failures [--run <run-id>] [--limit 100]
```

- `--agent` 默认 `all`。
- 无失败退出 `0`；文件级失败、提炼入队失败或报告写入失败退出 `2`；启动、扫描或迁移级失败退出 `1`。
- 正式导入始终创建审计批次；dry-run 结果只输出到 stdout 或显式报告文件。

## JSON 报告契约

报告包含：`runId`、`dryRun`、`projectRoot`、`agents`、`rootAliases`、`status`、开始/结束时间、分类计数和逐项结果。逐项结果包含 Agent、session ID、文件路径、记录 cwd、指纹、结果、Thread ID、提炼状态、失败阶段和截断后的原因。

## 非目标

- 不建立全机中央索引。
- 不向其他项目数据库写入。
- 不做交互式归属修正或别名持久化。
- 不提供 MCP 批量导入工具、Web UI 或 Claude subagent 导入。
- 不自动发起历史 LLM 请求。

## 验收标准

- 扫描、匹配、迁移、审计 Store、批量服务、CLI、报告和退出码均有自动化测试。
- v5 升级到 v6 保留现有数据，并拒绝未来 schema 版本。
- dry-run 无数据库副作用；重复正式导入得到 `unchanged`。
- 单文件失败后其余文件继续；失败可通过 CLI 查询。
- 真实本机 dry-run 可用旧 `AnchorMem` 路径匹配 Mira，且不包含 Claude subagents。
- `npm test`、`npm run build`、`git diff --check` 和静态安全审查通过。
