# Native capture recovery verification

Verified on 2026-09-17 with Node v24.11.1.

## Regression coverage

The regression fixtures reproduced the original 50,000-character session rejection, provider-dependent local follow-up, and completed-turn conflict caused solely by changed file observations. The fixes preserve separate whole-session and single-message limits, immutable replay identity, and model-worker configuration requirements.

Coverage includes:

- Native Codex/Claude long transcripts, the 5,000,000-character boundary, and over-limit rejection without durable writes.
- Metadata-only replay, genuine conflicts, legacy full-input hashes, newer snapshots, deleted-Thread repair, path changes, and cross-project rejection.
- Local queue recovery without a provider, worker launch after durable local work, and retry after follow-up failures without duplicate events.
- Fresh compiled native CLI and stdio MCP processes: complete long-session storage, unchanged Stop/SessionEnd callbacks, and SessionStart recovery of queued work.

The public MCP `after_turn` tool retains its flat query/response input. Its integration test builds a session longer than 50,000 characters from individually valid messages; no new MCP transcript parameter was introduced.

## Full validation

Command: `PATH=/usr/local/bin:$PATH /usr/local/bin/node scripts/verify-trust.mjs`

- 99 test files; 430 passed, zero failed or pending.
- Target architecture, research pilot, multi-case research, and recall baseline checks all passed.
- Source fingerprint: `21bb17a51f7f738b02bf7233e4a0a9bc149ee09d5ce351603eca1792018c68d7`.
- Local report: `artifacts/trust-validation/report.json` (generated artifact, not committed).

## Local data recovery

A consistent SQLite backup was taken before mutation, and the recovery was rehearsed against a separate copy. The same compiled native hook then recovered the two affected local sessions. Verification compared the saved text against the complete normalized source using SHA-256, checked file checkpoints, and replayed SessionEnd to confirm no duplicate records.

| Observation | Before | After |
| --- | ---: | ---: |
| Previously rejected session, normalized characters | 9,352 | 63,682 |
| Metadata-only replay session, normalized characters | 3,430 | 3,430; checkpoint current |
| Threads | 9 | 9 |
| Capture records | 6 | 7 |
| Local Outbox | 12 pending | 14 completed, including 2 recovery events |
| Distillation jobs | 0 | 4 pending, all with 0 attempts |
| Briefing | Stale v3 | Fresh v4 |
| Formal Memories | 1 | 1, unchanged |
| Recall feedback | 0 | 0 |

Live verification completed at 2026-09-17 20:38:19 Asia/Shanghai. Other Threads and formal Memories remained unchanged. The recovery removed provider variables from its subprocess environment and made no model requests. Pending model jobs still require a configured provider; this recovery is not evidence of automatic extraction or user feedback.

Local backup: `.mira/backups/native-recovery-20260917-203245.sqlite`. Rehearsal and live verification metadata: `artifacts/trust-validation/native-recovery-20260917/`. These local artifacts contain no committed transcript data.

Legacy replay remains conservative: if an old unversioned hash cannot be verified exactly or reconstructed from its original persisted checkpoint, it is rejected. A later cursor cannot be used to guess the original input identity.
