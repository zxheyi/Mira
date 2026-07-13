# Hardening Audit Budget And CLI Guards Spec

Feature ID: `011-hardening-audit-budget-and-cli-guards`
Status: Complete

## Scope

Address the high-priority findings from `docs/audit-reports/2026-07-13-hardening-audit.md`:

- Warning memories must respect `maxCharacters` budgets.
- Budgeted memory insertion stops at the first entry that would exceed the budget.
- MCP `get_context_bundle.query` has the same maximum query length as `search_memory.query`.
- Unknown MCP tool names fail explicitly instead of returning `undefined`.
- CLI `memory add --kind` and `working set/clear --kind` reject unsupported kind values before writing.
- The `addMemory` catch fallback path is covered by a regression test.

## Non-Goals

- Rebalancing warning vs regular memory pools.
- Changing `maxCharacters` minimum semantics.
- Reworking CLI numeric validation beyond kind guards.
- Addressing medium/low findings from the hardening audit.
