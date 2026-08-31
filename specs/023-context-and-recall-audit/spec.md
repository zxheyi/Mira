# Unified context preparation and recall audit

## Contract

- CLI, MCP and hooks use one context preparation interface; existing Markdown output remains available. A structured result includes the rendered context and its receipt.
- Explicit queries select matching active project memories, including warnings. Phrase matches are combined with OR-term fallback candidates instead of suppressing all fallback on the first match. Chinese substrings are retrievable without embedding or network access.
- Shared and selected-task Working Memory are merged by kind. Other tasks are excluded. Briefing is a shared derived view, not an independent source of authority.
- Context includes stable Memory IDs. Oversized entries are skipped without dropping later short entries. Characters are hard-bounded; an optional token budget uses a conservative UTF-8 byte upper bound for byte-level tokenizers, explicitly labeled instead of claiming model-specific token counts.
- Recall receipts record project/task, query, candidate IDs, injected IDs, dropped reasons, output hash, size/budget and latency. IDs count as injected only if their complete entry is rendered. A receipt is not evidence of successful use.
- Recorded recall is the default for agent context requests; previews opt out and must not create recall or Briefing records. CLI `context recalls` and MCP `list_recall_events` expose project/task-filtered receipts.
- Queries containing recognizable secrets are redacted in audit storage. No transcript body is copied into recall receipts.
- Schema v8 migration preserves v7 project/task state and historical memory records.

## Verification

Exercise context/search interfaces and CLI/MCP: mixed-language retrieval, irrelevant-warning exclusion, fallback backfill, complete-entry budget selection, exact selected ID receipts, preview with no writes, task isolation and audit access. Run full tests/build and verify the staged snapshot independently of uncommitted Viewer work.
