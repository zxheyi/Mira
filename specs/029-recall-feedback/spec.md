# Recall Feedback and Retrieval Upgrade Evidence

Date: 2026-09-01
Status: confirmed

## Goal

Collect explicit, project-scoped user feedback against generic Memory Recall Receipts so Mira can distinguish retrieval failures from ranking, budget, and memory-quality failures before considering hybrid or vector search.

Research Context receipts remain a separate audit stream because `prepare_research_context` selects an explicit Research Case by ID rather than retrieving generic project Memory.

## Public interfaces

### `recordRecallFeedback`

Records one host-confirmed feedback receipt for one recorded generic Recall Receipt.

Input:

- `recallId`
- `outcome`: `useful | partial | missed | incorrect`
- optional unique `relevantMemoryIds`, `missingMemoryIds`, `irrelevantMemoryIds`, `correctedMemoryIds`
- `reason`

Rules:

- The Recall Receipt and every referenced Memory must belong to the same project.
- Relevant and irrelevant Memory IDs must have been injected by the referenced receipt.
- Missing Memory IDs must not have been injected.
- Corrected Memory IDs must have been injected.
- The four ID sets must not overlap.
- Only host-granted project authority may record feedback; tool arguments cannot grant authority.
- Feedback is append-only and contains IDs and bounded reasons, never recalled Markdown.

### `getRecallQualityReport`

Returns project-scoped counts and exact Memory IDs grouped by cause:

- `retrievalMissMemoryIds`: expected Memory absent from `candidateMemoryIds`.
- `rankingMissMemoryIds`: expected Memory was a candidate but was dropped by `memory_limit`.
- `budgetMissMemoryIds`: expected Memory was a candidate but was dropped by `budget`.
- `unexplainedMissingMemoryIds`: expected Memory was a candidate but the receipt does not explain its omission.
- `irrelevantMemoryIds` and `correctedMemoryIds` remain separate quality signals.
- `correctedMemoryIds` records an explicit user label; `confirmedCorrectionMemoryIds` records actual immutable Memory lifecycle corrections linked with `recallId`.

The report returns `insufficient_data` until it contains at least 20 labeled recalls. At 20 or more labels it returns `evaluate_hybrid` only when at least five distinct feedback records contain a true retrieval miss; otherwise it returns `keep_fts`. This recommendation is decision support only and never changes retrieval configuration automatically.

### Memory correction linkage

`update_memory` accepts optional `recallId`. When provided, the referenced receipt must have injected the predecessor Memory. Both immutable Memory lifecycle events record the Recall ID, allowing the quality report to distinguish a real correction from an unverified feedback label.

## Storage

SQLite remains the fact source. Schema v14 adds a project-scoped `recall_feedback` table and preserves existing `recall_events`, Memories, lifecycle history, and research data. Feedback deletion follows project deletion; no feedback operation mutates Memory or Research facts.

## Entry points

- MCP: `record_recall_feedback`, `get_recall_quality_report`, and optional `recallId` on `update_memory`.
- CLI: `context feedback` and `context quality`.
- Viewer: `GET /api/recalls` returns each generic receipt with optional stored feedback; same-origin `POST /api/recall-feedback/:recallId` records one explicit label through the same domain rules. The form exposes injected/dropped Memory details and searchable missing Memory selection. An active injected Memory can be corrected from its receipt; the existing Memory action carries that receipt ID into both immutable lifecycle events. Read-only `GET /api/recall-quality` returns the domain report; the Viewer presents coverage, cause IDs, 20/5 threshold progress, and recommendation without recomputing or applying retrieval policy.
- Skill/runtime profile: record feedback only when a user explicitly evaluates recalled Memory; never fabricate usefulness from tool success.

## Acceptance

- Fresh schema, v13 migration, repeat migration, and future-version rejection remain safe.
- Public module tests prove cause attribution, project isolation, ID-set validation, authority, and the 20/5 decision threshold.
- Memory correction tests prove Recall linkage on immutable successor/predecessor events.
- MCP and CLI expose the same stored feedback and quality report.
- Viewer HTTP and browser tests prove same-origin feedback entry, visible stored state, explicit user-only labeling, receipt-linked correction, and a read-only quality dashboard.
- Full tests, build, target-architecture verification, and patch checks pass.
