# Phase 6 Safe Real-World Adoption Plan

## Architecture

Add filtering and summary calculation inside the history import service so CLI, reports, and future callers share the same behavior. Add a small doctor module that composes existing status/store functions in read-only mode, then expose it as a top-level CLI command.

## Components

- `src/history/historyTypes.ts`: add filter audit stage and report summary types.
- `src/history/historyImportService.ts`: apply date/size/limit filters before parsing transcript bodies and compute capacity summary.
- `src/index.ts`: parse new `history import` options and add `doctor`.
- `src/doctor/doctor.ts`: read-only project/database/integration diagnostics.
- `tests/history/historyImportService.test.ts`: service-level filter tests.
- `tests/cli/history-cli.test.ts`: CLI option/report tests.
- `tests/cli/doctor-cli.test.ts`: doctor command tests.
- `README.md`: safe first-loop documentation.

## Verification

Run targeted tests first:

```bash
npm test -- tests/history/historyImportService.test.ts tests/cli/history-cli.test.ts tests/cli/doctor-cli.test.ts
```

Then run:

```bash
npm run build
npm test
git diff --check
```
