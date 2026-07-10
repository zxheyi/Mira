# Agent Session Import Tasks

Feature ID: `002-agent-session-import`
Status: Complete

## Phase 7: Unified Agent Session Importer

- [x] Write failing importer tests for Markdown normalization.
- [x] Implement `src/importers/agentSessionImporter.ts`.
- [x] Support source validation for `codex`, `claude-code`, and `markdown`.
- [x] Support stable generated ids.
- [x] Support title inference from H1 or file name.

## Phase 8: Codex Markdown Import

- [x] Write failing CLI test for `mira import --source codex --path`.
- [x] Implement CLI import command.
- [x] Verify imported Codex Markdown is saved as Thread.

## Phase 9: Claude Code Markdown Import

- [x] Write failing CLI test for `mira import --source claude-code --path`.
- [x] Verify imported Claude Code Markdown can be distilled and searched.

## Current Gate

- [x] `npm test`
- [x] `npm run build`
