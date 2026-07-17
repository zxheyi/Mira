# Phase 5：Markdown Vault 实施计划

状态：Complete

## 设计

采用 Snapshot -> Render -> Stage -> Swap 四段式流水线：

1. 从同一 SQLite 事务读取项目快照，并确保 Project Briefing 已刷新。
2. 将快照纯函数渲染为 `Map<relativePath, markdown>`。
3. 在目标目录同级 staging 中写完全部文件。
4. 通过 backup 交换目标目录；任何失败均恢复旧 Vault。

## 接口

- `readVaultSnapshot(db, project): VaultSnapshot`
- `renderMarkdownVault(snapshot): Map<string, string>`
- `syncMarkdownVault(db, project, outputPath, options?): Promise<VaultSyncResult>`
- CLI：`mira vault sync [--out <path>]`

## 测试节奏

1. RED：快照渲染和确定性测试。
2. GREEN：实现纯渲染器。
3. RED：原子替换及失败恢复测试。
4. GREEN：实现文件系统同步器。
5. RED/GREEN：CLI 端到端测试。
6. 全量回归、构建、差异检查与独立审查。
