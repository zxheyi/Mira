# 当前项目历史会话批量导入任务

- [x] 19.1 锁定 SDD 规格、架构、CLI 与 JSON 报告契约
- [ ] 19.2 抽取共享稳定 Thread ID，并实现 Codex Scanner Adapter
- [ ] 19.3 实现 Claude Code Scanner Adapter 与 subagent/符号链接边界
- [ ] 19.4 实现规范化项目匹配与显式旧路径别名
- [ ] 19.5 实现 schema v6 迁移和 History Audit Store
- [ ] 19.6 实现批量导入服务、幂等分类、逐项事务和 cursor 同步
- [ ] 19.7 实现可选 distill 入队、原子 JSON 报告和失败清洗
- [ ] 19.8 实现 `history import/runs/failures` CLI 与退出码
- [ ] 19.9 更新 README、自动接入文档、Agent Context、进度与 Obsidian 记录
- [ ] 19.10 执行真实本机 dry-run、全量验证和静态安全审查
- [ ] 19.11 独立提交实现并合入本地 main（不 push）

## 验证证据

- 基线：37 个测试文件、193 项测试在沙箱外通过。
