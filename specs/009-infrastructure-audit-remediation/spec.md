# Infrastructure Audit Remediation Spec

Feature ID: `009-infrastructure-audit-remediation`
Status: In Progress

## Goal

Resolve the 2026-07-13 infrastructure audit findings across performance, concurrency, packaging, portability, onboarding docs, and error recovery.

## Scope

- Add bounded memory search and indexed project queries.
- Replace context fallback N-query behavior with one bounded OR query.
- Enable SQLite WAL and busy timeout.
- Make project and memory writes safer under concurrent callers.
- Make distill clear/write atomic and protect existing memories when deterministic or LLM candidates are empty.
- Add package readiness metadata and scripts.
- Improve root path normalization, importer slug readability, and CLI validation.
- Update README and agent templates with setup, MCP required args, deletion commands, and global option placement.
- Add schema version checks and friendlier database-open errors.

## Non-Goals

- No full streaming JSONL parser in this phase; large JSONL imports remain future work.
- No split test/build tsconfig unless needed for package correctness.
- No Windows-specific E2E run in CI.

## Acceptance Criteria

- Search APIs support limits and context fallback does not issue one FTS query per term.
- Distill operations are atomic and do not clear old memories when new output is empty.
- Package metadata includes `prepare`, `engines`, and `files`.
- README and agent templates include the missing onboarding and MCP argument details.
- CLI rejects empty memory content, invalid confidence/importance, and blank thread raw text.
- Schema migration rejects unsupported newer schema versions.
- `npm test` and `npm run build` pass.
