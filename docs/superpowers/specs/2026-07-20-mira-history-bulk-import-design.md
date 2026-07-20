# Mira 历史会话批量导入设计

日期：2026-07-20
状态：实施中

## 背景

Mira 已能通过 Hook 捕获新会话，也能手工导入单个 Codex/Claude Code transcript，但旧会话仍需逐个定位和导入。历史批量导入补齐“过去记录进入项目记忆层”的入口，同时保持 Mira 的本地优先、项目隔离、可审计和费用可控原则。

## 关键决策

1. **项目范围优先**：扫描全量历史目录，但只导入当前项目或显式旧路径别名的主会话。
2. **明确归属优先**：不猜测路径、不做模糊匹配；缺少 cwd/session ID 的项目跳过并记录原因。
3. **Hook 身份复用**：历史导入和新会话自动捕获必须生成同一 Thread ID。
4. **幂等优先**：用会话身份与 SHA-256 指纹区分首次、更新和未变化。
5. **逐项容错**：稳定排序、顺序读取、每个匹配文件独立事务，避免一个坏文件阻断全批次。
6. **审计最小化**：记录定位和诊断信息，不记录失败 transcript 正文或敏感请求内容。
7. **费用显式**：默认只导入 Thread；`--distill` 也只入队，不同步访问 Provider。

## 数据流

```text
Agent history homes
  -> scanner adapters (path + session id + cwd)
  -> project matcher (current root + explicit aliases)
  -> sequential parser / normalizer
  -> fingerprint + existing state classification
  -> per-item transaction (Thread + cursor + optional job)
  -> audit run/items
  -> stdout summary / atomic JSON report
```

## 安全与隐私

- 符号链接必须解析后仍位于对应 Agent history home 内。
- 非目标项目只读取用于归属判断的最小元数据。
- 审计错误限制为 1000 字符，并通过统一清洗函数移除令牌形态和换行噪声。
- 报告目标使用原子替换，避免留下半份 JSON；临时文件与最终文件位于同一目录。
- 不启动 LLM 网络请求，不导入 Claude subagent。

## 演进空间

当前四层结构允许后续增加其他 Agent scanner、中央只读索引、交互式归属修正或增量流式解析，但这些能力不进入本次交付。
