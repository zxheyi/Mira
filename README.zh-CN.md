# Mira

**面向编程 Agent 的本地优先项目记忆，支持证据约束型研究。**

[English](README.md) | **简体中文**

Mira 让项目决策、编码约定、失败尝试和下一步动作跨 Agent 会话延续。它在本地保存原始会话与长期记忆，为新会话生成有长度预算的 Markdown 上下文。独立的研究层记录证据、主张和审核，不修改投资论点（thesis）、仓位或交易状态。

## Mira 能做什么

- **跨会话继续工作。** Working Memory 保存当前目标、阻塞点和下一步，长期 Memory 保存决策与经验。
- **连接编程 Agent。** Codex 和 Claude Code 支持自动安装 Hook/MCP；Cursor 可通过 MCP 接入。
- **找回项目历史。** 导入 Codex 和 Claude Code 会话，预览批量导入、查看失败记录，重复导入时识别未变化的会话。
- **审计记忆来源。** 从 Memory 回溯原始 Thread，审核候选，保留纠正和归档历史。
- **按预算检索上下文。** SQLite FTS5 搜索、项目简报、上下文预算与召回凭据帮助核查哪些内容被选中或省略。
- **浏览本地数据。** 使用 CLI、本地 Viewer、Markdown/JSON 导出，或可在 Obsidian 中打开的 Markdown Vault。
- **独立审核研究。** Research Case 记录证据、主张及其支持/反驳关系、核验、审核与来源失效状态。

Mira 仍在持续开发，不提供云同步、多用户账号、托管 Web 应用或交易执行。

## 快速开始

### 1. 从源码构建

需要 **Node.js 24 或更高版本**、npm 和 Git。当前软件包标记为 private，请使用源码仓库，不要假设 npm 上已有发布版本。

```bash
git clone https://github.com/zxheyi/Mira.git
cd Mira
npm install
npm run build
node dist/src/index.js --help
```

如需直接使用 `mira` 命令，将它链接到 PATH：

```bash
npm link
```

也可以把下文中的 `mira` 替换成 `node /absolute/path/to/Mira/dist/src/index.js`。开发源码时，在 Mira 仓库中使用 `npm run dev -- <command>`；操作其他项目时需传入 `--project-root`。

### 2. 在目标项目中建立记忆

进入你希望 Mira 记住的项目，执行：

```bash
cd /absolute/path/to/your-project
mira init
mira doctor
mira working set --kind current_task --content "准备下一个版本"
mira memory add --title "测试约定" --kind convention --content "发起拉取请求前运行相关测试。" --source manual
mira memory search "测试"
mira context bundle --max-tokens 1000
```

`init` 创建项目记录和本地数据库。搜索会返回刚保存的约定，上下文包包含当前工作状态和选中的记忆。这条最小闭环不需要配置模型服务。

### 3. 浏览记忆

```bash
mira ui
```

打开命令输出的 URL，默认是 `http://127.0.0.1:4317`。Viewer 目前使用中文界面，支持记忆浏览、候选审核、研究案例和诊断；仅绑定本机回环地址。

## 接入 Agent

### Codex 与 Claude Code

先预览项目配置变更，再安装：

```bash
mira --project-root /absolute/path/to/your-project integration install --agent all --dry-run
mira --project-root /absolute/path/to/your-project integration install --agent all
mira --project-root /absolute/path/to/your-project integration status
```

将 `all` 换成 `codex` 或 `claude-code` 可只配置一个 Agent。Hook 在会话开始时注入上下文，在停止或结束时捕获主会话 transcript；未变化的 transcript 会跳过。原生 Hook 工作在**会话粒度**，安装后不代表每次提问前都会自动召回。宿主仍可能要求信任确认。

卸载时仅移除 Mira 管理的配置项：

```bash
mira --project-root /absolute/path/to/your-project integration uninstall --agent all
```

配置文件位置和排障步骤见[自动接入指南](docs/agent-config/automatic-integration.md)。

### Cursor 与其他 stdio MCP 客户端

每个项目配置一个服务，路径使用绝对路径。支持 `mcpServers` 配置的客户端可参考：

```json
{
  "mcpServers": {
    "mira": {
      "command": "node",
      "args": [
        "/absolute/path/to/Mira/dist/src/index.js",
        "--project-root", "/absolute/path/to/your-project",
        "--db", "/absolute/path/to/your-project/.mira/mira.sqlite",
        "mcp", "serve", "--profile", "core"
      ]
    }
  }
}
```

`core` 提供常用记忆工作流工具，`research` 增加研究工具，`admin` 和 `full` 提供完整工具集。**Profile 只选择工具，不授予权限。** 受治理的写操作需要显式宿主确认策略和允许的权限范围，默认服务不授予这些权限。委托写操作前，请阅读[工作流指南](docs/implementation/workflow-guide.md)和[权限边界](docs/implementation/trust-hardening.md)。

常用工具包括 `before_turn`、`after_turn`、`prepare_context`、`search_memory`、`set_working_memory`、`save_thread` 和 `submit_memory_candidates`。在已连接会话中调用 `get_runtime_status` 可查看项目绑定与权限。另见 [Cursor 配置示例](docs/agent-config/cursor.md)和 [Agent 行为模板](docs/agent-config/AGENTS-template.md)。

## 日常工作流

在目标项目中执行命令，或在子命令前添加 `--project-root /absolute/path/to/project`。完整选项可通过 `mira <command> --help` 查看。

| 任务 | 命令 |
| --- | --- |
| 检查配置与诊断信息 | `mira status` / `mira doctor` |
| 保存下一步 | `mira working set --kind next_step --content "审核接口变更"` |
| 隔离并行任务状态 | `mira --task api-review working list` |
| 读取项目简报 | `mira briefing show` |
| 生成上下文及召回凭据 | `mira context prepare --query "接口" --max-tokens 1000` |
| 查看召回历史 | `mira context recalls` |
| 查看待审核候选 | `mira memory candidate list --status pending_review` |
| 归档过时记忆 | `mira memory archive --id memory_123 --reason "已不再适用"` |
| 检查后台处理进度 | `mira workflow` / `mira distill jobs list` |
| 生成 Markdown Vault | `mira vault sync` |
| 导出项目数据 | `mira export --format json --out ./export` |

请将示例 ID 换成 Mira 返回的实际 ID。纠正 Memory 会创建后继版本，保留历史。归档使记忆退出默认检索；永久删除使用独立命令，必须显式传入 `--confirm-hard-delete`。

### 导入已有会话

先预览一个受限批次，再正式导入：

```bash
mira history import --dry-run --max-file-size 20 --limit 20
mira history import --max-file-size 20 --limit 20 --report ./history-import.json
mira history runs --limit 20
mira history failures --limit 20
```

批量导入扫描当前项目的本机 Codex 和 Claude Code 历史。旧工作目录可通过 `--root-alias /old/project/path` 指定；`--since YYYY-MM-DD` / `--until YYYY-MM-DD` 按文件修改日期过滤。单文件导入也支持 Markdown 和 Codex/Claude Code JSONL transcript：

```bash
mira import --source codex --format jsonl --path /path/to/session.jsonl
```

导入会保存 Thread，不会直接把每段对话变成长期 Memory。可选的 `--distill` 为新增或更新的 Thread 入队模型提炼任务。部分文件导入失败时，命令返回退出码 `2`，并保留审计汇总。

### 可选：模型辅助提炼

如需启用 OpenAI-compatible Provider，在运行 Mira 的环境中设置：

```bash
export MIRA_LLM_BASE_URL="https://provider.example/v1"
export MIRA_LLM_MODEL="model-name"
export MIRA_LLM_API_KEY="your-provider-key"
```

以上均为占位值。模型提炼会把已保存的 Thread 内容发送到配置的服务，敏感模式过滤不能保证识别所有隐私内容。不配置 Provider 时，本地捕获、搜索、上下文生成和 Agent 候选提交仍可使用。

自动接受采用保守规则：低风险候选还需满足高置信度、可归属的用户证据、逐字支持，且未检测到密钥、重复或冲突。高影响内容或推论需要审核。置信度由提炼器自报，不是真实性证明。详见[记忆治理说明](docs/implementation/trust-hardening.md)。

## 研究案例

研究使用独立链路：**Research Case → Evidence → Claim → Review**。研究上下文仅纳入符合条件、审核通过且由当前有效、已核验证据支持的主张。结构核验检查来源/快照绑定与摘录完整性，不证明证据在语义上足以支持结论。证据失效和主张修订均保留审计记录。

```bash
mira research list
mira research show --case research_case_123
mira research context --case research_case_123
mira research export --case research_case_123 --out ./research-case.md
```

可从[投资研究技能](skills/mira-investment-research/SKILL.md)、[Apple 示例](examples/research/apple-fy2024-pilot.json)和[多案例来源笔记](docs/research/official-multi-case-source-notes.md)开始。该技能提交记忆候选与研究提案，不执行交易，也不修改投资组合或投资论点。

## 存储与项目作用域

| 概念 | 用途 |
| --- | --- |
| Thread | 保存的原始会话或手动摘要 |
| Memory | 带来源和生命周期历史的长期项目知识 |
| Working Memory | 当前任务、阻塞点、决策和下一步 |
| Project Briefing | 根据存储状态生成、可重建的项目简报 |
| Context Bundle | 为 Agent 会话选出的有长度预算的 Markdown |
| Markdown Vault | 自动生成的浏览视图，SQLite 仍是真实数据源 |
| Research Case | 按项目和截至日期隔离的证据与主张审核 |

数据库默认位于 `<project>/.mira/mira.sqlite`。Git linked worktree 默认共享主仓库数据库，并使用工作区范围的工作状态；`--task <id>` 选择显式任务作用域。`--db` 可覆盖默认数据库路径。独立 clone 不会因为远程 URL 相同而自动合并。

Vault 默认输出到 `.mira/vault/`，手动编辑不会回写数据库，下次同步时会被覆盖。迁移或移动数据库前请先备份。旧路径别名和显式绑定见[项目身份与任务作用域规格](specs/022-project-identity-and-task-scope/spec.md)。

## 开发与文档

```bash
npm run build
npm test
npm run benchmark:recall
```

其他验证命令包括 `npm run verify:trust`、`npm run verify:research-pilot` 和 `npm run verify:multi-case-research`。各项验证覆盖范围不同，已有结果与限制见[信任边界验证记录](docs/implementation/trust-validation.md)。

- [常用工作流与恢复](docs/implementation/workflow-guide.md)
- [上下文信任与召回审计](docs/implementation/context-trust.md)
- [权限、语义审核与迁移边界](docs/implementation/trust-hardening.md)
- [MVP 规格](specs/001-mira-mvp/spec.md)
- [实现规格目录](specs/)
- [英文 README](README.md)

贡献请使用主题分支，通过审核后的 PR 合入 `main`，不要直接向 `main` 提交或推送。详见 [AGENTS.md](AGENTS.md)。修改安装步骤或用户可见行为时，请同步更新两版 README；配套文档保留原有语言。
