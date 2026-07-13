# Post-Fix Audit Hardening Spec

Feature ID: `010-post-fix-audit-hardening`
Status: Complete

## Scope

Address the high-priority findings from `docs/audit-reports/2026-07-13-post-fix-audit.md`:

- Align thread deletion semantics so schema and `deleteThread` both delete thread-scoped memories.
- Harden MCP input boundaries for numeric ranges, maximum string sizes, and raw format enum values.
- Remove the legacy MCP `thread` alias in favor of `threadId` only.
- Make `search_memory` and `get_context_bundle` descriptions distinct and return-shape oriented.
- Add missing tests for OR-term search, duplicate-write fallback, registered handler error wrapping, and direct schema cascade behavior.

## Non-Goals

- Reworking context bundle warning allocation and budget strategy.
- Streaming JSONL imports.
- Full schema migration framework for already-created v1 databases.
- Changing CLI `thread save` raw format behavior beyond existing validation paths.
