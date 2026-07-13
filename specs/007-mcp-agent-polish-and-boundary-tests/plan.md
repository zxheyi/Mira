# MCP Agent Polish And Boundary Tests Plan

Feature ID: `007-mcp-agent-polish-and-boundary-tests`
Status: Implemented

## Implementation Steps

1. Add failing tests for MCP `search_memory.kind` and optional `save_thread.id`.
2. Add failing tests for the P3 boundary scenarios from the audit report.
3. Extend `searchMemories` with an optional `kind` filter while preserving existing callers.
4. Update MCP schemas and handlers for optional search kind and optional thread id.
5. Add setup prerequisites to Claude Code and Cursor config docs.
6. Update progress records and run full verification.

## Compatibility

- Existing MCP and CLI calls remain valid.
- Existing `save_thread.id` still upserts when provided.
- Generated MCP thread ids use the `thread_` prefix for consistency with existing ids.
