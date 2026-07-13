# Hardening Audit Budget And CLI Guards Tasks

Feature ID: `011-hardening-audit-budget-and-cli-guards`
Status: Complete

## Phase 40: Tests First

- [x] Add context bundle warning budget and break-strategy tests.
- [x] Add MCP query max and unsupported tool tests.
- [x] Add CLI invalid memory/working kind tests.
- [x] Add addMemory catch fallback test.

## Phase 41: Implementation

- [x] Apply maxCharacters budget to warnings.
- [x] Change budget loop from continue to break.
- [x] Add MCP get_context_bundle query max and unsupported tool guard.
- [x] Add CLI kind guards.

## Phase 42: Verification

- [x] Run targeted tests.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Update `.agents/progress.md`.
