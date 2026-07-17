# Integration CLI Contract

## Install

```bash
mira integration install --agent codex
mira integration install --agent claude-code
mira integration install --agent all
mira integration install --agent all --dry-run
```

输出 JSON：

```json
{
  "agent": "all",
  "projectRoot": "/absolute/project",
  "dryRun": false,
  "changes": [
    { "path": "/absolute/project/.codex/hooks.json", "action": "created" }
  ]
}
```

`action` 为 `created`、`updated` 或 `unchanged`。

Git 项目还会返回 `.git/info/exclude` 变更。该文件只加入 Mira 托管的本机配置路径，不修改项目 `.gitignore`。

## Status

```bash
mira integration status
```

输出每个 Agent 的 Hook 与 MCP 配置状态，不触发写入。

## Uninstall

```bash
mira integration uninstall --agent all
```

只移除 Mira 管理的项目级配置，输出与 install 相同的 change 结构。

## Hook

```bash
mira integration hook --agent codex
mira integration hook --agent claude-code
```

从 stdin 读取 Hook JSON。`SessionStart` 在 stdout 返回 Markdown；捕获事件成功、失败或因 transcript 未变化而跳过时 stdout 均为空。Hook 处理失败默认不阻塞宿主 Agent。
