# Recall optimization verification

Date: 2026-09-14

## Controlled before/after evaluation

The baseline was compiled separately from `a1fce63cafecc6fd87dbf8e2a7d6ec8afaf30b06`. Both implementations used isolated in-memory databases with the same contribution rules and frozen September 14 Working Memory. The eight queries were fixed by the earlier [agent evaluation](../../docs/implementation/native-host-adoption.md) before this implementation. Each ran at 1,000 and 2,000 token upper bounds. No production database was changed or user-feedback label created.

| Observation | Before | After |
| --- | --- | --- |
| Six relevant questions: candidate found | 4/6 at each budget | 6/6 at each budget |
| Six relevant questions: complete Memory selected at 1,000 | 0/6 | 6/6 |
| Six relevant questions: complete Memory selected at 2,000 | 4/6 | 6/6 |
| Port question against contribution-only corpus | Unrelated candidate; injected at 2,000 | No candidate at either budget |
| Database question against contribution-only corpus | No candidate | No candidate |

The improved 1,000-bound packets consume 998 UTF-8 bytes, include the complete rule and current task, and omit `recent_decision` with `budget` and `query_memory_reservation` reasons. These are fresh fixture packets, not byte-for-byte replays of the historical live receipts. Separate tests use verbose optional state to verify that `next_step` can also be omitted when it would displace the relevant Memory.

The unchanged [20-case baseline](../026-recall-quality-baseline/cases.json), evaluated without context budgeting, improves Recall@1, Recall@5 and MRR from **0.75 to 0.95**. The remaining miss is “机器摘要怎样免审转正”. The existing 0.75 pass thresholds remain unchanged. Segmentation and lexical overlap explain the improvement; this does not prove general semantic understanding.

## Regression and entrypoint checks

- [Query retrieval tests](../../tests/memory/queryRetrieval.test.ts): 16 cases covering Chinese paraphrases, English common-word noise, port/version/database objects, mixed questions, Chinese project names, single-character keyword OR, literal phrases, kind/status/project isolation, and cross-language matches.
- [Query allocation tests](../../tests/context/queryBudgetAllocation.test.ts): 11 cases covering the adoption fixture, critical state, oversized warnings, character/UTF-8 limits, complete entry costs, Briefing overhead, task overrides, no-query behavior, and explicit Research priority.
- [Public entrypoint tests](../../tests/integration/recallOptimization.test.ts): three combined CLI and real stdio MCP tests. Both entrypoints return the same Markdown, omit archived and foreign-project records, select the appropriate port/database rule in a corpus with distractors, and write no Recall or feedback records in preview mode.

The first complete suite exposed an old warning-grouping fixture that relied on project-name-only noise (`Mira unsafe`). Its query now uses the two Memories' actual topics (`local unsafe`); every grouping assertion is retained.

Independent cross-reviews found and fixed a single-character Chinese OR regression before final validation. No new blocking findings remain in the retrieval or allocation changes.

Final `PATH=/usr/local/bin:$PATH /usr/local/bin/node scripts/verify-trust.mjs` passed on Node 24.11.1: **94 files, 389/389 tests**, followed by target-architecture, research-pilot, multi-case-research, and recall-baseline checks. Validated source/test/config fingerprint: `492ab07b420349fbffb54aec3c7ddccc7965da195c1b83f60e5f52204f84de79`. Documentation is outside that fingerprint; links and claims were reviewed separately. `git diff --check` also passed.

## Limits

The adoption corpus contains one Memory, and the broader baseline contains 20 synthetic Memories. These results establish the tested regressions, not production accuracy. Domain aliases are finite. ASCII identifiers embedded directly in Chinese text can still miss under SQLite's default tokenizer. Explicit Research Cases retain their existing allocation policy, and a budget too small for critical state plus a complete Memory can still omit that Memory. Prepared-context selection does not prove that a host delivered it or a model used it.
