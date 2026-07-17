# Memory Lifecycle API Contract

```ts
type MemoryStatus = "active" | "superseded" | "archived" | "rejected";
type MemoryEventType = "accepted" | "updated" | "superseded" | "archived" | "rejected" | "restored";

interface UpdateMemoryInput {
  projectId: string;
  memoryId: string;
  content: string;
  title?: string;
  kind?: MemoryKind;
  confidence?: number;
  importance?: number;
  source?: string;
  actor: string;
  reason?: string;
}

interface MemoryHistory {
  memories: Memory[];
  events: MemoryEvent[];
}
```

MCP `update_memory` 使用 `memoryId`、必填 `content`，其余更新字段可选；actor 固定为 `mcp`。`archive_memory` 使用 `memoryId` 和可选 reason。`get_memory`、`get_memory_history` 只需 memoryId。
