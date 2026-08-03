# Phase 6 Safe Real-World Adoption

## Goal

Make Mira safe to use on real multi-project Codex and Claude Code history without unexpectedly growing the database or silently missing project integrations.

## Scope

Phase 6 covers three linked outcomes:

1. Capacity-governed history import for local transcript archives.
2. A project doctor that reports integration and database readiness.
3. A small, repeatable first-loop workflow for importing NamiWork-style history into a shared Mira database.

## Requirements

### R1 Capacity-Governed History Import

`mira history import` must support bounded imports:

- `--since <YYYY-MM-DD>` includes sessions whose transcript mtime is on or after the date.
- `--until <YYYY-MM-DD>` includes sessions whose transcript mtime is before the next day after the date.
- `--max-file-size <MB>` skips sessions whose transcript size is greater than the limit.
- `--limit <N>` imports or previews at most N matching sessions after filtering.

Dry-run and JSON report output must include a `summary` object with:

- `matchedCount`
- `matchedBytes`
- `matchedMegabytes`
- `skippedByDateCount`
- `skippedBySizeCount`
- `limitedCount`
- `largestCandidates`, up to 10 entries with agent, sessionId, cwd, filePath, size, and mtimeMs.

Files skipped by date or size must be represented in audit items as `skipped` with `errorStage: "filter"`.

### R2 Doctor CLI

Add `mira doctor` to report project adoption readiness as JSON. It must include:

- project root and db path
- whether the database exists
- schema version when readable
- project/thread/memory/candidate/history-run counts for the current project when readable
- integration status for Codex and Claude Code using the existing installer status logic
- diagnostic log presence and latest diagnostic timestamp when `.mira/integrations.log` exists
- warnings for missing Codex or Claude Code integration

Doctor must be read-only: it must not create `.mira`, initialize a database, install hooks, or mutate project files.

### R3 Minimal Real Loop

The README must document the recommended safe first loop:

1. Run `mira doctor`.
2. Run `history import --dry-run --since 2026-07-01 --max-file-size 20 --limit 20`.
3. Run the same import without `--dry-run`.
4. Rebuild briefing.
5. Sync vault.
6. Inspect context bundle.

The loop must be possible against a shared database by using global `--project-root` and `--db` before subcommands.

## Non-Goals

- Do not implement summarization-only storage for oversized transcripts in this phase.
- Do not change the thread schema or add compressed blob storage.
- Do not create a global project registry.
- Do not auto-install integrations from `doctor`.

## Acceptance

- Targeted tests cover date filter, size filter, limit behavior, summary fields, and doctor read-only reporting.
- CLI tests demonstrate the new options and JSON shape.
- README includes the safe first-loop commands.
- `npm run build` and relevant Vitest suites pass.
