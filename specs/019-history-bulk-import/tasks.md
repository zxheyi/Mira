# 当前项目历史会话批量导入任务

- [x] 19.1 锁定 SDD 规格、架构、CLI 与 JSON 报告契约
- [x] 19.2 抽取共享稳定 Thread ID，并实现 Codex Scanner Adapter
- [x] 19.3 实现 Claude Code Scanner Adapter 与 subagent/符号链接边界
- [x] 19.4 实现规范化项目匹配与显式旧路径别名
- [x] 19.5 实现 schema v6 迁移和 History Audit Store
- [x] 19.6 实现批量导入服务、幂等分类、逐项事务和 cursor 同步
- [x] 19.7 实现可选 distill 入队、原子 JSON 报告和失败清洗
- [x] 19.8 实现 `history import/runs/failures` CLI 与退出码
- [x] 19.9 更新 README、自动接入文档、Agent Context、进度与 Obsidian 记录
- [x] 19.10 执行真实本机 dry-run、全量验证和静态安全审查
- [x] 19.11 独立提交实现并合入本地 main（不 push）

## 验证证据

- 基线：37 个测试文件、193 项测试在沙箱外通过。
- Scanner/Identity GREEN：4 个测试文件、15 项测试通过。
- Schema/Audit GREEN：2 个测试文件、13 项测试通过。
- Bulk Service GREEN：4 个测试文件、17 项测试通过。
- CLI/Report GREEN：3 项测试通过；首次 dry-run 与 LLM CLI 回归通过。
- 真实 dry-run：扫描 487 项，18 imported、1 updated、468 skipped、0 failed；旧 AnchorMem 匹配 18 项，Claude subagent 路径 0 项。
- 无写校验：真实 `.mira/mira.sqlite` 的 SHA-256、mtime 与大小在 dry-run 前后完全一致。
- 全量：44 个测试文件、212 项测试通过；`npm run build` 与 `git diff --check` 通过。
- 独立规格审查 Agent 两次运行均未返回结果并已关闭；未将其计为通过证据，改由人工静态安全与数据完整性审查收口。
