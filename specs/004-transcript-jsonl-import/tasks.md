# Transcript JSONL Import Tasks

Feature ID: `004-transcript-jsonl-import`
Status: Complete

## Phase 13: JSONL Importer

- [x] Write failing tests for Claude Code JSONL normalization.
- [x] Write failing tests for Codex JSONL normalization.
- [x] Write failing test for invalid JSON line errors.
- [x] Implement JSONL transcript parsing in `agentSessionImporter`.

## Phase 14: Import CLI Format Option

- [x] Write failing CLI test for `mira import --format jsonl`.
- [x] Add `--format` option to `mira import`.
- [x] Verify JSONL imported thread can be distilled and searched.

## Phase 15: Docs and Progress

- [x] Update README import examples.
- [x] Update `.agents/progress.md`.
- [x] Update `.agents/agent-context.md`.

## Current Gate

- [x] `npm test`
- [x] `npm run build`
