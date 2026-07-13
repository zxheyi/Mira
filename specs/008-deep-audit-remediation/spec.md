# Deep Audit Remediation Spec

Feature ID: `008-deep-audit-remediation`
Status: Complete

## Goal

Resolve the deep audit findings that remain after the first audit hardening rounds, with emphasis on data correctness, context bundle usefulness, deterministic distill coverage, export completeness, and CLI/MCP robustness.

## Scope

- Prevent stale `memory_fts` rows when threads or projects are deleted.
- Add thread/project deletion APIs and CLI commands, including FTS cleanup.
- Improve context bundle construction with working-memory priority, warnings section, entry-level memory budgeting, and timestamps.
- Improve deterministic distill fallback behavior, constraint heading support, and multi-line bullet handling.
- Cap LLM distill candidate count.
- Export saved threads in JSON and Markdown.
- Warn when project root detection falls back to the current directory.
- Add CLI usage hints for custom errors and a `wm` alias for `working`.
- Unify MCP handler validation through Zod parsing and reuse a server-level database connection for registered tools.
- Update the agent-session import spec to include JSONL support.

## Non-Goals

- No full backup/restore import for Mira export files.
- No HTTP or SSE MCP server.
- No vector search or hybrid search changes.

## Acceptance Criteria

- Tests demonstrate FTS cleanup after thread/project deletion.
- Context bundle tests verify prioritized working memory, warnings, timestamps, and no mid-entry long-term memory truncation.
- Distill tests cover fallback note sections, constraint headings, and multi-line bullet continuation.
- LLM candidate parsing rejects more than 50 candidates.
- Export tests verify thread data is present.
- CLI tests verify root fallback warning, custom error usage hint, and `wm` alias.
- MCP tests verify registered tool calls parse with Zod and reuse an injected/opened database session.
- `npm test` and `npm run build` pass.
