# Budget Guards Medium Polish Spec

Feature ID: `012-budget-guards-medium-polish`
Status: Complete

## Scope

Address the six medium-priority findings from `docs/audit-reports/2026-07-13-budget-guards-audit.md`:

- Add a defensive `toFtsQuery` guard for empty OR-term queries.
- Clarify MCP descriptions for `get_context_bundle`, `search_memory`, and `save_thread`.
- Add a single-column `memories(thread_id)` index for cascade/delete paths.
- Add a public regression test for blank `searchMemories` queries.

## Non-Goals

- Low-priority CLI format/range validation.
- Working Memory budget changes.
- MCP parameter surface expansion such as search limit/queryMode.
- Thread deletion redundancy cleanup.
