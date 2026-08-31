# Recoverable worker and local memory management

## Worker contract

- Schema v9 adds retry scheduling and maximum attempts without deleting existing jobs/candidates. A claim is a five-minute lease identified by job ID and monotonic attempt number.
- Expired running jobs are recovered on the next claim; an old attempt cannot commit candidates or finish/fail a newer attempt. Candidate writes and completion are one transaction.
- Provider request failures receive up to three attempts with exponential backoff; validation/sensitive-data failures are terminal. Manual retry grants a new three-attempt budget without erasing lifetime attempts.
- `distill jobs run --once` stays one-shot. `--drain` handles due work and scheduled retries, then exits. Detached capture workers drain; a configured SessionStart also resumes pending/expired work without blocking context on provider latency.
- No perpetual daemon or OS scheduler is installed. Recovery requires a worker launch (capture, SessionStart or explicit CLI).

## UI contract and visual baseline

- Extend the existing Simplified Chinese Viewer: retain dark left navigation and light content panels at desktop width; stack navigation/content below 920px. No remote assets.
- Add 候选审核、召回审计、后台任务. Candidate cards show statement, evidence, source Thread, risk/review reason and explicit accept/reject controls. Optional replacement selects an active Memory ID.
- Memory cards expose content, source and lifecycle state. Corrections create immutable successors; archive/restore and history use the shared curation service. Confirmation is required before writes; errors remain visible. No hard-delete, provider trigger or integration-install button.
- GET views do not rebuild Briefing or record recall. Context is explicitly a preview. Project identity is bound to the selected root/database; request bodies cannot supply another project.
- Bind only loopback; validate Host for DNS-rebinding protection. Mutations require same Origin, JSON and a random per-server CSRF token, bounded body, strict action validation. Escape all stored text in HTML. No remote access mode without authentication.
- Background tasks show attempts, next retry and sanitized error; UI can queue a manual retry but does not call the Provider.

## Verification

Test public job/worker interfaces with controlled clock, stale attempt fencing, automatic retries, and existing hook latency tests. Test HTTP mutation/authentication/project isolation and GET purity. Browser acceptance: screenshot desktop and narrow layout against the baseline above; exercise review, correction, archive/restore, history and navigation without JS errors. Use synthetic temporary project data only.
