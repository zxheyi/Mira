# Mira 基础设施审计报告

审计日期：2026-07-13
代码状态：HEAD f4d9c49（自上次深度审计后未变更）
审计维度：性能与可扩展性、并发与数据完整性、构建发布与依赖就绪度、跨平台可移植性、文档准确性与新用户上手、错误恢复与健壮性

> 本报告覆盖 2026-07-10 深度审计 **未涉及** 的 6 个维度，两份报告互为补充。

---

## 一、性能与可扩展性

### P0 — 必须修复

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 1.1 | **searchMemories 无 LIMIT** | `memoryStore.ts:198-236` | FTS5 查询无 LIMIT，5000+ memory 时搜索常见词返回数千行，全量排序后才到 JS 层 |
| 1.2 | **contextBundle fallback 逐词 N 次 FTS 查询** | `contextBundle.ts:20-26` | 精确匹配失败后 `query.split(/\s+/).flatMap(searchMemories)`，5 词查询 = 5 次全表 FTS 扫描 |

**建议**：searchMemories 加 `LIMIT ?` 参数（默认 50）；fallback 改用 FTS5 原生 `term1 OR term2` 语法合并为单次查询。

### P1 — 尽快修复

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 1.3 | **memories/threads 表缺 project_id 索引** | `schema.ts:41-64` | `listMemoriesForProject`、`clearMemoriesForThread` 等全表扫描 |
| 1.4 | **clearMemoriesForThread N+1 冗余循环** | `memoryStore.ts:164-180` | 逐行 DELETE FTS + 触发器二次空删，双倍开销 |
| 1.5 | **listMemoriesForProject 全量加载只取 top-N** | `memoryStore.ts:186-196` → `contextBundle.ts:32-34` | 加载全部 memory（含 content）只为 `.sort().slice(0, 8)` |

**建议**：
- 添加 `CREATE INDEX idx_memories_project ON memories(project_id)` 和 `idx_memories_project_thread ON memories(project_id, thread_id)`
- `clearMemoriesForThread` 删除手动循环，只保留 `DELETE FROM memories WHERE ...`，依赖已有触发器清理 FTS
- 为 contextBundle 新增带 `ORDER BY importance DESC, confidence DESC LIMIT ?` 的专用查询

### P2 — 建议改进

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 1.6 | listThreadsForProject 加载全部 raw_text | `threadStore.ts:74-84` | 100 thread × 200KB = ~20MB 同步 I/O |
| 1.7 | import 一次性 readFile 大 JSONL | `agentSessionImporter.ts:249-259` | 50MB JSONL 峰值内存 ~200MB（原文 + split + parse + render 四份拷贝） |
| 1.8 | distill 逐条 addMemory 各自独立事务 | `distillThread.ts:158-173` | 50 条 = 50 次 fsync，应包裹外层事务 |

---

## 二、并发与数据完整性

### P0

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 2.1 | **未启用 WAL 模式，busy_timeout = 0** | `db/client.ts:10-12` | 默认 DELETE journal 下写锁排他，MCP serve + CLI 同时写必然 `SQLITE_BUSY` 且不重试 |
| 2.2 | **ensureProjectForRoot select-then-insert 竞态** | `projectStore.ts:65-77` | 两进程同时首次 ensure → 第二个抛 `UNIQUE constraint failed`，未捕获，CLI/MCP 直接报错 |
| 2.3 | **distill clear-then-write 非原子** | `distillThread.ts:170-172`, `llmDistill.ts:163-177` | clear 和 addMemory 各自独立事务：(a) 另一进程在间隙读到空数据；(b) 崩溃后旧 memory 已删、新 memory 只写一半 |

**建议**：
```typescript
// client.ts
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
```
- ensureProjectForRoot 改用 `INSERT OR IGNORE` + 回查
- distill 用单事务包裹 clear + 所有 addMemory（需提取非事务版内部函数）

### P1

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 2.4 | addMemory 竞态 | `memoryStore.ts:122-162` | findDuplicate 在事务外，UNIQUE 异常未捕获 |
| 2.5 | deleteProject FTS 清理与 CASCADE 触发器冗余 | `projectStore.ts:86-91` | 先手动全表扫描删 FTS，CASCADE 触发器再空删一次 |
| 2.6 | setWorkingMemory 多余 SELECT | `workingMemoryStore.ts:49-78` | 并发首次 SET 同 kind 时 id 被意外覆盖（影响有限） |

---

## 三、构建发布与依赖就绪度

### P0

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 3.1 | **无 `prepare` 脚本** | `package.json` | `git clone && npm install` 后 dist/ 不存在，`mira` 命令不可用，必须手动 `npm run build` |
| 3.2 | **无 `engines` 字段** | `package.json` | 用户不知道需要 Node ≥20；better-sqlite3 在非 LTS 版本缺预编译，需本地 C++ 编译环境 |

**建议**：
```json
{
  "prepare": "tsc && chmod +x dist/src/index.js",
  "engines": { "node": ">=20.0.0" }
}
```

### P1

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 3.3 | 缺少 `files` 字段 | `package.json` | npm pack 包含 113 文件（src/*.ts、tests/、docs/ 审计报告），发布时包体积膨胀 3× 且泄露内部文档 |
| 3.4 | tsconfig 编译 tests 到 dist | `tsconfig.json` include | dist/tests/ 被打包进 tarball |

**建议**：添加 `"files": ["dist/src"]`；分离 tsconfig.test.json。

### P2

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 3.5 | dist/src/index.js 缺可执行权限（644） | build 产物 | `npm install -g` 时 npm 自动修复，直接运行 `./dist/src/index.js` 则失败 |

---

## 四、跨平台可移植性

### P1

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 4.1 | **project root 大小写不折叠** | `projectStore.ts:33-35` normalizeRootPath | Windows/macOS（大小写不敏感 FS）下不同大小写路径 → 创建重复 project → 记忆被割裂到两个 project_id |

**建议**：`process.platform === "win32" ? resolve(rootPath).toLowerCase() : resolve(rootPath)`（macOS 可选同样处理）。

### P2

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 4.2 | 导出/bundle 输出硬编码 LF | `exportProject.ts:84,122` 等 `join("\n")` | Windows 老式 Notepad 显示异常（体验问题，非数据损坏） |
| 4.3 | slug() 对非 ASCII 有损 | `agentSessionImporter.ts:64-70` | 中文文件名退化为 `session`（ID 仍唯一，可读性下降） |

### 验证通过项

| 项 | 状态 |
|---|---|
| `.mira/mira.sqlite` 路径构造（path.join） | ✅ 正确 |
| 根目录终止条件（dirname 不动点） | ✅ Windows C:\ 正确 |
| 绝对路径判断（全部委托 resolve） | ✅ 无手写 startsWith("/") |
| 换行符解析（split(/\r?\n/)） | ✅ 导入路径 CRLF 安全 |
| 导出文件名（硬编码，无非法字符风险） | ✅ |

---

## 五、文档准确性与新用户上手

### P0 — 新用户第一步就卡死

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 5.1 | **README 缺 `npm install && npm run build`** | README.md | CLI 快速使用直接从 `mira init` 开始，但 `mira` bin 指向 dist/（未 build 时不存在），新用户第 0 步卡死。构建步骤只藏在 docs/agent-config/ 子文档里 |
| 5.2 | **AGENTS/CLAUDE 模板缺 MCP 工具必填参数** | `docs/agent-config/` | `add_memory` 未说明 `source` 必填；`save_thread` 未说明 `source`+`rawFormat`+`rawText` 必填 → Agent 照模板调用必报错 |

### P1

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 5.3 | README 缺 `thread delete`/`project delete`/`memory clear`/`working clear` 四条销毁命令 | README.md:99-123 | 用户不知道如何清理数据 |
| 5.4 | `--format` 与 `--raw-format` 别名关系未说明 | README.md:110-111 | 文档同时演示两种写法但未说明等价，读者困惑 |
| 5.5 | AGENTS-template `failed_attempt` vs `lesson/constraint` 引导矛盾 | AGENTS-template.md:16 vs :44 | 16 行说"失败记为 lesson 或 constraint"，44 行又列了 `failed_attempt` kind，Agent 不知用哪个 |

### P2

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 5.6 | 全局 `--db`/`--project-root` 须置于子命令前未说明 | README.md | Commander 语义要求全局选项在子命令前，新用户易踩坑 |

### 验证通过项

| 项 | 状态 |
|---|---|
| 7 个 MCP 工具名与代码完全一致 | ✅ |
| 11 个 Memory kind 枚举文档 = 代码 | ✅ |
| 8 个 Working Memory kind 枚举文档 = 代码 | ✅ |

---

## 六、错误恢复与健壮性

### P0 — 静默数据丢失

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 6.1 | **distill 空结果导致静默数据丢失** | `distillThread.ts:170-172`, `llmDistill.ts:163-177` | 先 clearMemoriesForThread 删光旧 memory → distill/LLM 解析出 0 条新 memory → 旧数据永久丢失，无警告 |

**建议**：新 memories 为空时保留旧 memories 或要求用户确认；与 2.3 合并修复——单事务 + 空结果保护。

### P1

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 6.2 | **MCP server 工具 handler 无 try-catch** | `server.ts:253-263` | 任何工具抛错（无效 kind、不存在 thread、Zod 失败）→ 异常传播给 MCP SDK → 可能关闭长运行 server 连接 |
| 6.3 | schema version 不匹配时静默忽略 | `schema.ts:79-89` | 旧版 Mira 打开新版库不报错，读写不理解的 schema 可致数据损坏；新版打开旧版库也无增量迁移 |
| 6.4 | LLM distill JSON 无长度限制 | `llmDistill.ts:138-154` | 有 50 条上限（OK），但单条 content/title 无长度限制，LLM 可返回 100KB 单条写入库 |

### P2

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 6.5 | CLI `memory add` 不校验空 content | `index.ts:236-271` | 空字符串写入 memory + FTS，产生无意义数据。MCP 路径的 `stringArg` 会拒绝空串，但 CLI 路径不经过 |
| 6.6 | confidence/importance 无范围校验 | `index.ts:257-258` | `--confidence 999 --importance -1` 不报错直接写入 |
| 6.7 | 打开非 SQLite 文件错误信息不友好 | `client.ts:10` | `SqliteError: file is not a database` 无修复建议 |
| 6.8 | `save_thread` 空白 rawText 不拒绝 | `threadStore.ts:48-72` | 空白 thread 后续 distill → 触发 6.1 的静默数据丢失 |

---

## 跨维度汇总：优先级矩阵

### P0 — 必须在 MVP 发布前修复（7 项）

| 编号 | 维度 | 问题 | 改动量 |
|------|------|------|--------|
| 2.1 | 并发 | WAL + busy_timeout | 2 行 |
| 6.1/2.3 | 健壮性+并发 | distill 单事务 + 空结果保护 | ~50 行重构 |
| 1.1 | 性能 | searchMemories 加 LIMIT | ~5 行 |
| 1.2 | 性能 | fallback 改 FTS5 OR 语法 | ~10 行 |
| 2.2 | 并发 | ensureProjectForRoot INSERT OR IGNORE | ~15 行 |
| 3.1 | 构建 | package.json 加 prepare 脚本 | 1 行 |
| 5.1 | 文档 | README 补构建步骤 | ~5 行文档 |

### P1 — 发布前应修复（12 项）

| 编号 | 维度 | 问题 |
|------|------|------|
| 1.3 | 性能 | memories/threads 加 project_id 索引 |
| 1.4 | 性能 | clearMemoriesForThread 删除冗余 N+1 循环 |
| 1.5 | 性能 | contextBundle 用 top-N SQL 代替全量加载 |
| 2.4 | 并发 | addMemory 捕获 UNIQUE 异常 |
| 3.2 | 构建 | package.json 加 engines 字段 |
| 3.3 | 构建 | package.json 加 files 字段 |
| 4.1 | 跨平台 | root path 大小写折叠 |
| 5.2 | 文档 | MCP 模板补必填参数 |
| 5.3 | 文档 | README 补销毁类命令 |
| 6.2 | 健壮性 | MCP handler 加 try-catch |
| 6.3 | 健壮性 | schema version 检查 |
| 6.4 | 健壮性 | LLM candidate 单条长度限制 |

### P2 — 可后续改进（11 项）

| 编号 | 维度 | 问题 |
|------|------|------|
| 1.6 | 性能 | listThreadsForProject 不加载 raw_text |
| 1.7 | 性能 | import 流式处理 JSONL |
| 1.8 | 性能 | distill 批量操作外层事务 |
| 2.5 | 并发 | deleteProject FTS 清理冗余 |
| 2.6 | 并发 | setWorkingMemory 多余 SELECT |
| 3.4 | 构建 | tsconfig 分离 tests |
| 4.2 | 跨平台 | 导出换行符 |
| 4.3 | 跨平台 | slug 支持非 ASCII |
| 5.4-5.6 | 文档 | 别名说明、kind 引导、全局选项位置 |
| 6.5-6.8 | 健壮性 | 输入校验（空 content、范围、错误信息） |

---

## 建议修复顺序

**第 1 步**（~10 分钟，解决最大面积问题）：
1. `client.ts` 加 `WAL` + `busy_timeout = 5000`
2. `package.json` 加 `"prepare": "tsc"`、`"engines": {"node": ">=20.0.0"}`

**第 2 步**（~30 分钟，消除数据丢失风险）：
3. distill 重构：单事务包裹 clear + write，空结果时保留旧数据
4. `ensureProjectForRoot` 改 `INSERT OR IGNORE` + 回查
5. `addMemory` 捕获 UNIQUE 异常

**第 3 步**（~20 分钟，性能瓶颈）：
6. `searchMemories` 加 LIMIT 参数
7. contextBundle fallback 改 FTS5 OR 语法
8. 添加 `idx_memories_project` 等索引

**第 4 步**（~15 分钟，文档对齐）：
9. README 补构建步骤 + 销毁命令
10. AGENTS/CLAUDE 模板补 MCP 工具必填参数

**第 5 步**（~20 分钟，健壮性收尾）：
11. MCP handler 加 try-catch
12. schema version 检查
13. LLM candidate 长度限制
