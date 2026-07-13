# MCP Agent Polish And Boundary Tests Spec

Feature ID: `007-mcp-agent-polish-and-boundary-tests`
Status: Complete

## Goal

Complete the remaining P2/P3 findings from the third MVP audit report so MCP agent usage is smoother and boundary behavior is guarded by tests.

## Scope

- Document setup prerequisites in Claude Code and Cursor MCP config guides.
- Add optional `kind` filtering to MCP `search_memory`.
- Make MCP `save_thread.id` optional and generate a stable Mira thread id when omitted.
- Add boundary tests for missing distill thread, empty project export, very small context bundles, and remaining deterministic distill heading mappings.

## Non-Goals

- No change to CLI `thread save --id`; this phase only lowers friction for MCP agents.
- No transport-level stdio integration test.
- No MCP connection pooling or WAL mode change.

## Acceptance Criteria

- Agent config docs mention install, build, init, and absolute-path MCP config prerequisites.
- `search_memory` can filter by supported Memory kind and rejects unsupported kinds.
- `save_thread` works without an explicit `id` through MCP and returns a generated `thread_` id.
- P3 boundary scenarios are covered by tests.
- `npm test` and `npm run build` pass.
