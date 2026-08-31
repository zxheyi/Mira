# 统一应用入口验收记录

日期：2026-08-31。范围：本轮四项项目记忆优化；不含 thesis 系统、真实历史导入、真实数据库迁移或远端发布。

## 需求与证据

| 项目 | 状态 | 验收依据 |
| --- | --- | --- |
| 重要候选需要审核 | complete | `curationService.test.ts`：constraint / architecture / decision 即使逐字引用、confidence=1 也待审，不进入召回 |
| 确认写入权限及审计 | complete | 公共 curation 接口、CLI、MCP、UI 测试：伪造和跨项目授权被拒绝，默认 MCP 不能确认写入，宿主授权身份进入审计 |
| 批量生命周期归属 | complete | 两种提炼共用 replace_thread；测试覆盖版本链、去重、敏感/非法批次原子拒绝、空结果保护及人工纠正保留 |
| 会话与检查点统一保存 | complete | `sessionCapture.test.ts` 与 `captureAdapters.test.ts`：预览无写入、幂等、事务回滚、过期快照拒绝、Codex/Claude Hook 与历史互操作 |

规格：[记忆管理](spec.md)、[会话采集](../014-phase0-phase1-auto-integration/spec.md)。

## 执行结果

- `npm test`：55 个文件、266 项测试通过，包含 pretest TypeScript 编译。使用 Node v24.11.1 与当前本机 native SQLite 依赖。
- `npm run build`：通过。
- 独立暂存快照 `/private/tmp/mira-capture-staged-ZYjdkL`：同样 55 个文件、266 项测试通过；未包含原有未提交的命名清理。
- 在该快照执行 `scripts/verify-management-ui.mjs`：通过批准/取消/拒绝、纠正/归档/恢复/历史、召回/后台任务/会话/空简报及桌面/窄屏检查，无页面脚本错误。
- 浏览器验收使用独立 Chrome 和合成数据；产物位于 `/var/folders/tc/55rl16fd1ws3kt23f1sjrrc40000gp/T/mira-ui-acceptance-FEZ1h7`。临时目录不是持久备份。
- `git diff --check`、暂存 diff 检查通过。第 2、3 项另有独立暂存快照验证，分别为 258、261 项测试通过。

## 使用和兼容性变化

- 默认 MCP 仍允许读取、保存会话、维护 Working Memory 和提交候选。正式记忆的 add/update/archive/review 需要宿主显式授权；未授权时通过本地 CLI/UI 审核。
- `mira mcp serve --confirmation-policy "approved protocol reference"` 是对该服务的协议授权，不代表每条操作经过人工确认；不要让模型自行修改此启动配置。
- `mira memory audit --limit 50` 查询确认操作的宿主身份、授权依据、操作理由和结果。
- schema 升至 v10。迁移真实数据库前先备份；旧运行时不能读取 v10，降级应恢复兼容备份。
- Hook 不再只根据大小与 mtime 跳过文件读取，而是比较规范化内容；重复 Hook 的读取/解析成本可能增加，未做性能收益声明。
- 源码中只有公共采集模块调用 Thread/检查点写入函数；CLI/MCP/UI 与自动 worker 通过 curation 接口执行正式记忆操作。底层 SQLite 访问不是安全沙箱。

## 未覆盖的外部验收

本轮没有调用真实模型 Provider，没有迁移用户真实数据库，也没有安装或改写真实宿主集成。真实项目持续使用、真实 Provider 和安装后的宿主会话验证仍需另行授权与执行。没有 push。
