# Verification record

Baseline: [recovery and management UI contract](spec.md), 2026-08-31.

- `npm test`: 53 test files, 251 tests pass. Includes v8 queue migration, expired-lease recovery, stale worker fencing, bounded retries/drain, Hook launch failure isolation, unchanged dry-run databases, same-origin mutation checks, strict payloads and preview purity.
- `npm run build`: TypeScript succeeds (also required by `npm test` pretest).
- `scripts/verify-management-ui.mjs`: real isolated Chromium passes review/cancel/reject, correct/archive/restore/history, recall/job/thread navigation, empty Briefing, desktop and 390px layout; no page script errors. Synthetic temporary project only; no external provider requests.
- Desktop review and memory-history screenshots plus narrow candidate screenshot were inspected against the dark navigation/light panels/stacked narrow baseline. An inapplicable correction field in the approval dialog was found, fixed, and protected by a visibility assertion.

To rerun browser acceptance after building, install/provide Playwright and run `node scripts/verify-management-ui.mjs`. `MIRA_PLAYWRIGHT_MODULE` can point to a bundled module; `MIRA_BROWSER_PATH` optionally selects an installed isolated Chromium executable. The script prints its temporary artifact directory and closes server/browser handles.

Scope: local runtime and UI only. No push, deployment, real database migration, provider enablement or OS scheduler installation. Legacy naming cleanup and unrelated `.gitignore` edits are excluded from the architecture commits.
