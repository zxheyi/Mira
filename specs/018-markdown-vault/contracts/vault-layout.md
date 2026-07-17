# Markdown Vault 契约

## 固定布局

```text
<out>/
  index.md
  project-briefing.md
  working-memory.md
  memories/<encoded-memory-id>.md
  threads/<encoded-thread-id>.md
  reviews/pending-candidates.md
```

## 确定性

- 相同 SQLite 状态必须产生相同相对路径、字节内容和排序。
- 不包含同步时间、staging 名称或本机绝对路径。
- 换行固定为 LF，文本文件以换行结尾。

## 安全与一致性

- 数据库 ID 必须编码为安全文件名，任何 ID 都不能制造绝对路径或 `..` 跳转。
- frontmatter 字符串使用 JSON/YAML 兼容引用，避免换行和特殊字符注入。
- SQLite 是唯一写入源，Vault 中的手动编辑会在下一次完整同步时被覆盖。
- 替换失败时，调用前存在的目标 Vault 必须原样保留。
