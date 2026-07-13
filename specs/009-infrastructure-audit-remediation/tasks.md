# Infrastructure Audit Remediation Tasks

Feature ID: `009-infrastructure-audit-remediation`
Status: Complete

## Phase 32: Performance And Database Readiness

- [x] Add tests for bounded search and indexed schema contracts.
- [x] Add WAL and busy timeout.
- [x] Add project/thread indexes.
- [x] Add top-N memory listing for context bundles.

## Phase 33: Concurrency And Data Safety

- [x] Add tests for ensureProjectForRoot idempotency and addMemory duplicate race fallback.
- [x] Add tests for distill empty-output protection.
- [x] Implement safer project/memory/distill writes.

## Phase 34: Packaging And Portability

- [x] Add package metadata tests for prepare, engines, files.
- [x] Add root normalization and slug readability tests.
- [x] Implement package and portability updates.

## Phase 35: Docs And CLI Robustness

- [x] Add docs tests for README and agent template prerequisites/required args.
- [x] Add CLI validation tests for empty content, numeric ranges, and blank thread text.
- [x] Implement docs and CLI validation updates.

## Phase 36: Verification

- [x] Update `.agents/progress.md`.
- [x] Run targeted tests.
- [x] Run `npm test`.
- [x] Run `npm run build`.
