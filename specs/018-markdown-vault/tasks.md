# Phase 5：Markdown Vault 任务

- [x] 5.1 锁定单向物化、确定性和原子替换契约
- [x] 5.2 为快照读取与 Markdown 渲染编写 RED 测试
- [x] 5.3 实现全生命周期快照、frontmatter 与 WikiLink 渲染
- [x] 5.4 为 staging/backup 交换和失败恢复编写 RED 测试
- [x] 5.5 实现文件系统同步器与路径安全编码
- [x] 5.6 增加 `mira vault sync [--out]` 及 CLI 测试
- [x] 5.7 更新 README、Agent 进度与 Obsidian 实施记录
- [x] 5.8 运行全量验证和静态安全审查
- [x] 5.9 独立提交 Phase 5

## 验证证据

- RED：Vault Core 与 CLI 不存在。
- RED：随机 ID 顺序断言暴露测试假设，前驱 WikiLink 只显示 ID 暴露可读性缺口。
- RED：受保护输出目录未拦截。
- RED：回滚不完整时 `finally` 可能覆盖原始错误并删除 backup。
- GREEN：确定性渲染、完整生命周期、WikiLink、路径编码、原子替换、成功重建、失败恢复和 backup 留存测试通过。
- 全量：37 个测试文件、193 项测试通过；TypeScript 构建与 `git diff --check` 通过。
