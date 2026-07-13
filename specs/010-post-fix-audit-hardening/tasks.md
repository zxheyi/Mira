# Post-Fix Audit Hardening Tasks

Feature ID: `010-post-fix-audit-hardening`
Status: Complete

## Phase 37: Tests First

- [x] Add schema cascade test for direct thread deletion.
- [x] Add MCP boundary and handler error tests.
- [x] Add search OR-term and duplicate fallback tests.

## Phase 38: Implementation

- [x] Change thread foreign key semantics to cascade.
- [x] Harden MCP schemas and direct tool validation.
- [x] Remove legacy MCP `thread` alias.
- [x] Clarify MCP tool descriptions and docs.

## Phase 39: Verification

- [x] Run targeted tests.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Update `.agents/progress.md`.
