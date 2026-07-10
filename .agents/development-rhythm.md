# Mira 开发节奏

这份文件给后续开发 Mira 的 Agent 使用。Mira 的开发采用 **SDD 为主，TDD 为执行约束**。

## 总原则

- SDD 决定做什么、边界是什么、接口是什么。
- TDD 保证每个接口真的可用、可回归、不会悄悄坏。
- MVP 计划是当前事实源：[Mira MVP 实施计划](../docs/superpowers/plans/2026-07-09-mira-mvp.md)。
- 不要在实现中临时扩张产品范围；需要变更边界时，先更新计划再实现。

## 推荐节奏

1. 读 README、MVP 计划、AGENTS 模板和本文件。
2. 从 MVP 计划中选一个最小阶段或任务，不跨阶段顺手扩张。
3. 先把该任务的验收点翻译成测试。
4. 先写失败测试，再写最小实现。
5. 每完成一个 store、CLI 命令或 MCP 工具，运行对应测试。
6. 阶段结束时运行更高层验证，例如集成测试、build、CLI smoke。
7. 如果产生稳定决策、踩坑或下一步，回写到 Mira Memory / Working Memory。
8. 提交前确认 diff 只包含当前任务相关内容。

## SDD 使用场景

优先用 SDD 处理这些问题：

- 数据模型：Project、Thread、Memory、Working Memory、SearchResult。
- 接口契约：CLI 参数、MCP tool 输入输出、导出格式。
- 项目边界：MVP 做什么、暂不做什么、post-MVP 放什么。
- 交付门槛：每个阶段需要哪些测试、命令或人工验证。
- 架构决策：每项目一个 MCP server、项目自动创建策略、数据库路径策略。

SDD 产物写在计划或文档中；不要把口头假设直接写进代码。

## TDD 使用场景

优先用 TDD 推进这些模块：

- `projectRoot.test.ts`：自动探测 Git 项目根目录。
- `projectStore.test.ts`：创建、自动创建、列表、名称更新。
- `schema.test.ts`：表、字段、FTS、schema version。
- `threadStore.test.ts`：保存 thread、更新 thread、raw_format。
- `memoryStore.test.ts`：add、去重、title/content 搜索、SearchResult score。
- `workingMemoryStore.test.ts`：set、list、clear。
- `distill.test.ts`：前缀规则、Markdown heading 规则、clear-before-write。
- `contextBundle.test.ts`：Working Memory 优先、limit、maxTokens。
- `exporter.test.ts`：Markdown / JSON 导出。
- `mcp/tools.integration.test.ts`：MCP 工具层读写闭环。
- `integration/localLoop.test.ts`：Project -> Thread -> Memory -> Search -> Working Memory -> Bundle -> Export。

## 每个任务的完成标准

一个任务只有同时满足这些条件才算完成：

- 相关测试已添加或更新。
- 对应测试通过。
- 如果影响 CLI，至少有 smoke 验证。
- 如果影响 MCP，至少有工具层测试。
- 如果改变接口或边界，README / MVP 计划 / AGENTS 模板已同步。
- 没有把 `.mira/`、构建产物、依赖目录或临时导出误提交。

## Agent 回写习惯

开发 Mira 时，Agent 应该使用 Mira 自己的目标工作流：

- 开始任务前读取 context bundle。
- 需要历史决策时 search memory。
- 做出稳定决策后 add memory。
- 当前任务、阻塞和下一步变化后 set / clear working memory。
- 会话结束前 save thread，保存本轮摘要，而不是假装拥有完整 transcript。

## 简短口诀

```text
先 SDD 定边界，再 TDD 写接口；
小步测试，小步提交；
阶段结束跑闭环，重要经验回写 Mira。
```
