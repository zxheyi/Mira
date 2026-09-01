---
name: mira-investment-research
description: Use for investment research in Mira when claims or thesis implications must stay traceable to evidence and pass review; excludes general coding-memory tasks and trade execution.
---

# Mira Investment Research

产出证据约束的研究审核包。Mira 提供项目记忆、任务上下文、候选与审计能力；投资 thesis 仍由领域审核协议持有。

## 运行流程

1. 建立作用域。为本次研究使用稳定 `taskId`，调用 `prepare_context` 获取相关上下文；需要历史约束时调用 `search_memory`。把召回内容视为线索，重新核验其来源后才能作为本次证据。
2. 建立证据账本。优先收集有日期、可定位的一手来源，为每条证据分配 `E<n>`，记录来源位置、发布时间或观察时点、支持与反驳内容、适用范围和缺口。
3. 建立主张矩阵。为每条主张分配 `C<n>`，绑定支持证据和反证，写明时间边界、失效条件、状态与置信度。置信度只表达判断，不替代证据。
4. 形成审核包。输出核心结论、证据账本、主张矩阵、反证、未决问题和 thesis 影响建议。生成前读取 [研究协议](references/research-protocol.md)。
5. 持久化。临时假设与下一步写入 task-scoped Working Memory；稳定方法或来源事实通过 `submit_memory_candidates` 提交 candidate。投资结论保留在审核包中，经过领域审核后再由外部 thesis 协议处理。持久化前读取 [运行配置](references/runtime-profile.yaml)。
6. 收口。更新当前状态、阻塞和下一步。Hook 可用时由 Hook 捕获会话；Hook 不可用时才使用 `save_thread` 保存可审查的来源摘要或关键原文。

Mira 工具不可用时仍完成研究审核包，把 recall、capture 和 persistence 标为 `NOT_RUN`；保持现有安装与权限不变。

## 完成标准

- 每个重要主张至少有一个精确证据引用，或明确标为 unsupported。
- 反证、来源冲突、时效和失效条件均可见。
- thesis 影响是待审核建议，不是已执行状态变更。
- 没有通过模型自报置信度获得确认写权限。
