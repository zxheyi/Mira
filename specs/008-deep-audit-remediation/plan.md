# Deep Audit Remediation Plan

Feature ID: `008-deep-audit-remediation`
Status: Implemented

## Implementation Steps

1. Add regression tests for all deep-audit findings before implementation.
2. Add FTS cleanup triggers and explicit delete APIs for threads/projects.
3. Refactor context bundle rendering around full sections and entry-level memory budgeting.
4. Extend deterministic distill rules and bullet parsing.
5. Harden LLM candidate parsing with a maximum count.
6. Extend export output with threads.
7. Improve CLI warnings, error hints, and `wm` alias.
8. Refactor MCP server execution so registered tools use Zod-parsed arguments and a shared DB session.
9. Update docs/spec progress and run full verification.

## Compatibility

- Existing CLI and MCP commands remain valid.
- Existing export JSON fields remain present; `threads` is additive.
- Existing deterministic distill headings remain supported.
- `working` remains the canonical CLI command; `wm` is an alias.
