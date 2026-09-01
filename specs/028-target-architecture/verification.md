# Mira Target Architecture Verification

Date: 2026-09-01
Status: verified

This document maps every target-architecture requirement to current implementation and executable evidence. The authoritative fact source is SQLite; Markdown files listed below describe or verify behavior but do not replace runtime state.

## Requirement matrix

| Target layer or invariant | Implementation evidence | Verification evidence |
| --- | --- | --- |
| Codex / Claude Code / Cursor / CLI / MCP / Viewer entry coverage | `src/lifecycle/hostAdapterRegistry.ts`, `src/integrations/hookRuntime.ts`, `src/index.ts`, `src/mcp/server.ts`, `src/ui/viewerServer.ts` | `tests/integrations/hookRuntime.test.ts`, `tests/cli/lifecycle-cli.test.ts`, `tests/mcp/tools.integration.test.ts`, `tests/ui/viewerServer.test.ts` |
| Source Host and invocation Transport remain distinct | Adapter descriptor `adapterRole`; Turn Domain Events record `sourceHost` and `transport` | MCP test proves `sourceHost=cursor` with `transport=mcp`; lifecycle test proves CLI provenance |
| Unified `beforeTurn` / `afterTurn` port | `src/lifecycle/turnLifecycle.ts` | `tests/lifecycle/turnLifecycle.test.ts` proves idempotency, conflict rejection, project/Host isolation, Recall/Capture receipts and atomic Outbox creation |
| Before Turn delegates to Context Orchestrator | `prepareContext` is called only through the lifecycle port for Host turns | lifecycle, CLI, MCP and Viewer tests inspect the returned audited Context Packet |
| Recall Feedback separates retrieval, ranking, budget and Memory-quality signals | `src/context/recallFeedbackStore.ts`; optional correction `recallId` on immutable Memory events | Context, migration, MCP and CLI tests prove authority, project isolation, exact ID attribution and the 20/5 decision threshold |
| After Turn captures without granting authority | Capture Record and Thread are stored; only distill/projection Outbox work is requested | lifecycle tests assert no Memory or Candidate is directly confirmed |
| Project Memory and Candidate / Quarantine remain governed | Existing curation capability tokens and candidate review are reused | `tests/memory/curationService.test.ts`, `tests/distill/candidateService.test.ts`, full runtime acceptance |
| Investment Research Context is separate from generic memory context | `src/research/researchContext.ts`; Briefing receives only aggregate Research status; MCP delegates to the same projection and appends a body-free Domain Event receipt | Research Context, MCP and stdio tests prove gated inclusion, stale exclusion, exact provenance IDs and output-hash audit |
| Source Snapshot → Evidence → Claim → Review | `src/research/evidenceVerification.ts`, `src/research/researchService.ts` | evidence and research service tests cover hash, locator, excerpt, as-of, freshness, approval gate, structured contradiction disposition and immutable revision |
| Snapshot/Evidence staleness propagates | governed Source Snapshot and Evidence stale operations reopen linked Claims and stale current Verification | `tests/research/researchService.test.ts`, CLI Research test |
| SQLite schema and migration | schema v14 adds Recall Feedback after Lifecycle, Event/Outbox, Source Snapshot, Verification and handler receipts | schema tests cover fresh v14, repeated migration, v13 Recall/Memory preservation, approved Claim reopening and future-version rejection |
| Transactional Event / Outbox | `src/events/domainOutboxStore.ts`, `src/events/outboxRunner.ts`, `src/events/defaultOutboxHandlers.ts` | event tests cover same-transaction writes, lease recovery, stale-worker rejection, exponential retry, sanitization and idempotent effects |
| Briefing / Context / Vault / Viewer / Export are derived reads | Research summaries in Briefing; separate Research Context; audited Vault pages; Viewer and Export show Snapshot metadata and Verification receipts without Snapshot body | briefing, Research Context, Vault, Viewer and Apple pilot tests |
| No automatic thesis mutation | Research produces Thesis Impact Proposals only; no thesis/portfolio/trading state writer exists | complete runtime and Apple pilot assert Research creates no Memory or thesis side effect |

## Executable acceptance

- `npm test`: 75 files, 308 tests.
- `npm run build`: production TypeScript compilation.
- `npm run verify:target-architecture`: no-network full path from Before Turn through Research export and Vault.
- `npm run verify:research-pilot`: Apple FY2024 public-source case with 15 Snapshot-bound Evidence Items and eight Claims.
- `npm run verify:multi-case-research`: three official-filing cases prove discovery, pre-review exclusion, authorized approval, case isolation and body-free Research recall audit without Memory, Candidate or thesis writes.
- `scripts/verify-management-ui.mjs`: real Chrome wide/narrow Viewer acceptance with zero page errors.
- `git diff --check`: patch-format verification.
- Legacy product-name scan: no match outside ignored build/dependency metadata.

## Deliberate boundary

Generic `prepareContext` does not inject Research Claims. Local CLI, loopback Viewer and the explicitly authorized MCP `prepare_research_context` tool expose the same separately gated Research Context. The MCP tool is read-only with respect to research facts, grants no review or thesis authority, excludes draft, unverified and stale research, and appends a body-free recall receipt; `get_research_case` remains the canonical project-scoped audit snapshot.
