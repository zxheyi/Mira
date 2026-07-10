# Rowboat 项目文档总结

生成日期：2026-07-10  
来源仓库：https://github.com/rowboatlabs/rowboat  
用途：为 Mira 设计个人开发者 Agent 记忆中枢时，参考 Rowboat 的产品、架构、模块和技术路线。

> 说明：本文基于 Rowboat GitHub README、公开源码目录、配置文件和项目内文档整理。没有完整克隆运行项目，因此对部分内部数据模型和运行细节会标注为“推断”。

## 1. 一句话定位

Rowboat 是一个开源的桌面 AI coworker。它不是单纯聊天应用，也不是只做记忆检索的工具，而是把本地知识图谱、AI 工作界面、后台 Agent、浏览器、邮件、会议记录、代码 Agent 和工具集成放在一起，形成一个“AI 可以真正参与工作”的桌面工作台。

Rowboat README 对它的核心描述可以概括为：

```text
桌面 AI coworker + 工作记忆 + 内置工作表面 + 本地 Markdown 知识库
```

它的产品重心是：

```text
把邮件、会议、Slack、AI 对话等工作内容索引到可检查的知识图谱里，再让 AI 基于这些长期上下文去处理邮件、会议、网页、代码和自动化任务。
```

## 2. 核心产品能力

| 模块 | Rowboat 能力 | 对 Mira 的启发 |
|---|---|---|
| Brain / Knowledge Graph | 把 email、meeting、Slack、assistant conversations 索引成 Obsidian 风格的双链知识图谱 | Mira 可借鉴“Markdown vault + 可编辑知识”理念，但 MVP 不必先做图谱 UI |
| Email | 内置邮件客户端，自动区分重要邮件，并用工作上下文草拟回复 | Mira 可延后，先聚焦 coding agent 记忆 |
| Background Agents | 支持按事件或定时运行的后台 Agent，可连接工具、搜索 Web、操作浏览器、写代码 | Mira 的 post-MVP 可做定时 distill / project briefing |
| Built-in Browser | 隔离浏览器，用户只登录希望 AI 访问的账号，与 AI 协作完成网页任务 | Mira 暂不复制，安全边界复杂 |
| Meeting Notes | 本地会议记录器，采集麦克风和扬声器，生成实时 transcript、Markdown 总结并更新知识图谱 | Mira 可借鉴“原始 transcript -> Markdown -> 记忆提炼”路径 |
| Code Mode | 启动并协调 Claude Code / Codex 等并行编码 Agent，必要时注入工作上下文 | Mira 最相关：让不同 coding agents 共享项目上下文 |
| Apps / Work Surfaces | 允许用户在 Rowboat 内构建自己的工作界面，共享工具和集成 | Mira 可后置为插件/面板体系 |
| Integrations | 一键连接常见产品和 MCP / Composio 工具 | Mira 可先支持 MCP stdio + Codex/Claude/Cursor |
| Local-first Markdown | 数据在本机以 Markdown 保存，用户可检查、编辑、备份、删除 | Mira 应强烈借鉴 |
| BYO Model | 支持本地模型和托管模型，数据留在本地 Markdown vault | Mira 可先 BYO OpenAI-compatible，后续支持 Ollama |

## 3. 与 Nowledge Mem 的差异

Nowledge Mem 更像“跨 AI 工具的个人知识/记忆层”；Rowboat 更像“带记忆的 AI 工作台”。

```text
Nowledge Mem:
  重点是中立记忆层、跨工具接入、长期知识对象、API/CLI/MCP。

Rowboat:
  重点是桌面 coworker、内置工作表面、后台 Agent、浏览器/邮件/会议/代码等具体工作入口。
```

对 Mira 来说：

```text
Nowledge Mem 更适合参考数据模型和 Agent 记忆接口。
Rowboat 更适合参考本地 Markdown vault、工作台、后台 Agent、Code Mode 和事件驱动机制。
```

## 4. 仓库结构

公开仓库是 monorepo，大致结构：

```text
rowboat/
  apps/
    x/                 # Electron 桌面应用，新架构重点
    rowboat/           # Next.js web dashboard / demo app
    rowboatx/          # Next.js frontend，可能是另一版前端
    cli/               # CLI tool
    python-sdk/        # Python SDK
    docs/              # 文档站点
  assets/
  docker-compose.yml
  Dockerfile.qdrant
  google-setup.md
  CLAUDE.md
  README.md
```

`CLAUDE.md` 明确指出当前重点是 `apps/x` Electron app，它本身又是一个嵌套 pnpm workspace：

```text
apps/x/
  apps/
    main/              # Electron main process
    renderer/          # React + Vite UI
    preload/           # Electron preload scripts
  packages/
    shared/            # 类型、校验、IPC schema、共享定义
    core/              # 业务逻辑、AI、OAuth、MCP、知识、Agent runtime
```

构建顺序：

```text
shared -> core -> preload
renderer 与 main 再依赖这些包
```

## 5. 技术栈

### 桌面端 `apps/x`

| 层 | 技术 |
|---|---|
| Desktop Shell | Electron 39 |
| Renderer | React 19 + Vite 7 |
| Styling / UI | TailwindCSS、Radix UI、Lucide |
| Editor | TipTap / ProseMirror / CodeMirror |
| AI | Vercel AI SDK、OpenAI、Anthropic、Google、OpenRouter、Ollama、models.dev catalog |
| Agent Protocol | ACP：Claude Agent ACP、Codex ACP |
| Tool Protocol | MCP SDK |
| IPC | Electron contextBridge + typed IPC schemas |
| Build | TypeScript 5.9、esbuild、Electron Forge |
| Packaging | Electron Forge makers：DMG、deb、rpm、squirrel、zip |

### Web / 服务端 `apps/rowboat`

| 层 | 技术 |
|---|---|
| Web | Next.js 15 + React 19 |
| Database | MongoDB |
| Queue / Cache | Redis |
| Vector DB | Qdrant |
| RAG | Qdrant + embeddings + uploads worker |
| Object storage | local uploads 或 S3 |
| Auth | Auth0 可选 |
| Tools | Composio、MCP、Firecrawl、Google APIs |
| Agent | OpenAI Agents SDK、Vercel AI SDK |

## 6. 运行时架构

### 6.1 Electron 版架构

```text
Electron main process
  ├─ app lifecycle / window / protocol / permissions
  ├─ IPC handlers
  ├─ workspace watcher
  ├─ runs watcher
  ├─ services watcher
  ├─ live-note scheduler
  ├─ background-task scheduler
  ├─ event processor
  ├─ Gmail / Calendar / Fireflies / Granola sync
  ├─ knowledge graph builder
  ├─ email labeling
  ├─ note tagging
  ├─ inline task processor
  ├─ agent schedule runner
  ├─ browser control service
  ├─ local sites server
  └─ renderer window

Renderer process
  ├─ React app
  ├─ Markdown / rich editor
  ├─ browser / notes / code / settings / panels
  ├─ Live Note panel
  ├─ background task UI
  └─ typed IPC client

Core package
  ├─ workspace filesystem
  ├─ knowledge services
  ├─ events
  ├─ runs / sessions / turns
  ├─ MCP
  ├─ models
  ├─ auth / OAuth
  ├─ scheduling
  ├─ search
  ├─ code mode
  └─ integrations
```

Electron main 的启动流程显示 Rowboat 是“多后台服务一起启动”的桌面运行时，而不是普通静态 UI：Gmail、Calendar、Fireflies、Granola 同步，图谱构建，邮件标注，笔记标签，inline tasks，agent notes，calendar notification，Chrome extension sync，local sites server 等都会在 app ready 后初始化。

### 6.2 Web / Docker 架构

`docker-compose.yml` 暗示 Rowboat web 服务版本包含：

```text
rowboat            # Next.js web app / API
jobs-worker        # 后台任务 worker
rag-worker         # RAG 文件解析与索引 worker
mongo              # 主数据库
redis              # 队列/缓存
qdrant             # 向量数据库
setup_qdrant       # 初始化向量集合
delete_qdrant      # 删除向量集合
```

可选/实验服务还包括：

```text
rowboat_agents
copilot
tools_webhook
simulation_runner
chat_widget
twilio_handler
docs
```

这说明 Rowboat 同时保留了桌面本地优先方向和 Web/RAG/worker 方向。Mira 第一版不应复制这么重的服务栈。

## 7. Core 模块拆解

`apps/x/packages/core/src` 目录能反映业务边界：

```text
account
agent-schedule
agents
analytics
application
apps
auth
background-tasks
billing
channels
code-mode
composio
config
di
events
filesystem
knowledge
mcp
migrations
models
pre_built
runs
schedule
search
security
services
sessions
slack
turns
voice
workspace
```

逆向解读：

- `knowledge` 是本地 Markdown vault、同步、图谱、标签、live notes 等知识处理核心。
- `runs`、`turns`、`sessions` 构成 Agent 运行时和会话记录层。
- `agent-schedule`、`background-tasks` 负责后台 Agent 调度。
- `mcp`、`composio`、`slack`、`auth`、`models` 是工具和外部服务接入层。
- `code-mode` 是与 Claude Code / Codex 等编码 Agent 协作的关键模块。
- `workspace`、`filesystem` 是本地文件系统抽象。
- `application` 更偏 Copilot / assistant 上层能力。

## 8. Shared 模块拆解

`apps/x/packages/shared/src` 主要放跨 main/renderer/core 共享的类型和 schema，例如：

```text
agent.ts
agent-schedule.ts
background-task.ts
browser-control.ts
code-mode.ts
code-sessions.ts
events.ts
frontmatter.ts
ipc.ts
live-note.ts
mcp.ts
models.ts
runs.ts
sessions.ts
turns.ts
workspace.ts
```

这说明 Rowboat 非常依赖“共享类型契约”来保持 Electron IPC、UI 和 core 之间一致。对 Mira 来说，如果后续有 CLI + MCP + UI，也应该尽早建立 `shared` 或 `schema` 层。

## 9. 知识系统设计

Rowboat 的知识系统有几个关键特点：

### 9.1 本地 Markdown vault

README 强调数据在本机以 plain Markdown 保存，用户可检查、编辑、备份、删除。这是 Rowboat 与纯数据库型记忆系统最大的差异。

```text
优点：
- 人类可读
- 容易备份
- 可用 Git 管理
- 可被普通编辑器修改
- 不被服务端格式锁定

代价：
- 并发写入要处理锁
- metadata/frontmatter 要小心维护
- 搜索/图谱需要额外索引
```

Mira 可以借鉴：SQLite 做索引与状态，Markdown/JSON 做可审计导出。长期可演化为“Markdown vault + SQLite index”。

### 9.2 Obsidian 风格双链图谱

Rowboat 把工作内容索引到类似 Obsidian 的双链知识图谱。README 强调关系是显式、可检查的，笔记是用户可编辑的。

对 Mira 的启发：

```text
先保证 memory 可追溯、可编辑、可导出。
图谱不是第一天要做的 UI，但 relation/source/provenance 要从第一天保留。
```

### 9.3 Live Notes

Live Notes 是 Rowboat 很有代表性的设计：一个 Markdown note 通过 frontmatter 的 `live:` block 变成自更新 artifact。

核心模型：

```yaml
live:
  objective: |
    这个 note 应持续维护什么目标
  active: true
  triggers:
    cronExpr: "0 * * * *"
    windows:
      - startTime: "09:00"
        endTime: "12:00"
    eventMatchCriteria: "Emails about Q3 planning"
  lastAttemptAt: ...
  lastRunAt: ...
  lastRunId: ...
  lastRunSummary: ...
  lastRunError: ...
```

运行机制：

```text
scheduler 每 15 秒扫描 knowledge/*.md
  -> 找到 live.active 的 note
  -> 判断 cron/window 是否到期
  -> 触发 live-note-agent

event processor 每 5 秒处理 events/pending/*.json
  -> LLM Pass 1 路由：找可能相关的 live notes
  -> live-note-agent Pass 2 决策：是否真的编辑
  -> agent 用 file-readText / file-editText patch note body
  -> runtime 更新 lastRun* 字段
```

关键工程原则：

```text
renderer 不直接写 live frontmatter
backend 是 live block 单写者
agent 只拥有 H1 下方 body
file lock 防并发写
per-note running guard 防重复运行
event FIFO 保序
失败不覆盖最后成功状态
```

对 Mira 的启发非常大：Mira 后续的“project briefing / working memory 自动更新”可以采用类似模型：一个 Markdown 工作记忆文档 + objective + trigger + runtime fields。

## 10. Agent 与后台任务

Rowboat 的后台 Agent 分两类：

```text
事件触发：新邮件、日历同步、其他外部事件
定时触发：每天 8 点、cron/window
```

它们可以：

```text
连接工具
搜索 Web
使用内置浏览器
调用 Claude Code / Codex 写代码
更新 Markdown artifact
写入知识图谱
```

对 Mira 来说，最小可复制版本是：

```text
mira background summarize --project-root . --daily
mira memory distill --latest-thread
mira context refresh
```

不需要一开始做通用后台 Agent 平台，但可以保留 `jobs` 和 `events` 概念。

## 11. Code Mode 分析

Rowboat 的 Code Mode 目标是启动并协调 Claude Code 或 Codex 等编码 Agent，并在需要时提供 Rowboat 的工作上下文。

从依赖和 README 可以看出：

```text
@agentclientprotocol/claude-agent-acp
@agentclientprotocol/codex-acp
node-pty
code-mode 模块
code-sessions shared types
```

推断 Code Mode 可能具备：

```text
启动本地终端/pty
驱动 Codex 或 Claude Code
管理多个并行 coding sessions
把 Rowboat 的 knowledge context 注入 coding agent
记录 code session 结果
在 UI 中展示会话状态
```

这与 Mira 的目标高度相关。Mira 的差异是：Mira 不做完整工作台，只做跨 coding agent 的记忆层。所以 Mira 可以先从“提供上下文”开始，而不是“托管 Agent 运行”。

## 12. 浏览器与安全边界

Rowboat 内置独立浏览器，README 强调它与主浏览器隔离，用户只登录希望 assistant 访问的账号。

这背后的安全设计是：

```text
不要让 AI 直接操作用户主浏览器
创建隔离 profile / partition
只授权需要的账户
通过 Electron BrowserView / session 控制权限
```

Mira 暂不应做浏览器控制，因为这会把安全边界、cookie、登录态、权限提示都带进来。若未来需要，应独立成插件或外部工具。

## 13. 集成与工具

Rowboat 支持：

```text
Google: Gmail / Calendar / Drive
Slack
Fireflies
Granola
Composio tools
MCP servers
Exa web search
ElevenLabs voice
Deepgram voice input
Claude Code / Codex
Ollama / LM Studio / hosted providers
```

配置方式大量使用本地 `~/.rowboat/config/*.json`：

```text
models.json
deepgram.json
elevenlabs.json
exa-search.json
composio.json
```

对 Mira 的启发：

```text
本地配置文件比一开始做账号系统简单得多。
MVP 可以用 ~/.mira/config.json 保存 provider / model / db path / agent settings。
```

## 14. 数据与基础设施

Rowboat 的 web/RAG 版本使用：

```text
MongoDB: 主数据
Redis: 队列/缓存
Qdrant: 向量搜索
uploads volume: 文件上传
S3: 可选文件存储
workers: jobs-worker / rag-worker
```

Electron 本地版强调 Markdown vault，但 core 里仍有 filesystem、knowledge、search、runs、turns 等模块，说明本地版更像“文件系统 + 索引 + Agent runtime”。

Mira MVP 应避免 Mongo/Redis/Qdrant 重栈：

```text
SQLite + FTS5
本地 Markdown/JSON 导出
后续再加 vector index
```

## 15. 对 Mira 的借鉴

### 15.1 应直接借鉴

```text
1. 本地优先 + 可读 Markdown
2. 明确 workspace / project root
3. Agent run / session / turn 的分层概念
4. 后台任务和事件驱动模型
5. Live Notes 的 frontmatter + runtime fields 设计
6. 单写者原则，避免 UI 和 Agent 抢写同一块 metadata
7. Code Mode 连接 Codex / Claude Code 的方向
8. MCP 作为外部工具扩展层
9. BYO model，不绑定单一云服务
10. 用户可检查、可编辑、可备份的记忆
```

### 15.2 暂不复制

```text
1. 邮件客户端
2. 内置浏览器
3. 会议录音和实时转写
4. 多 Agent 工作台 UI
5. Composio / Slack / Google 全量集成
6. Web dashboard + Mongo/Redis/Qdrant 重架构
7. Apps/work surfaces 平台
8. 语音输入输出
```

### 15.3 Mira 可复刻的最小子集

```text
Mira = Rowboat 的 knowledge memory 子集 + Nowledge Mem 的 Agent memory 接口子集

具体是：
- Project root / workspace
- Thread / Session / Turn
- Memory
- Working Memory
- Context Bundle
- Markdown export
- CLI
- MCP stdio
- Codex/Claude/Cursor 接入说明
```

## 16. Mira 路线建议

### v0.1：记忆闭环

```text
mira init
mira thread save
mira memory distill
mira memory search
mira working set/list
mira context bundle
mira mcp serve
```

### v0.2：Agent 自动化

```text
Codex hook
Claude Code hook / script
AGENTS.md 模板
自动项目探测
会话结束自动保存
重复 distill 去重
```

### v0.3：Markdown vault

```text
.mira/db.sqlite
.mira/export/memories/*.md
.mira/export/threads/*.md
working-memory.md
project-briefing.md
```

### v0.4：Live Memory

借鉴 Rowboat Live Notes：

```yaml
live_memory:
  objective: |
    持续维护这个项目当前状态、近期决策、下一步行动。
  active: true
  triggers:
    onThreadSaved: true
    cronExpr: "0 9 * * *"
  lastRunAt: ...
  lastRunSummary: ...
```

用于自动维护：

```text
Project Working Memory
Project Briefing
Recent Decisions
Open Questions
```

## 17. 风险与取舍

### 风险 1：范围膨胀

Rowboat 是完整 AI coworker 工作台。如果 Mira 追着它复制，会很快陷入邮件、浏览器、会议、语音、Apps、worker、OAuth 等重功能。

Mira 应只取：

```text
开发者 Agent 记忆 + 项目上下文恢复
```

### 风险 2：只做数据库，不做人类可读层

Rowboat 很强调 plain Markdown。Mira 如果只用 SQLite，会短期快，但长期可能缺少可审计性。建议：SQLite 做索引，Markdown/JSON 做导出和人工审计。

### 风险 3：只做 MCP，不做行为引导

Rowboat 的 Code Mode 和 Nowledge Mem 的 Codex 集成都说明：Agent 接入需要工具 + 行为规则 + hook。Mira 后续必须提供 AGENTS.md / CLAUDE.md / Cursor rules 模板。

### 风险 4：过早做图谱

Rowboat 的图谱很吸引人，但 MVP 最大价值不是图，而是跨会话连续性。Mira 应先让“下次 Agent 继续干活”成立。

## 18. 总结

Rowboat 对 Mira 的最大参考价值不在 UI，而在三个架构思想：

```text
1. 记忆必须是用户可检查、可编辑、可备份的本地资产。
2. AI coworker 需要工作表面、上下文、工具和后台任务协同，而不是孤立聊天框。
3. 长期上下文应该随着工作流持续生长，而不是每次临时 RAG 一下。
```

Mira 的更窄定位可以是：

```text
面向开发者 Agent 的 Rowboat memory core。
```

也就是先不做完整 coworker，而是把 Rowboat 的“长期本地记忆 + Agent 工作上下文”抽出来，专门服务 Codex、Claude Code、Cursor、OpenClaw 这类 coding agent。

## 参考链接

- Rowboat GitHub：https://github.com/rowboatlabs/rowboat
- Rowboat README：https://github.com/rowboatlabs/rowboat#readme
- Rowboat Docker Compose：https://raw.githubusercontent.com/rowboatlabs/rowboat/main/docker-compose.yml
- Rowboat env example：https://raw.githubusercontent.com/rowboatlabs/rowboat/main/.env.example
- Rowboat Google setup：https://raw.githubusercontent.com/rowboatlabs/rowboat/main/google-setup.md
- Rowboat CLAUDE.md：https://raw.githubusercontent.com/rowboatlabs/rowboat/main/CLAUDE.md
- Rowboat Electron app package：https://raw.githubusercontent.com/rowboatlabs/rowboat/main/apps/x/package.json
- Rowboat core package：https://raw.githubusercontent.com/rowboatlabs/rowboat/main/apps/x/packages/core/package.json
- Rowboat renderer package：https://raw.githubusercontent.com/rowboatlabs/rowboat/main/apps/x/apps/renderer/package.json
- Rowboat Live Notes doc：https://raw.githubusercontent.com/rowboatlabs/rowboat/main/apps/x/LIVE_NOTE.md
