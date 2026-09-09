# Context trust release validation

Validated on 2026-09-09 with Node v24.20.0 and a matching better-sqlite3 native build. All data used for acceptance checks was synthetic or from the repository's committed public-source fixtures.

## Coverage

| Contract | Evidence |
|---|---|
| Uniform Research eligibility | Mixed expired/current support is rejected; an inclusive case-date boundary remains eligible; legacy approvals are filtered without rewriting history |
| Project/workspace identity | Existing worktree/clone/move tests plus expected-project rejection before recall/turn writes |
| Status and permissions | Missing-database status creates no first-run state; a real stdio request reports the observed connection; host approval remains unknown; review scopes cannot mutate Memory |
| Context selection | Working Memory omissions/overrides, Claim qualifications, shared budgets and hash-bound replay/delivery tests |
| Candidate trust | User/assistant/tool/unattributed source fixtures, quoted role labels, ambiguous excerpts, immutable policy reasons, and pagination beyond 100 pending records |
| Workflow stages | A real Outbox/distillation chain moves from queued to pending_review to accepted; duplicate finish reuses outbox IDs; profiles do not grant authority |
| Migration | Fresh schema, legacy upgrades, repeat migrations, future-version rejection, and v14-to-v16 preservation of old candidates/receipt JSON without invented provenance |
| Cross-entrypoint consistency | Real stdio MCP, compiled CLI and local Viewer HTTP agree on scope and bounded preview; mismatches are structured errors and previews write no recalls |

## Commands and results

- `npm test`: 86 files / 329 tests passed, including TypeScript pretest compilation.
- After that build, `node scripts/verify-target-architecture.mjs`: passed. The comparison checks stable packet contents separately from valid generation timestamps.
- `node scripts/verify-research-pilot.mjs`: passed; approved evidence-gated research, revision/stale propagation and CLI/MCP/Viewer consistency.
- `node scripts/verify-multi-case-research.mjs`: passed for the three committed official-source cases.
- `node scripts/run-recall-baseline.mjs`: passed existing thresholds; 20 cases, recall@1 0.75, recall@5 0.75, MRR 0.75. This series does not claim a retrieval-quality improvement.
- `git diff --check`: passed.

The existing CI runs the full test suite and all four invariant/baseline commands. No separate source of truth or special test-only implementation path was introduced.

## Browser acceptance

A temporary local Viewer was inspected in the Codex browser. The overview showed connection and host approval as unknown. The pending queue displayed separate user and assistant origins and the self-reported confidence label. Approving a synthetic user decision removed it from pending; filtering accepted showed the preserved original high-impact policy reason and the new review reason. Its Memory link opened the exact record with correction/archive/history controls. The temporary browser tab and server were closed afterward.

## Operational boundaries

- Native Codex/Claude/Cursor hooks remain session-granularity integrations. Per-turn callers must supply stable real IDs.
- A host-reported delivery is an assertion bound to an output hash, not proof of model use. Host approval is never inferred from configuration or a successful connection.
- Optional context payloads expire for replay at their deadline and are purged on the next audited preparation for the same project. Existing lifecycle-result retention is unchanged.
- Historical candidate provenance stays unknown. Candidate conflict checks remain same-kind/same-title checks; no semantic conflict guarantee is advertised.
- No live provider calls, production data migration or production host configuration changes were performed. Approval of the seven PRs is still required before merging into main.

## Review order

1. #8 — Research eligibility.
2. #9 — Context scope and project guards.
3. #10 — Runtime status and capability scopes.
4. #11 — Complete context budgets and audit.
5. #12 — Candidate provenance and review navigation.
6. #13 — Tool profiles and processing progress.
7. Final verification PR — this report, cross-entrypoint/migration acceptance and integration refinements.

All PRs target main. Later PRs include unmerged prerequisite commits until those prerequisites are reviewed and merged. Compatibility-only fixture/timestamp fixes were backported to stages 2–6 so their CI can validate them independently.
