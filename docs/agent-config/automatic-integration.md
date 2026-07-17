# Codex / Claude Code 自动接入指南

Mira 使用项目级 Hook 自动捕获会话，并通过项目级 MCP Server 让 Agent 搜索和写入记忆。无需后台常驻服务。

## 前置条件

在 Mira 仓库完成依赖安装和构建：

```bash
npm install
npm run build
```

安装器会把当前 Node executable 和构建后的 Mira CLI 绝对路径写入配置，因此目标 IDE 不依赖 shell `PATH` 或启动目录。

## 安装

在目标 Git 项目执行：

```bash
mira --project-root /absolute/project integration install --agent all --dry-run
mira --project-root /absolute/project integration install --agent all
mira --project-root /absolute/project integration status
```

`--agent` 可选 `codex`、`claude-code` 或 `all`。重复安装是幂等的，已有非 Mira Hook 和 MCP 配置会保留；若存在非 Mira 管理的同名 `mira` MCP Server，安装会停止并报告冲突。

## 自动行为

| Agent | 会话开始 | 会话捕获 |
| --- | --- | --- |
| Codex | `SessionStart` 注入 Context Bundle | `Stop` 导入主 transcript |
| Claude Code | `SessionStart` 注入 Context Bundle | `Stop` 同步，`SessionEnd` 最终同步 |

同一 `<agent, session_id>` 始终更新同一个 Thread。Mira 在 `integration_cursors` 表保存 transcript 路径、大小和修改时间；文件未变化时跳过重复导入，导入失败时不推进检查点，因此后续 Hook 可以重试。

Mira 只接受 Hook 明确提供、位于官方会话目录中的 `.jsonl` transcript，并要求 Hook `cwd` 位于绑定项目内。它不会扫描浏览器、凭据目录、子 Agent 目录或其他项目。

## 可选可信自动提炼

默认安装不调用外部模型。需要 Provider 自动提炼时，为启动 Agent 的环境设置：

```bash
export MIRA_LLM_BASE_URL="https://provider.example/v1"
export MIRA_LLM_MODEL="model-name"
export MIRA_LLM_API_KEY="optional-api-key"
```

Provider 使用 OpenAI-compatible `/chat/completions`。成功捕获变化后的 Thread 后，Hook 只执行本地幂等入队并 detached 启动一次性 Worker，不等待网络请求。未配置 `MIRA_LLM_BASE_URL` 或 `MIRA_LLM_MODEL` 时不会入队，也不会产生失败任务。

候选必须携带可在 Thread 正文中定位的原文证据，并绑定提取时的 Thread 版本。正文变化后旧待审候选不能接受，需要重新提交。高置信低风险候选可自动接受；高影响、低置信或冲突候选留在审核队列：

```bash
mira --project-root /absolute/project distill jobs list
mira --project-root /absolute/project distill jobs retry --id distill_job_123
mira --project-root /absolute/project memory candidate list --status pending_review
mira --project-root /absolute/project memory candidate review --id candidate_123 --decision accept
```

任务和候选保存在 schema v3 的 `distill_jobs`、`memory_candidates` 中。同一 Thread 正文版本只创建一个 Provider 任务；Provider 响应仍必须经过证据、敏感信息、重复与冲突校验。失败任务可立即重试，running 任务需超过 5 分钟租约才可恢复。

启用 Provider 意味着把完整 Thread 发送到该外部服务。Mira 会在发送前拦截常见私钥、OpenAI/GitHub Token、AWS Access Key 和显式 secret/password/token 赋值，但规则无法覆盖所有敏感内容；请先确认 Provider 的隐私和数据保留策略。

## 本地产物

安装器管理以下文件中的 Mira 条目：

```text
.codex/hooks.json
.codex/config.toml
.claude/settings.local.json
.mcp.json
```

这些配置包含本机绝对路径。Git 项目中，安装器会维护 `.git/info/exclude` 的 `mira integration local config` 标记块，避免误提交，同时保留原有本地排除规则。

运行数据位于：

```text
.mira/mira.sqlite
.mira/integrations.log
```

日志只包含 Agent、事件、session ID、文件名、原因和错误消息，不包含 transcript 正文。

## 信任与排障

Codex 和 Claude Code 首次读取项目 Hook/MCP 配置时可能要求确认项目可信。完成官方信任确认后，新会话才会执行自动接入；Mira 不修改或绕过信任状态。

查看状态：

```bash
mira --project-root /absolute/project integration status
```

查看安全诊断：

```bash
tail -n 50 /absolute/project/.mira/integrations.log
```

常见忽略原因：

- `cwd-outside-project`：Hook 事件不属于绑定项目。
- `transcript-unavailable`：路径缺失、文件尚未生成或不是 JSONL。
- `transcript-path-not-allowed`：文件不在 Agent 官方会话目录。
- `transcript-unchanged`：检查点确认 transcript 没有变化。
- `hook-processing-failed`：导入或数据库操作失败；修复后下一次 Hook 会重试。
- `distill-enqueue-failed`：Thread 已保存，但提炼入队或 Worker 启动失败；不会阻塞 Agent，可用 CLI 手动 enqueue。

## 卸载

```bash
mira --project-root /absolute/project integration uninstall --agent all
```

卸载只移除 Mira 命令标识、MCP 配置、Codex TOML 托管块和对应 Git 本地排除项，不删除 `.mira/mira.sqlite` 中的历史数据，也不删除用户配置文件。
