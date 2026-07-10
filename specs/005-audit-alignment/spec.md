# Audit Alignment Spec

Feature ID: `005-audit-alignment`
Status: Complete

## Goal

Resolve the MVP audit findings where implementation and planning documents diverged, while preserving existing data and CLI compatibility.

## Scope

- Add planned Memory kinds: `task`, `fact`, `failed_attempt`.
- Add planned Working Memory kinds: `current_phase`, `recent_decision`.
- Keep existing kinds as backward-compatible extensions.
- Update deterministic distill rules to recognize headings for planned kinds.
- Align search ordering so relevance score is considered before recency after importance and confidence.
- Add CLI compatibility aliases:
  - `thread save --raw-format` as an alias for `--format`.
  - `thread save --file` to read raw text from a file.
  - `memory search <query>` while keeping `--query`.

## Non-Goals

- No schema migration beyond enum/string usage.
- No removal of existing kinds.
- No MCP multi-project `projectRoot` override.
- No full stdio transport E2E test in this phase.

## Acceptance Criteria

- Tests cover the planned Memory and Working Memory kinds.
- Distill tests cover `task`, `fact`, and `failed_attempt`.
- Search ordering test proves score wins over created_at when importance and confidence are equal.
- CLI tests cover `--raw-format`, `--file`, and positional `memory search`.
- `npm test` and `npm run build` pass.
