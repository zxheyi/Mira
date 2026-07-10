# Nowledge Mem 逆向分析报告

生成日期：2026-07-10  
分析方式：公开资料黑盒逆向。  
适用对象：Mira 产品设计、MVP 切分、接口设计与后续技术路线。

> 边界声明：本文没有访问 Nowledge Mem 私有源码、二进制内部结构或生产数据库。所谓“逆向”是指基于官网、文档、公开 API、CLI 文档、集成指南和产品行为描述进行黑盒架构还原。凡是无法由公开资料直接确认的内容，都以“推断”标注。

## 0. 结论摘要

Nowledge Mem 的核心不是“保存几条记忆”，而是一套面向 AI 工具的个人知识操作系统。它把本地服务、桌面 UI、CLI、MCP、REST API、Agent 插件、hook、浏览器扩展和后台智能组合成一个闭环：

```text
多入口捕获 -> 标准化对象 -> 检索/图谱/工作记忆 -> Agent 启动上下文 -> Agent 工作 -> 会话捕获/记忆提炼
```

从公开资料逆向看，它至少包含以下关键系统：

```text
1. 本地服务核心：127.0.0.1:14242 REST API
2. 统一知识对象层：Memory、Thread、Source、Working Memory、Space、Entity、Relation
3. 多入口捕获层：Timeline、文件/URL、浏览器扩展、CLI、Agent hook、厂商导出导入
4. 多通道消费层：Desktop、CLI、MCP、REST、Nowledge FS、AI Context
5. 后台智能层：实体/关系提取、连接、矛盾发现、Crystal、每日简报
6. 连接器生态层：Codex、Claude Code、Cursor、Gemini CLI、Copilot CLI 等
```

对 Mira 的核心启发：先做小，但不要做窄。Mira MVP 可以只实现 SQLite + CLI + MCP + Working Memory + Thread/Memory + Context Bundle，但数据模型和接口要按“未来能接入 Agent 工作流”的方向设计。

## 1. 逆向依据

### 1.1 公开事实

公开文档能直接确认：

- Mem 是本地优先的个人知识层。
- 本地服务默认暴露 REST API：`http://127.0.0.1:14242`。
- 桌面应用、MCP tools、CLI 使用同一套服务端 API。
- 支持记忆、对话、资料库、Nowledge FS、知识图谱、Spaces、上下文、AI Now、后台智能。
- 支持多种 AI 工具接入，包括 Codex、Claude Code、Cursor、Gemini CLI、Copilot CLI 等。
- Codex 集成采用插件 + MCP + hook + CLI 的组合方式。
- 记忆类型至少包括：`fact`、`preference`、`decision`、`plan`、`procedure`、`learning`、`context`、`event`。
- Memory API 暴露 importance、confidence、source、space、labels、metadata、temporal fields、source thread/message provenance 等字段。

### 1.2 逆向方法

本文按下面路径还原系统：

```text
产品页面 -> 用户承诺
文档导航 -> 功能模块边界
API Reference -> 数据对象与服务边界
CLI 文档 -> 实际可自动化能力
集成文档 -> Agent 接入方式与真实工作流
上下文/Working Memory 文档 -> Agent 启动上下文模型
知识图谱/后台智能文档 -> 后台处理管线
```

## 2. 系统拓扑逆向

### 2.1 入口层

Nowledge Mem 的入口不是单一 UI，而是一组面向不同角色的入口：

```text
人类用户
  ├─ Desktop App / Timeline
  ├─ Memory / Thread / Library / Graph / Context 页面
  ├─ CLI nmem
  └─ Browser Extension

Agent / 自动化
  ├─ MCP Server
  ├─ REST API
  ├─ Nowledge FS path layer
  ├─ Agent plugin / skill
  └─ lifecycle hook

外部数据
  ├─ AI 聊天导出包
  ├─ 本机编程助手 transcript
  ├─ URL
  ├─ PDF / Word / slides
  └─ 单条 Markdown 对话
```

逆向判断：Nowledge Mem 的产品竞争力很大一部分来自“入口足够多”，而不是某个单点算法。它降低了捕获成本，也让不同 AI 工具能复用同一记忆层。

### 2.2 本地服务层

公开 API 显示 Nowledge Mem 有一个本地 REST 服务，默认端口 `14242`。文档明确说桌面应用和 MCP tools 使用同一套 endpoint。

推断其本地服务大致分层：

```text
HTTP API Router
  ├─ Memory API
  ├─ Thread API
  ├─ Graph API
  ├─ Working Memory API
  ├─ Space API
  ├─ Library / Source API
  ├─ FS API
  └─ Config / Status API

Application Services
  ├─ MemoryService
  ├─ ThreadService
  ├─ IngestionService
  ├─ DistillationService
  ├─ SearchService
  ├─ GraphService
  ├─ ContextService
  ├─ WorkingMemoryService
  ├─ BackgroundJobService
  └─ ExportImportService

Storage / Indexes
  ├─ Primary object store
  ├─ Full-text index
  ├─ Vector index
  ├─ Graph index
  ├─ Activity log
  └─ File/source blob storage
```

### 2.3 Agent 连接层

Codex 集成文档暴露出很关键的架构模式：

```text
插件负责行为引导
MCP 负责工具调用
hook 负责会话自动捕获
CLI 负责兜底命令和配置
项目 AGENTS.md 负责项目级约束
```

这说明 Agent 接入不是单纯注册几个工具。它需要同时解决：

```text
Agent 什么时候读记忆？
Agent 什么时候搜索？
Agent 什么时候保存？
Agent 结束时如何自动捕获真实 transcript？
Agent 如何知道当前项目/空间？
Agent 在无 MCP 时如何降级到 CLI？
```

Mira 如果只做 MCP tools，而没有 AGENTS 指导和 hook，实际可用性会差一截。

## 3. 数据模型逆向

### 3.1 Memory 是核心 Unit

从 API 暴露字段看，Memory 至少承载：

```text
内容：content、title
质量：importance、confidence
分类：unit_type、labels、metadata
来源：source、source_thread_id、source_message_id、source_message_range
空间：space_id
时间：temporal_context、event_start、event_end、recorded date
生命周期：is_latest、version、supersede/deprecate
检索：embedding、pagerank_score、decay_score_cached、last_accessed_at、access_count
图谱：related_entities、related_memory_links、evolves_context
合成：is_crystal、crystal_title、source_unit_count
```

逆向结论：Memory 在 Nowledge Mem 中不是“文本片段”，而是一个有生命周期、有来源、有检索信号、有空间边界、有图谱边的知识单元。

Mira 对应设计：

```text
MVP 必须有：id、project_id、thread_id、kind、content、content_hash、source、importance、confidence、created_at
可以后置：labels、entities、relations、temporal fields、version、access telemetry
```

### 3.2 Thread 是可追溯上下文

Thread 用于保存完整对话和原始讨论历史。Memory 从 Thread 中提炼出来，但不替代 Thread。

推断 Thread 的职责：

```text
保存完整上下文
支持后续重新提炼
作为 Memory provenance
支持按 source 查询，如 codex / cursor / claude-code
支持保存项目/space 归属
```

Mira 的 Thread 不能只当“导入文本缓存”，应该是一等对象。

### 3.3 Working Memory 是 Agent 启动态

Working Memory 不是长期记忆。它更像一张“今天/当前项目/当前 Agent 开始工作前应该知道什么”的状态卡。

Nowledge Mem CLI 支持：

```text
nmem wm
nmem wm --space work
nmem wm --date YYYY-MM-DD
nmem wm history
nmem wm edit
nmem wm patch --heading ...
```

逆向结论：Working Memory 很可能是文档型对象，而不是简单 key-value。它按日期和 space 有版本，可编辑，可局部 patch。

Mira MVP 可先简化成：

```text
project_id + kind + content + updated_at
```

但后续应演化为 Markdown section 模型：

```text
# Working Memory
## Current Task
## Decisions
## Preferences
## Open Questions
## Next Actions
```

### 3.4 Space 是边界控制

Space 在 Nowledge Mem 中用于限定记忆范围、规则和上下文。它既是隔离边界，也是 Agent 上下文选择器。

Mira 第一版的 Project 可以等价于 Space。后续可以扩展：

```text
Project Space：某个 repo
Agent Space：某个长期 Agent 角色
Topic Space：某个研究主题
```

### 3.5 Graph 是增强层，不是 MVP 起点

公开文档中的知识图谱包括实体、关系、记忆连接、版本链、社区聚类和 Crystal。它解决的是“这些知识怎么关联”和“下一步如何探索”。

Mira 不应一开始做完整图谱，但可以提前设计：

```text
relations 表后置
entities 表后置
tags 表后置
Memory.metadata_json 先保留扩展空间
```

## 4. 接口面逆向

### 4.1 REST API

公开 API 暗示 REST 是底座。关键 endpoint 类别：

```text
Memory
  POST /memories
  GET  /memories
  POST /memories/search
  GET  /memories/{id}
  PATCH/PUT /memories/{id}
  DELETE /memories/{id}
  supersede / deprecate / move / export

Graph
  GET /graph/search
  GET /graph/explore
  GET /graph/sample
  GET /graph/expand/{node_id}
```

其中搜索请求支持：

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

Mira MVP 暂不需要 REST server，但 MCP/CLI 内部函数应按 REST 资源思路设计，避免以后拆服务时重写核心模型。

### 4.2 CLI

`nmem` 不是附属工具，而是系统自动化和 Agent 兜底层。它覆盖：

```text
memory search/add
thread save/sync/search
working memory read/edit/patch/history
spaces create/update/show
graph expand/evolves
feed
fs ls/cat/recall/grep
config client/mcp
```

Mira CLI 第一版建议按实际使用路径做：

```text
mira init
mira health
mira project detect/add/list
mira thread save/search
mira memory add/search/distill
mira working read/set/patch
mira context bundle
mira mcp serve
```

### 4.3 MCP

Nowledge Mem MCP 的价值不是替代 CLI，而是让 Agent 在当前推理回合里直接调用检索和写入工具。

推断 MCP 应包含几类工具：

```text
read_working_memory
search_memory
save_memory / create_memory
save_thread
distill_thread
mem_fs ls/cat/recall/grep
get_context / briefing
```

Mira MVP 应至少做：

```text
search_memory
set_working_memory
list_working_memory
get_context_bundle
```

下一阶段加：

```text
save_thread
distill_thread
add_memory
```

## 5. 核心数据流逆向

### 5.1 保存一条手动记忆

```text
用户在 Timeline 输入
  -> 判断是记忆/问题/URL/文件
  -> 如果是记忆：生成 title、unit_type、labels、importance
  -> 写入 Memory
  -> 触发索引：FTS/vector/graph
  -> 后台抽取 entities/relations
```

Mira MVP 对应：

```text
mira memory add
  -> 写 SQLite memories
  -> 写 FTS index
```

### 5.2 导入一次 Agent 会话

```text
Agent/Hook/CLI 找到 transcript
  -> 保存为 Thread
  -> 提炼出 Memory units
  -> Memory 记录 source_thread_id / message range
  -> 写入索引
  -> 后续搜索可回到原始 Thread
```

Mira MVP 对应：

```text
mira thread save --source codex --file transcript.md
mira memory distill --thread <id>
```

### 5.3 Agent 会话启动

```text
Agent 启动
  -> 插件/skill 指导它读取 Working Memory
  -> MCP/CLI 获取当前 Space/Project 的 Working Memory
  -> 按问题搜索相关 Memory/Thread
  -> 组合成 Context
  -> Agent 带着上下文继续工作
```

Mira MVP 对应：

```text
get_context_bundle(projectRoot, maxTokens)
  -> Working Memory first
  -> top memories by relevance/importance
  -> markdown output
```

### 5.4 会话结束

```text
Stop hook 触发
  -> 从 Agent home 读取 transcript
  -> nmem t save --from codex
  -> 写 Thread
  -> 可选 distill
  -> 后台智能继续处理
```

Mira 后续应实现 Codex hook：

```text
Codex stop hook
  -> mira thread save --from codex --project-root <repo>
  -> mira memory distill --latest-thread
```

## 6. 搜索系统逆向

公开 API 显示 Nowledge Mem 搜索至少有两档：

```text
fast: BM25 + vector only
deep: 默认模式，可能叠加实体、关系、metadata、时间和推理支持
```

返回结果不是纯文本，而是：

```text
memory
similarity_score
relevance_reason
related_entities
evolves_context
related_memory_links
```

推断排序信号包括：

```text
文本匹配
向量相似度
importance
confidence
pagerank / graph centrality
decay score
access_count / usage telemetry
space match
temporal filters
```

Mira MVP 可先使用：

```text
FTS score + importance + recency
```

但应避免把接口写死，最好返回：

```ts
SearchResult = {
  memory: Memory;
  score: number;
  reason?: string;
}
```

这样未来可以加入 vector、graph、ranker。

## 7. 后台智能逆向

Nowledge Mem 的后台智能并不只是“定时总结”。公开文档显示它包括：

```text
连接相关想法
发现矛盾
跨时间追踪变化
生成 Crystal / 知识结晶
生成每日简报
实体提取
关系提取
与现有知识连接
社区聚类
```

推断后台任务管线：

```text
New Memory / Thread / Source
  -> classification
  -> label assignment
  -> embedding
  -> entity extraction
  -> relation extraction
  -> link to existing nodes
  -> contradiction/change detection
  -> crystal synthesis
  -> daily/project briefing
```

Mira 的可复刻顺序：

```text
1. deterministic distill
2. content_hash 去重
3. 手动触发 summarize project
4. LLM distill decision/learning/preference
5. daily/project brief
6. entity/relation extraction
7. graph view / fs view
```

## 8. Nowledge FS 逆向

Nowledge FS 是一个很聪明的抽象。它把底层对象映射成 Agent 和脚本都能理解的路径：

```text
/memories
/threads
/wiki
/working-memory
/activities
/sources
/artifacts
```

它的价值：

```text
Agent 可以先 ls/stat，再 cat 大内容
脚本可以稳定引用路径
人类能用知识树浏览同一套对象
MCP 可以暴露 fs 工具而不是无限增加专用 API
```

Mira 后续可以做轻量版本：

```text
mira fs ls /
mira fs cat /memories/<id>.md
mira fs recall "auth decision" --in /memories -k 5
```

这比直接暴露很多表更适合 Agent。

## 9. 安全与隐私逆向

Nowledge Mem 的安全策略从公开描述看主要是：

```text
默认本地数据
远程访问需要 URL + API key
本地工具连接 127.0.0.1
浏览器桥接 local-only
导出为可移植文本包
```

Mira MVP 应采用更窄边界：

```text
只读写本机 SQLite
MCP 只走 stdio
不开放 HTTP 端口
不做远程访问
.mira/ 默认 gitignore
```

等稳定后再考虑：

```text
HTTP API
API key
局域网访问
SSH tunnel
远程 server
```

## 10. 可复制与不可复制部分

### 10.1 Mira 应优先复制

```text
Working Memory first
Thread / Memory 分离
Memory kind 枚举
source/provenance
CLI + MCP 双入口
Context Bundle
Project/Space 隔离
本地优先
Markdown/JSON 可导出
```

### 10.2 Mira 暂不复制

```text
完整桌面 App
知识图谱画布
Crystal
AI Now
浏览器扩展
多设备同步
许可证/账号系统
大型导入器矩阵
```

### 10.3 Mira 应预留接口

```text
metadata_json
confidence
source_thread_id
source_message_range
space/project instructions
tags
relations
activity log
```

## 11. 对 Mira 的实施建议

### MVP 版本

```text
SQLite + FTS5
Project auto detect
Thread save
Memory add/search/distill
Working Memory
Context Bundle
MCP stdio
CLI
.gitignore
Markdown/JSON export
```

### v0.2

```text
Codex hook 自动保存会话
AGENTS.md 项目级引导
LLM distill
memory kind 自动分类
content_hash 去重增强
project briefing
```

### v0.3

```text
Source / Tag / Relation 独立表
FS path layer
import adapter: Codex JSONL / Claude transcript / Cursor export
REST API
```

### v0.4+

```text
Graph retrieval
entity extraction
daily brief
remote access
browser extension
simple UI
```

## 12. 逆向后的 Mira 数据模型建议

```text
projects
  id
  name
  root_path
  instructions
  created_at

threads
  id
  project_id
  source
  title
  raw_format
  raw_text
  started_at
  ended_at
  imported_at

memories
  id
  project_id
  thread_id
  kind
  title
  content
  content_hash
  source
  importance
  confidence
  metadata_json
  created_at
  updated_at

working_memory
  id
  project_id
  kind
  heading
  content
  updated_at

memory_fts
  id
  project_id
  title
  content

schema_version
  version
  applied_at
```

Post-MVP：

```text
tags
memory_tags
sources
entities
relations
activities
artifacts
```

## 13. 风险分析

### 产品风险

如果 Mira 只做“搜索记忆”，会变成一个小型笔记检索工具，和 Nowledge Mem 的核心差距较大。真正差异在 Agent 工作流闭环：启动读上下文、过程中检索、结束保存和提炼。

### 工程风险

过早做图谱、UI、多端同步会拖慢 MVP。Mira 应先验证：一个真实 Codex 项目能否跨会话恢复上下文。

### 数据质量风险

没有去重、provenance 和 kind，记忆库会很快变脏。MVP 一开始就要做 content_hash 和 source/thread 追溯。

### Agent 可用性风险

仅提供 MCP tool 不够。Agent 需要提示规则或 AGENTS.md，知道何时调用工具。Nowledge Mem 的插件/skill 体系说明了这一点。

## 14. 最终判断

Nowledge Mem 的本质是：

```text
个人知识对象系统 + Agent 接入协议 + 本地优先运行时 + 后台知识整理
```

Mira 不需要一开始复制全量系统。最小可行但方向正确的版本是：

```text
个人开发者 Agent 记忆运行时
```

也就是：

```text
让 Codex / Claude Code / Cursor 在同一个项目里共享 Working Memory、长期 Memory 和可追溯 Thread。
```

只要 Mira 第一版能完成下面这个闭环，就已经有真实价值：

```text
保存当前会话 -> 提炼决策/经验 -> 下个会话自动读到 Working Memory 和相关 Memory -> 继续工作后再保存
```

## 参考链接

- Nowledge Mem 官网：https://mem.nowledge.co/zh
- Nowledge Mem 文档：https://mem.nowledge.co/zh/docs
- 从这里开始：https://mem.nowledge.co/zh/docs/start-here
- 快速入门：https://mem.nowledge.co/zh/docs/getting-started
- 记忆：https://mem.nowledge.co/zh/docs/memories
- Nowledge FS：https://mem.nowledge.co/zh/docs/nowledge-fs
- 知识图谱：https://mem.nowledge.co/zh/docs/knowledge-graph
- 上下文：https://mem.nowledge.co/zh/docs/ai-context
- 后台智能：https://mem.nowledge.co/zh/docs/advanced-features
- CLI：https://mem.nowledge.co/zh/docs/cli
- API Reference：https://mem.nowledge.co/docs/api
- Codex 集成：https://mem.nowledge.co/zh/docs/integrations/codex-cli
