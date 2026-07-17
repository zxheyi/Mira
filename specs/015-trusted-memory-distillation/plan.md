# Phase 2 可信自动记忆提炼实施计划

状态：完成

> 按 SDD + TDD 执行：每个行为先写最小失败测试并确认 RED，再实现到 GREEN；每完成一项同步更新 `tasks.md`，Phase 2 验收完成后独立提交。

## 架构

核心链路分为五层：

1. schema v3 持久化 `distill_jobs` 与 `memory_candidates`。
2. `candidateService` 统一 Agent/Provider 候选校验、策略判断、接受和拒绝。
3. `distillJobStore` 与一次性 `distillWorker` 管理幂等入队、领取、完成和重试。
4. `openAiCompatibleProvider` 只负责请求/解析，不能自行写 Memory。
5. Hook、CLI 和 MCP 只做输入适配，全部复用 Core Service。

## 文件映射

- `src/db/schema.ts`：schema v3、升级顺序、表和索引。
- `src/memory/memoryTypes.ts`：复用并导出 Memory kind 运行时枚举。
- `src/distill/candidateTypes.ts`：候选、审核原因、任务类型。
- `src/distill/candidatePolicy.ts`：字段、证据、敏感信息、风险、重复与冲突判断。
- `src/distill/candidateStore.ts`：候选持久化、列表、状态转换。
- `src/distill/candidateService.ts`：提交、自动接受、人工审核事务。
- `src/distill/distillJobStore.ts`：入队、领取、完成、失败、重试。
- `src/distill/openAiCompatibleProvider.ts`：环境配置、Prompt、HTTP 和结构化解析。
- `src/distill/distillWorker.ts`：运行一个 pending job。
- `src/integrations/hookRuntime.ts`：捕获成功后的可选异步入队回调。
- `src/index.ts`：distill jobs / memory candidate CLI 与 detached worker 启动。
- `src/mcp/server.ts`：三个候选 MCP 工具。
- `tests/db/schema.test.ts`：v2 -> v3 与 fresh schema。
- `tests/distill/*.test.ts`：策略、Store、Service、Provider、Worker。
- `tests/integrations/hookRuntime.test.ts`：Hook 入队与不阻塞行为。
- `tests/mcp/server.test.ts`：新 MCP 工具契约与 Core 一致性。
- `tests/cli/trusted-distill-cli.test.ts`：CLI 端到端。
- `README.md`、`docs/agent-config/automatic-integration.md`、`.agents/progress.md`：用户文档与进度。

## 任务 1：Schema v3 与类型

1. 在 schema 测试中创建 v2 fixture，断言迁移后两张新表、索引、版本号和旧数据仍存在；运行测试确认因缺表失败。
2. 在 `schema.ts` 增加 v3 迁移，业务 DDL 完成后才更新版本号；运行定向测试到 GREEN。
3. 添加候选和任务类型，复用统一 Memory kind 枚举；运行 `npm run build` 捕获类型边界。

## 任务 2：候选策略与事务服务

1. 添加策略测试：有效证据、缺失证据、敏感信息、阈值、低/高风险 kind、重复和同标题冲突；确认 RED。
2. 实现纯函数字段归一化、证据定位、敏感模式与自动接受决策；定向测试 GREEN。
3. 添加 Store/Service 测试：自动接受、待审、重复提交、手工接受/拒绝、重复审核和追溯；确认 RED。
4. 实现候选 Store 与事务 Service。接受路径调用现有 `addMemory`，Memory source 写入候选 ID；定向测试 GREEN。

## 任务 3：任务队列与 Provider

1. 添加 Job Store 测试：相同输入幂等、不同正文新任务、领取、完成、失败和重试；确认 RED。
2. 实现 Job Store，并限制错误文本长度、清除常见 Authorization/Bearer token；定向测试 GREEN。
3. 添加 Provider 测试：请求 URL/headers/body、无 key、本地 fenced JSON、非法响应、HTTP 错误；确认 RED。
4. 实现可注入 fetch 的 Provider 与严格解析；定向测试 GREEN。
5. 添加 Worker 测试：成功提交候选并完成任务、Provider 失败标记 failed、无任务返回 idle；确认 RED。
6. 实现 run-once Worker，确保 Provider 结果只能通过 Candidate Service 落库；定向测试 GREEN。

## 任务 4：Hook 异步接入

1. 在 Hook 测试中断言：捕获成功后调用入队；未变化/失败/未配置时不调用；回调异常不阻塞 Stop；确认 RED。
2. 给 Hook Runtime 注入可选 `enqueueDistill`，仅在 Thread 成功保存后调用；定向测试 GREEN。
3. 在 CLI Hook 接线中按环境配置启用 Provider，入队后 detached 启动 `distill jobs run --once`，不继承 stdio。
4. 添加 spawned Hook 测试，验证 Hook 在慢 Provider 前返回，Worker 可后续处理任务。

## 任务 5：CLI 与 MCP

1. 添加 CLI 失败测试，覆盖 jobs enqueue/list/run/retry 与 candidate list/review 的 JSON 输出和参数拒绝。
2. 实现 CLI 命令并复用 Store/Service；运行 CLI 测试到 GREEN。
3. 添加 MCP 失败测试，覆盖提交、列表、审核以及 limit/enum/长度验证。
4. 注册三个 MCP 工具并接入统一 Service；运行 MCP 测试到 GREEN。

## 任务 6：文档、审查与提交

1. 更新 README 自动提炼章节、环境变量、CLI/MCP 示例和隐私边界。
2. 更新自动集成指南、`.agents/progress.md` 与 Obsidian Phase 2 进度记录。
3. 运行 Phase 2 定向测试、完整 `npm test`、`npm run build`、`git diff --check`。
4. 审查迁移原子性、敏感信息持久化路径、Hook 延迟、任务幂等和所有枚举入口。
5. 确认 `tasks.md` 全部完成、worktree 只有 Phase 2 改动，提交：`feat: add trusted automatic memory distillation`。

## 验证命令

```bash
npm test -- tests/db tests/distill tests/integrations/hookRuntime.test.ts tests/mcp/server.test.ts tests/cli/trusted-distill-cli.test.ts
npm test
npm run build
git diff --check
git status --short
```
