# Phase 0/1 Auto Integration Spec

Feature ID: `014-phase0-phase1-auto-integration`
Status: Complete

## 目标

完成 Mira 后续进化计划中的 Phase 0 工程基线收口和 Phase 1 自动会话闭环，让 Codex 与 Claude Code 在项目内经过一次安装后能够：

1. 会话开始时自动读取 Mira Context Bundle。
2. 会话停止或结束时自动把真实 transcript 保存为稳定的 Mira Thread。
3. 在会话中通过项目级 MCP Server 搜索和写入 Mira Memory。
4. 重复触发、恢复会话和重复安装时保持幂等，不覆盖用户已有配置。

## 范围

### Phase 0

- SQLite 连接启用 `recursive_triggers`。
- 删除 Thread 或 Project 后，级联删除的 Memory 必须同时从 `memory_fts` 清除。
- `searchMemories` 默认使用关键词 OR 查询。
- MCP `search_memory` 支持显式 `queryMode: "orTerms" | "phrase"`，默认 `orTerms`。
- 审计报告列出的 Phase 0 行为必须有回归测试。

### Phase 1

- 新增 `mira integration install --agent codex|claude-code|all`。
- 新增 `mira integration uninstall --agent codex|claude-code|all`。
- 新增 `mira integration status`。
- 新增内部 Hook 命令 `mira integration hook --agent codex|claude-code`，从 stdin 读取官方 Hook JSON。
- `SessionStart` 输出当前项目 Context Bundle，作为额外 Agent 上下文。
- Codex `Stop` 自动导入 `transcript_path`。
- Claude Code `Stop` 增量导入，`SessionEnd` 执行最终同步。
- 使用 `<agent>:<session_id>` 派生稳定 Thread ID；同一会话重复同步时更新同一 Thread。
- 使用 schema v2 `integration_cursors` 持久化 transcript 路径、大小和修改时间；未变化时跳过，失败时不推进检查点。
- 只处理 Hook `cwd` 属于安装项目根目录的事件。
- 缺失 transcript、文件尚未生成、空 transcript 或不支持的事件应非阻塞退出，并写入本地集成日志。
- 支持 `--dry-run` 预览将创建或修改的文件，不产生写入。

## 项目级安装产物

### Codex

- `.codex/hooks.json`：安装 Mira 的 `SessionStart` 与 `Stop` command hook。
- `.codex/config.toml`：在带 Mira 标记的托管块中注册项目级 `mcp_servers.mira`。

### Claude Code

- `.claude/settings.local.json`：合并 Mira 的 `SessionStart`、`Stop`、`SessionEnd` command hook。
- `.mcp.json`：合并 `mcpServers.mira` stdio Server。

Mira 只能增删自己创建且带唯一命令标识的 Hook；不得删除或重写用户已有 Hook、MCP Server 或其他配置。若已存在非 Mira 管理的同名 `mira` MCP 配置，安装必须报冲突并保持文件不变。

## Hook 命令契约

安装器写入绝对 Node executable 和当前 Mira CLI entry path，不依赖 GUI/IDE 的 `PATH`。命令通过 `--project-root` 与 `--db` 绑定项目：

```text
<node> <mira-entry> --project-root <root> --db <root>/.mira/mira.sqlite integration hook --agent <agent>
```

Hook 进程必须满足：

- stdin 只读取一个 JSON object。
- Context Bundle 写 stdout；诊断信息不得混入 stdout。
- 捕获 Hook 默认返回成功，不能因为 Mira 故障阻塞 Agent 结束会话。
- 可诊断错误追加到 `.mira/integrations.log`，不包含 transcript 正文。

## Thread 映射

```text
id        = thread_<agent-slug>_<session-id-slug>
source    = codex | claude-code
rawFormat = jsonl
rawText   = 现有 importer 规范化后的 Markdown
```

主会话 transcript 才进入 Phase 1；Claude Code `subagents/` transcript 和 Codex 子 Agent transcript 不做目录扫描。Hook 明确传入的主 `transcript_path` 是唯一捕获来源。

## 配置合并与卸载

- JSON 配置使用解析后的对象合并，保留未知字段。
- Hook 数组只按 Mira 命令标识去重。
- Codex TOML 使用 `# >>> mira managed` / `# <<< mira managed` 标记块；重复安装替换该块。
- 卸载只移除 Mira Hook、Mira MCP 项和 Mira 托管块。
- 若卸载后 JSON 容器为空，可保留合法空对象，不删除用户文件。
- 所有配置写入采用同目录临时文件后 rename 的原子替换。
- Git 项目通过 `.git/info/exclude` 的 Mira 托管块忽略本机绝对路径配置；安装和卸载按 Agent 增删对应规则，并保留用户原有内容。

## 隐私与安全

- 不扫描浏览器数据、凭证文件或私有数据库。
- 不把 transcript 内容写入日志。
- 默认只读取官方 Hook 提供的 `transcript_path`。
- transcript 路径必须位于 Codex home 或 Claude config directory 的会话目录；测试可通过显式允许根目录注入。
- Project Hook 和 MCP 首次使用时遵循 Codex / Claude Code 官方信任提示，不绕过信任机制。

## 非目标

- 不实现后台常驻 watcher。
- 不安装全局用户 Hook。
- 不自动调用外部 LLM。
- 不自动修改长期 Memory 或 Working Memory；自动可信提炼属于 Phase 2。
- 不支持 Cursor、WorkBuddy 或其他 Agent。
- 不绕过 Codex / Claude Code 的 Hook 与 MCP 信任确认。

## 验收标准

1. Thread/Project 级联删除后，FTS 表无孤儿记录。
2. 多关键词搜索默认可匹配非连续关键词，`phrase` 模式仍可显式使用。
3. 安装 Codex 集成会生成可解析的 Hook 与 MCP 配置，并保留既有配置。
4. 安装 Claude Code 集成会生成可解析的 Hook 与 MCP 配置，并保留既有配置。
5. 重复安装结果不重复，卸载只移除 Mira 管理内容。
6. `SessionStart` Hook 返回有预算限制的 Markdown Context Bundle。
7. Codex Stop 与 Claude Stop/SessionEnd 可把测试 transcript 保存到同一个稳定 Thread。
8. 缺失或不允许的 transcript 路径不阻塞 Agent，且日志不包含正文。
9. 未变化 transcript 不重复导入；失败导入不推进检查点，文件修复后可重试。
10. Git 本地排除规则保留用户内容，安装幂等且可按 Agent 卸载。
11. CLI 集成测试覆盖 install -> hook start -> hook stop -> Thread 更新 -> uninstall。
12. `npm test`、`npm run build` 和真实项目 dry-run 通过。
