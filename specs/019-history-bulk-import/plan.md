# 当前项目历史会话批量导入实施计划

状态：In Progress

## 架构

采用 Scanner Adapter -> Project Matcher -> Bulk Import Service -> SQLite Audit 四层结构：

1. Scanner Adapter 只发现候选文件并读取最小归属元数据。
2. Project Matcher 用规范化绝对路径判断当前根目录与显式旧路径别名。
3. Bulk Import Service 顺序解析匹配文件，计算指纹、分类并在逐文件事务中写入。
4. SQLite Audit 记录正式批次及逐项结果，CLI 和 JSON 报告复用同一结果模型。

## 模块

- `src/history/historyTypes.ts`：Agent、候选、结果、报告和状态类型。
- `src/history/codexHistoryScanner.ts`：Codex sessions/archived_sessions 扫描。
- `src/history/claudeHistoryScanner.ts`：Claude 主会话扫描与边界保护。
- `src/history/projectMatcher.ts`：项目根路径与别名规范化匹配。
- `src/history/historyImportStore.ts`：schema v6 审计读写。
- `src/history/historyImportService.ts`：批量导入编排、幂等分类和逐文件事务。
- `src/history/historyReport.ts`：原子 JSON 报告。
- `src/integrations/threadIdentity.ts`：Hook 与历史导入共享的稳定 Thread ID。

## 数据库

- schema 版本从 v5 升至 v6。
- `history_import_runs` 保存项目、选项、状态、计数、起止时间和批次错误。
- `history_import_items` 保存候选定位信息、指纹、结果、Thread/提炼状态及有限错误信息。
- 外键使用 `on delete cascade`，并为项目、批次、结果和查询路径建立索引。

## TDD 节奏

1. RED/GREEN：共享 Thread identity 和两个 Scanner Adapter。
2. RED/GREEN：项目匹配与 `AnchorMem -> Mira` 别名。
3. RED/GREEN：schema v6 和审计 Store。
4. RED/GREEN：批量服务全部分类、逐项容错、cursor 与 distill。
5. RED/GREEN：CLI、报告、查询与退出码。
6. 文档、真实 dry-run、全量回归和安全审查。

## 实现约束

- 不并发读取大型 transcript。
- 对不匹配项目只读元数据，不读正文。
- dry-run 允许解析和分类，但不打开写事务。
- 错误信息必须清洗、限长，不能复制 transcript 内容。
- 报告写入失败不抹掉已完成的数据库导入结果，但退出码为 `2`。
