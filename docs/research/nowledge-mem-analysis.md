# Nowledge Mem 多角度分析

生成日期：2026-07-10  
用途：为 Mira 的 MVP 与后续路线提供竞品/参考架构分析。

> 说明：本文基于 Nowledge Mem 官网和公开文档整理。涉及内部实现的部分均标注为“推断”，不视为 Nowledge Mem 的真实内部代码结构。

## 一句话理解

Nowledge Mem 不是一个普通笔记工具，也不是单一 AI 聊天客户端。它更像一个本地优先的个人知识/记忆层：把记忆、对话、文件、工作记忆、知识图谱和 Agent 接口放到同一套系统里，让不同 AI 工具共享同一份上下文。

它的核心闭环是：

```text
捕获内容 -> 结构化为记忆/线程/来源 -> 搜索与图谱关联 -> 生成上下文 -> 被 AI 工具继续使用 -> 会话再沉淀回来
```

这对 Mira 最有价值的启发是：MVP 不应该只做“记忆搜索”，而应该做“Agent 工作前拿到上下文，工作后自动回写经验”的闭环。

## 公开资料确认的关键事实

- 官网定位是“你的智能体、AI 助手、代码工具，共享一套记忆”，强调换工具后上下文不丢。
- 官方文档称它是“中立的知识层”，用于保存决策、洞察、资料和对话，再让接入工具继续使用。
- 本地优先是核心卖点：默认数据留在自己的设备上；跨设备时通常是一台常开机器运行主 Mem，其他客户端连接它。
- Nowledge Mem 暴露本地 REST API，默认端口是 `14242`。
- 桌面应用、MCP tools、CLI 都使用同一套服务端 API。
- 记忆类型包含 `fact`、`preference`、`decision`、`plan`、`procedure`、`learning`、`context`、`event`。
- 文档明确包含 Working Memory、Spaces、Knowledge Graph、Nowledge FS、后台智能、CLI、API、浏览器扩展、多设备、备份导入导出等模块。

## 产品层架构

```text
用户/Agent 入口
  ├─ Desktop App: Timeline、Memory、Thread、Library、Graph、Context、AI Now
  ├─ CLI: nmem
  ├─ MCP: 给 Codex / Claude Code / Cursor 等 Agent 使用
  ├─ Browser Extension: 捕获网页 AI 对话
  ├─ Native Integrations: Codex、Claude Code、Cursor、Gemini CLI、Copilot CLI 等
  └─ REST API: 供脚本、自动化和自定义连接器调用

本地服务层
  ├─ Local HTTP API: 127.0.0.1:14242
  ├─ Memory Service
  ├─ Thread / Conversation Service
  ├─ Library / Source Ingestion Service
  ├─ Working Memory Service
  ├─ Search / Relevance Service
  ├─ Graph Service
  ├─ Nowledge FS Path Layer
  ├─ Background Intelligence Jobs
  └─ Import / Export / Backup

数据层（公开信息 + 推断）
  ├─ Memories
  ├─ Threads
  ├─ Sources / Library Documents
  ├─ Entities
  ├─ Relations / Edges
  ├─ Labels / Tags
  ├─ Spaces
  ├─ Working Memory
  ├─ Activities / Feed
  ├─ Crystals / Synthesized Summaries
  └─ Embeddings / Search Indexes
```

### 架构判断

Nowledge Mem 的产品不是“一个页面 + 一个向量库”，而是围绕个人知识生命周期设计的一组对象系统。

它至少有四层：

1. **Capture 层**：从 Timeline、URL、文件、AI 对话、浏览器扩展、Agent hook、CLI 导入内容。
2. **Knowledge 层**：把内容拆成 Memory、Thread、Source、Entity、Relation、Label、Space。
3. **Retrieval 层**：通过全文、向量、图谱、标签、时间和空间过滤来找回上下文。
4. **Agent Context 层**：把 Working Memory、规则、空间范围、相关记忆组合成 AI 工具开场上下文。

Mira 的第一版可以只实现 1、2、3、4 的最细骨架，但接口设计要为这四层留位置。

## 功能清单

| 模块 | Nowledge Mem 功能 | 对 Mira 的启发 |
|---|---|---|
| Timeline | 输入记忆、提问、粘贴 URL、拖入文件 | Mira 可先不要 UI，但 CLI 要支持 add / ask / import |
| Memories | 原子化长期记忆，带类型、标签、重要性、置信度、来源 | Mira 必须从一开始有 memory kind 和 provenance |
| Threads | 保存完整对话/会话历史，并可从中提炼记忆 | Mira 的核心对象之一，尤其是 Codex 会话 |
| Working Memory | 今日/当前状态，供 AI 会话启动读取 | Mira 的 P1 核心，不应延后太久 |
| Library | 文件、文档、URL 等资料库 | Mira MVP 可先延后，只保留 Source 抽象 |
| Knowledge Graph | 实体、关系、记忆连接、社区聚类、路径探索 | Mira 可先做轻量 Relation，不必先做图谱 UI |
| Spaces | 按项目/工具/Agent 隔离记忆范围和规则 | Mira 的 Project Space 对应此能力 |
| Context | 预览 AI 开始工作前看到的资料、规则、记忆范围 | Mira 的 context bundle 应对标这个概念 |
| AI Now | 内置个人 AI 助手 | Mira 不必做，先服务外部 coding agents |
| Background Intelligence | 后台连接、矛盾发现、知识结晶、每日简报 | Mira 可先做离线 distill job，后台智能后置 |
| Nowledge FS | 给人/Agent/脚本共用的路径层 | Mira 后续可做 `mira fs ls/cat/recall` |
| CLI | `nmem` 访问记忆、线程、Working Memory、图谱、Feed | Mira CLI 是第一入口，应优先打磨 |
| MCP | 给 Agent 提供搜索、写入、工作记忆、FS 等工具 | Mira 必须有可启动的 stdio MCP server |
| Import | 本机编程会话、厂商导出包、浏览器当前页 | Mira 先支持 Markdown/raw text，再加 Codex JSONL |
| Export/Backup | 文本化可移植快照 | Mira 应尽早支持 Markdown/JSON 导出 |
| Remote Access | 常开主 Mem + 其他客户端连接 | Mira 先 local-only，后续再加远程 |

## 数据模型拆解

### Memory

公开 API 暗示 Memory 不是简单文本，它包含：

```text
id
title
content
importance
confidence
source
space_id
labels
metadata
unit_type
temporal_context
event_start / event_end
source_thread_id / source_message_id
version / is_latest
is_crystal
access_count / last_accessed_at
embedding / relevance signals
```

Mira MVP 建议保留：

```text
id
project_id
thread_id
kind
content
content_hash
importance
confidence
source
created_at
updated_at
```

后续再加：

```text
tags
temporal fields
version chain
review status
access telemetry
```

### Thread

Thread 是原始对话的容器，价值不是替代 Memory，而是保存完整上下文和可追溯来源。

Mira MVP 应设计为：

```text
Thread
  id
  project_id
  source           # codex / claude-code / cursor / manual
  title
  raw_text
  raw_format       # markdown / jsonl / transcript
  started_at
  ended_at
  imported_at
```

关键点：Memory 应能反向链接 Thread 和 message range。这样“这条决策从哪里来”能被审计。

### Working Memory

Working Memory 与长期 Memory 的区别：

- 长期 Memory：长期有效的事实、偏好、决策、经验。
- Working Memory：当前要做什么、最近关注什么、短期上下文是什么。

Nowledge Mem 的 CLI 支持读取、编辑、按 space 读取、按日期归档、patch 某个 heading。Mira MVP 可以简化为：

```text
WorkingMemory
  id
  project_id
  kind            # current_task / recent_decision / preference / note
  content
  updated_at
```

但 context bundle 必须优先输出 Working Memory，因为它对 Agent 恢复状态最有用。

### Space / Project

Nowledge Mem 的 Space 用于限定记忆范围、共享上下文和规则。Mira 可以用 Project 作为第一版 Space：

```text
Project
  id
  name
  root_path
  created_at
```

后续可演化为：

```text
Space
  id
  name
  type          # project / agent / topic
  instructions
  default_rules
```

### Graph / Entity / Relation

Nowledge Mem 的图谱把记忆、实体、知识结晶等放到同一张网络中。公开文档提到实体、关系、记忆连接、版本链、社区聚类和 Crystal。

Mira 不应在 MVP 里复制完整图谱，但应该避免把 schema 写死成“只有 memory 文本”。可以先延后：

```text
Entity        post-MVP
Relation      post-MVP
Tag           post-MVP 或轻量 tags
Source        MVP 保留 source 字段，post-MVP 独立成表
```

## 接口设计拆解

### REST API

Nowledge Mem 的 API 以本地服务为核心，默认：

```text
http://127.0.0.1:14242
```

公开 API 包含：

```text
POST /memories/search
GET  /memories
POST /memories
GET  /graph/search
GET  /graph/explore
GET  /graph/sample
GET  /graph/expand/{node_id}
```

其 Memory Search 支持：

```text
query
limit
include_entities
filter_labels
metadata_filters
mode: deep | fast
space_id
unit_type
event_date_from / event_date_to
temporal_context
recorded_date_from / recorded_date_to
```

Mira 的接口应分两步：

MVP 内部 API / MCP tools：

```text
search_memory(projectRoot, query, limit)
set_working_memory(projectRoot, kind, content)
list_working_memory(projectRoot)
get_context_bundle(projectRoot, limit, maxTokens)
save_thread(projectRoot, source, title, rawText)
distill_thread(threadId)
```

Post-MVP REST API：

```text
POST /memories
POST /memories/search
GET  /threads
POST /threads
POST /threads/{id}/distill
GET  /working-memory
PUT  /working-memory
GET  /context-bundle
```

### CLI

Nowledge Mem 的 `nmem` CLI 覆盖：

- Memory：搜索、添加、读取、编辑。
- Thread：保存、搜索、同步本机 Agent 会话。
- Working Memory：读取、编辑、patch section、历史归档。
- Spaces：创建、更新、展示。
- Graph：展开邻域、查看 evolves 链。
- Feed：查看事件流。
- FS：按路径列出、读取、召回。
- Config：设置本地/远程连接。

Mira MVP CLI 应按日常工作路径排序，而不是按数据表排序：

```text
mira init
mira health
mira project add/list
mira thread save/search
mira memory add/search/distill
mira working set/list
mira context bundle
mira mcp serve
```

后续再加：

```text
mira fs ls/cat/recall
mira feed
mira export/import
mira config
```

### MCP / Agent 接口

Nowledge Mem 对 Codex 的接入不是单纯 MCP：它组合了插件、MCP、skills、hooks 和 CLI。

Codex 文档中的关键机制：

```text
插件：提供行为引导和 skills
MCP：提供检索、写入、FS 等工具
Stop hook：会话结束自动捕获真实 Codex thread
nmem CLI：兜底保存、同步和配置
项目 AGENTS.md：项目级记忆行为引导
```

Mira 可借鉴这个分层，但 MVP 要更窄：

```text
MCP stdio server
  search_memory
  set_working_memory
  list_working_memory
  get_context_bundle

CLI fallback
  mira thread save
  mira memory distill

Agent prompt / AGENTS.md
  会话开始先读 working memory
  涉及历史决策时搜索 memory
  结束前保存 thread 或提炼 memory
```

真正提高可用性的不是“有 MCP 工具”，而是“Agent 知道什么时候该用”。所以 Mira 后续需要项目级 `AGENTS.md` 模板。

## 搜索与相关性设计

Nowledge Mem 的公开信息显示搜索不是单一路径：

- `mode=fast` 类似 BM25 + vector 快速召回。
- `mode=deep` 是默认深度搜索，可能结合元数据、实体、关系和推理支持。
- 支持标签、metadata、space、unit_type、时间字段过滤。
- 返回中可包含 related_entities、evolves_context、related_memory_links。

Mira MVP 可以先做：

```text
SQLite FTS5
+ project_id filter
+ kind filter
+ importance ordering
+ maxTokens context budget
```

但数据结构应提前为这些能力留字段：

```text
kind
importance
confidence
source
created_at
updated_at
content_hash
metadata_json
```

后续升级路径：

```text
FTS -> FTS + embeddings -> hybrid ranker -> graph-aware retrieval -> context planner
```

## 后台智能设计

Nowledge Mem 的后台智能负责：

- 自动建立相关记忆连接。
- 发现矛盾。
- 跨时间聚合同一主题的演变。
- 生成知识结晶 / Crystal。
- 生成每日简报。
- 提取实体、关系、与已有知识的连接。

Mira 的低成本版本：

```text
阶段 1：手动 distill thread
阶段 2：保存 thread 后自动 deterministic distill
阶段 3：后台 job 合并重复 memory
阶段 4：LLM 提炼 decision / learning / preference
阶段 5：生成 daily/project briefing
```

对你个人使用而言，最先有价值的是：

```text
每天/每项目一份 Working Memory + 最近决策摘要
```

而不是完整知识图谱。

## 隐私、部署与同步

Nowledge Mem 的公开模型是：

```text
默认本地优先
一台主 Mem 常开
其他设备、浏览器、手机、远程工作流连接主 Mem
需要远程时通过 URL + API key 配置
备份导出为可移植文本化数据包
```

Mira 的合理路线：

```text
MVP：local-only SQLite
下一步：CLI export/import JSON/Markdown
再下一步：局域网/SSH tunnel 访问
最后：远程 server + API key
```

不要过早做账号系统和同步协议。你自己使用时，`git` + 本地导出 + 手动备份就足够支撑验证。

## Nowledge Mem 对 Mira 的具体借鉴

### 应该直接借鉴

1. **Working Memory 优先**：Agent 会话开始时先读当前状态。
2. **Thread 与 Memory 分离**：Thread 保存原始上下文，Memory 保存长期结论。
3. **Memory kind 枚举**：不要只有 `decision`，至少要有 `preference`、`learning`、`procedure`、`context`。
4. **provenance**：每条 Memory 要知道来自哪个 thread / source。
5. **MCP + CLI 双入口**：MCP 给 Agent，CLI 给人和 hook。
6. **项目级上下文包**：Context Bundle 是 Agent 可用性的核心。
7. **自动会话捕获**：后续要通过 Codex hook 保存真实会话。
8. **本地优先**：先把本机体验做顺，不要先做云。

### 暂时不要复制

1. 完整知识图谱 UI。
2. 多设备同步。
3. AI Now 内置聊天助手。
4. 浏览器自动化桥接。
5. 知识结晶 / Crystal。
6. 多格式厂商导入器大全。
7. 远程许可证和账号系统。

### Mira MVP 应保留的架构余量

即使不做，也要留字段或接口空间：

```text
Memory.metadata_json
Memory.source
Memory.confidence
Thread.raw_format
Project.instructions
WorkingMemory.kind
```

这样后续从“个人开发者记忆”扩展到“更完整个人 AI 记忆层”时不用大迁移。

## 推荐的 Mira 目标架构

```text
Mira CLI
  ├─ project add/detect
  ├─ thread save/search
  ├─ memory add/search/distill
  ├─ working set/list
  ├─ context bundle
  └─ mcp serve

Mira MCP Server
  ├─ search_memory
  ├─ set_working_memory
  ├─ list_working_memory
  └─ get_context_bundle

Mira Core
  ├─ ProjectStore
  ├─ ThreadStore
  ├─ MemoryStore
  ├─ WorkingMemoryStore
  ├─ Distiller
  ├─ SearchService
  └─ ContextBundleBuilder

Mira Data
  ├─ SQLite
  ├─ FTS5
  ├─ schema_version
  └─ Markdown/JSON export
```

## Mira 功能优先级建议

| 优先级 | 功能 | 原因 |
|---|---|---|
| P0 | `.gitignore`、SQLite schema、CLI health/init | 项目基本卫生 |
| P0 | MCP stdio server | 没有它 Agent 无法接入 |
| P0 | context bundle | Agent 开始工作前必须有上下文 |
| P1 | Working Memory | 恢复当前状态最有效 |
| P1 | Thread save | 没有原始会话就无法追溯 |
| P1 | Memory distill/search | 长期记忆核心闭环 |
| P1 | 自动项目探测 | 降低日常使用摩擦 |
| P2 | 去重 / content_hash | 避免重复 distill 污染数据 |
| P2 | Memory kind / confidence / source | 为检索和审计打基础 |
| P2 | Codex hook | 自动捕获真实工作流 |
| P3 | FS path layer | 给 Agent 更自然的浏览方式 |
| P3 | graph relation | 从“找得到”升级到“看得见关联” |
| P3 | export/import | 数据可迁移 |

## 参考资料

- Nowledge Mem 官网：https://mem.nowledge.co/zh
- Nowledge Mem 文档首页：https://mem.nowledge.co/zh/docs
- 从这里开始：https://mem.nowledge.co/zh/docs/start-here
- 快速入门：https://mem.nowledge.co/zh/docs/getting-started
- 导入已有对话：https://mem.nowledge.co/zh/docs/import-existing-conversations
- 记忆：https://mem.nowledge.co/zh/docs/memories
- Nowledge FS：https://mem.nowledge.co/zh/docs/nowledge-fs
- 知识图谱：https://mem.nowledge.co/zh/docs/knowledge-graph
- 上下文：https://mem.nowledge.co/zh/docs/ai-context
- 后台智能：https://mem.nowledge.co/zh/docs/advanced-features
- CLI：https://mem.nowledge.co/zh/docs/cli
- API Reference：https://mem.nowledge.co/docs/api
- Codex 集成：https://mem.nowledge.co/zh/docs/integrations/codex-cli
