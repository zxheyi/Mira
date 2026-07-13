# Low Priority Audit Cleanup Spec

Feature ID: `013-low-priority-audit-cleanup`
Status: Complete

## Scope

Close the remaining low-priority audit findings that do not conflict with prior high-priority safety decisions:

- Tighten context bundle budget edge cases and include Working Memory in budget handling.
- Add CLI enum/range guards for thread format and context bundle numeric options.
- Clarify MCP low-priority descriptions and add coverage for no-query top-N and maxCharacters paths.
- Make thread rawFormat a union type.
- Remove redundant `deleteThread` memory clearing and rely on cascade semantics.
- Add memory FTS insert/update triggers so direct SQL writes and future updates stay searchable.
- Add regression tests for database-open errors, addMemory rethrow, distill rollback, and missing project export errors.

## Explicit Non-Goal

Do not change the high-priority empty-distill protection: when distill produces zero memories, existing memories are preserved to prevent silent data loss.
