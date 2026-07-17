# Mira Progress

Last updated: 2026-07-17

## Current Status

Mira MVP implementation phases are complete. Phase 1 through Phase 6 have local commits.
Post-MVP P0 Agent Session Import is implemented and locally verified.
Post-MVP P1 LLM Distill and Agent Guidance is implemented and locally verified.
Post-MVP P2 Transcript JSONL Import is implemented and locally verified.
Audit Alignment P1 is implemented and locally verified.
MCP Agent Usability hardening is implemented and locally verified.
MCP Agent Polish and Boundary Tests are implemented and locally verified.
Deep Audit Remediation is implemented and locally verified.
Phase 0 engineering baseline closure is implemented and locally verified.
Phase 1 automatic Codex / Claude Code session integration is implemented and locally verified, including real-project installation and Hook smoke tests.
Phase 2 trusted automatic memory distillation is implemented and locally verified.
Phase 3 auditable Memory lifecycle is implemented, independently reviewed, and locally verified.
Phase 4 proactive Project Briefing and Context Planner are implemented, independently reviewed, and locally verified.

Completed:

- Phase 1.1: TypeScript CLI skeleton.
- Phase 1.2: SQLite connection and schema migration.
- Phase 2.1: Project root detection.
- Phase 2.2: Project Store.
- Phase 2.3: Thread Store.
- Phase 2.4: Memory Store and Search.
- Phase 3: Working Memory and Context.
- Phase 4: CLI Commands and Export.
- Phase 5: MCP Agent Interface.
- Phase 6: End-to-End Validation.
- Phase 7: Unified Agent Session Importer.
- Phase 8: Codex Markdown Import.
- Phase 9: Claude Code Markdown Import.
- Phase 10: LLM Distill Candidate Flow.
- Phase 11: CLI Review Loop.
- Phase 12: Agent Guidance Templates.
- Phase 13: JSONL Importer.
- Phase 14: Import CLI Format Option.
- Phase 15: Docs and Progress.
- Phase 16: Audit kind alignment.
- Phase 17: Audit distill and search alignment.
- Phase 18: Audit CLI compatibility.
- Phase 19: Audit docs and verification.
- Phase 20: MCP tool description quality.
- Phase 21: MCP kind runtime validation.
- Phase 22: MCP usability docs and verification.
- Phase 23: MCP agent polish.
- Phase 24: Boundary test coverage.
- Phase 25: Agent config docs and verification.
- Phase 26: Deep audit data lifecycle.
- Phase 27: Context Bundle usability.
- Phase 28: Distill and LLM hardening.
- Phase 29: Export and CLI UX.
- Phase 30: MCP architecture hardening.
- Phase 31: Deep audit docs and verification.
- Phase 32: Post-fix audit high-priority hardening.
- Phase 33: Hardening audit budget and CLI guards.
- Phase 34: Budget guards medium polish.
- Phase 35: Low-priority audit cleanup.
- Phase 36: Phase 0 recursive-trigger FTS integrity and default OR search semantics.
- Phase 37: Phase 1 Codex / Claude Code project Hook/MCP automatic integration.
- Phase 38: Persistent transcript capture cursor and Git local-config protection.
- Phase 39: Schema v3 distill jobs and memory candidates.
- Phase 40: Evidence, sensitive-data, risk, duplicate and conflict candidate policy.
- Phase 41: Idempotent job queue, OpenAI-compatible Provider and one-shot Worker.
- Phase 42: Hook async enqueue and detached Worker startup.
- Phase 43: Candidate/job CLI and candidate MCP tools.
- Phase 44: Phase 2 documentation and verification.
- Phase 45: Schema v4 Memory status, successor link and event ledger.
- Phase 46: Immutable update, archive, restore and history Core APIs.
- Phase 47: Active-only FTS, list, search and Context behavior.
- Phase 48: Candidate supersede plus lifecycle CLI/MCP tools.
- Phase 49: Lifecycle review remediation for strict migrations, active-only uniqueness, candidate provenance and managed distill archival.
- Phase 50: Explicit privacy hard-delete confirmation, documentation and final verification.
- Phase 51: Final review remediation for internal successor writes, pre-commit FK validation, trusted actors and v4 startup cost.
- Phase 52: Schema v5 Project Briefing snapshots and automatic stale triggers.
- Phase 53: Deterministic Briefing renderer, provenance, versions and failed fallback.
- Phase 54: Proactive Context Planner with independent warnings and character/token budgets.
- Phase 55: Briefing CLI/MCP interfaces and Phase 4 documentation.

## Verification Evidence

Latest verified commands:

```bash
npm test
# Test Files 35 passed; Tests 187 passed

npm run build
# tsc completed successfully

npm test
# Test Files 33 passed; Tests 175 passed

npm run build
# tsc completed successfully

npm test
# Test Files 31 passed; Tests 158 passed

npm run build
# tsc completed successfully

npm test
# Test Files 25 passed; Tests 131 passed

npm run build
# tsc completed successfully

npm run test -- tests/db/client.test.ts tests/db/schema.test.ts tests/projects/projectStore.test.ts tests/threads/threadStore.test.ts tests/memory/memoryStore.test.ts tests/context/contextBundle.test.ts tests/mcp/tools.integration.test.ts tests/importers/agentSessionImporter.test.ts tests/integrations/configInstaller.test.ts tests/integrations/hookRuntime.test.ts tests/cli/integration-cli.test.ts
# Test Files 11 passed; Tests 83 passed

npm run build
# tsc completed successfully

npm run test -- tests/mcp/tools.integration.test.ts
# Test Files 1 passed; Tests 2 passed

npm run test -- tests/cli/mcp-serve.test.ts
# Test Files 1 passed; Tests 1 passed

npm run test -- tests/integration/localLoop.test.ts
tests/infrastructure/packageMetadata.test.ts
tests/infrastructure/docs.test.ts
tests/infrastructure/schemaReadiness.test.ts
vitest.config.ts
specs/010-post-fix-audit-hardening/spec.md
specs/010-post-fix-audit-hardening/plan.md
specs/010-post-fix-audit-hardening/tasks.md
docs/audit-reports/2026-07-13-post-fix-audit.md
docs/audit-reports/2026-07-13-hardening-audit.md
docs/audit-reports/2026-07-13-budget-guards-audit.md
specs/012-budget-guards-medium-polish/spec.md
specs/012-budget-guards-medium-polish/plan.md
specs/012-budget-guards-medium-polish/tasks.md
specs/011-hardening-audit-budget-and-cli-guards/spec.md
specs/011-hardening-audit-budget-and-cli-guards/plan.md
specs/011-hardening-audit-budget-and-cli-guards/tasks.md
# Test Files 1 passed; Tests 1 passed

npm test
# Test Files 14 passed; Tests 31 passed

npm run build
# tsc completed successfully

npm test
# Test Files 16 passed; Tests 37 passed

npm run build
# tsc completed successfully

npm test
# Test Files 18 passed; Tests 44 passed

npm run build
# tsc completed successfully

npm test
# Test Files 18 passed; Tests 48 passed

npm run build
# tsc completed successfully

npm run test -- tests/memory/memoryStore.test.ts tests/workingMemory/workingMemoryStore.test.ts tests/distill/distillThread.test.ts tests/cli/phase4-cli.test.ts
# Test Files 4 passed; Tests 16 passed

npm test
# Test Files 18 passed; Tests 51 passed

npm run build
# tsc completed successfully

npm run test -- tests/mcp/tools.integration.test.ts
# Test Files 1 passed; Tests 5 passed

npm test
# Test Files 18 passed; Tests 54 passed

npm run build
# tsc completed successfully

npm run test -- tests/mcp/tools.integration.test.ts tests/memory/memoryStore.test.ts tests/distill/distillThread.test.ts tests/context/contextBundle.test.ts tests/export/exportProject.test.ts
# Test Files 5 passed; Tests 24 passed

npm test
# Test Files 18 passed; Tests 61 passed

npm run build
# tsc completed successfully

npm run test -- tests/memory/memoryStore.test.ts tests/threads/threadStore.test.ts tests/context/contextBundle.test.ts tests/distill/distillThread.test.ts tests/distill/llmDistill.test.ts tests/export/exportProject.test.ts tests/projects/projectRoot.test.ts tests/cli/phase4-cli.test.ts tests/mcp/tools.integration.test.ts tests/importers/agentSessionImporter.test.ts
# Test Files 10 passed; Tests 58 passed

npm test
# Test Files 18 passed; Tests 76 passed

npm run build
# tsc completed successfully
```

TDD evidence for Phase 5/6:

```text
JSONL import RED: normalizeJsonlSession is not a function
JSONL import CLI RED: unknown option '--format'
JSONL import GREEN: tests/importers/agentSessionImporter.test.ts passed, 7 tests
JSONL import CLI GREEN: tests/cli/import-cli.test.ts passed, 3 tests

Audit alignment RED: planned Memory / Working Memory kinds missing, planned distill headings not mapped, CLI compatibility test missing implementation, better-sqlite3 required rebuild for current Node.
Audit alignment GREEN: targeted tests passed after adding kind supersets, distill mappings, score-before-recency search ordering, and CLI aliases.

MCP usability RED: tool descriptions were not exported and MCP kind guards accepted arbitrary strings through type assertions.
MCP usability GREEN: explicit tool descriptions are exported, invalid Memory / Working Memory kinds are rejected, and missing argument errors remain explicit.

MCP polish RED: `search_memory.kind` was ignored and MCP `save_thread` still required `id`; better-sqlite3 required rebuild for current Node before database tests could run.
MCP polish GREEN: targeted tests passed after adding kind-filtered memory search, generated MCP thread ids, agent config prerequisites, and P3 boundary coverage.

Deep audit RED: missing delete APIs/FTS cleanup, context bundle mid-entry truncation, missing warnings/priority/timestamps, distill fallback gaps, uncapped LLM candidates, export without threads, CLI UX gaps, and MCP registered tools opening per call.
Deep audit GREEN: targeted and full tests passed after data lifecycle cleanup, entry-level context budgeting, deterministic distill hardening, export thread inclusion, CLI polish, shared MCP DB sessions, and Spec 002 JSONL update.

LLM distill RED: Cannot find module '../../src/distill/llmDistill.js'
LLM distill CLI RED: unknown command 'llm-prompt' / 'apply-candidates'
LLM distill GREEN: tests/distill/llmDistill.test.ts passed, 5 tests
LLM distill CLI GREEN: tests/cli/llm-distill-cli.test.ts passed, 2 tests

Agent importer RED: Cannot find module '../../src/importers/agentSessionImporter.js'
Import CLI RED: unknown command 'import'
Agent importer GREEN: tests/importers/agentSessionImporter.test.ts passed, 4 tests
Import CLI GREEN: tests/cli/import-cli.test.ts passed, 2 tests

MCP tools RED: Cannot find module '../../src/mcp/server.js'
MCP tools GREEN: tests/mcp/tools.integration.test.ts passed, 2 tests

MCP stdio CLI RED: mcp serve command missing
MCP stdio CLI GREEN: tests/cli/mcp-serve.test.ts passed, 1 test

Phase 6 local loop: tests/integration/localLoop.test.ts passed with real session 019f45f0-40bf-7261-8685-d5e0a6a8bf13
```

Infrastructure audit RED: package metadata missing prepare/engines/files, README and agent templates missing setup/required MCP args, search unbounded, schema indexes/version checks missing, distill empty output deleted old memories, LLM candidates lacked length limits, CLI accepted empty/invalid inputs, and non-ASCII session slugs collapsed to session.
Infrastructure audit GREEN: targeted tests passed after adding bounded FTS search, top-N context memory queries, WAL/busy_timeout, schema indexes and future-version guard, race-safer project/memory writes, atomic distill replacements with empty-result guards, LLM title/content caps, package metadata, docs updates, CLI validation, MCP handler errors, non-ASCII slug support, and stable integration-test timeout budget.
Infrastructure audit verification: targeted 009 suite passed (9 files, 50 tests); full npm test passed (21 files, 87 tests); npm run build passed.

Post-fix audit RED: schema direct thread deletion left memories searchable via ON DELETE SET NULL, MCP schemas still accepted legacy `thread`, out-of-range confidence/importance, oversized text, and unconstrained rawFormat, registered MCP handlers returned success for invalid boundary inputs, MCP descriptions did not distinguish session-start bundle from targeted search, and addMemory duplicate race fallback rolled back a simulated concurrent duplicate.
Post-fix audit GREEN: targeted tests passed after changing thread foreign key semantics to ON DELETE CASCADE, making addMemory use insert-or-ignore plus duplicate回查, hardening MCP Zod schemas and direct call validation, removing the MCP `thread` alias, adding tool-context MCP error wrapping, and clarifying MCP descriptions/return shapes.
Post-fix audit verification: targeted suite passed (3 files, 28 tests); full npm test passed (21 files, 94 tests); npm run build passed.

Hardening audit RED: warning memories bypassed maxCharacters, budgeted entries continued after the first oversized memory, get_context_bundle.query lacked a max length, unsupported MCP tool names returned undefined, CLI memory/working kind accepted invalid values, and addMemory catch fallback lacked direct coverage.
Hardening audit GREEN: targeted tests passed after routing warnings through budgeted entry insertion, changing budget overflow to stop at the first oversized entry, adding get_context_bundle query max validation, adding unsupported MCP tool guards/default executor branch, validating CLI Memory/Working Memory kinds, and covering addMemory catch fallback with a wrapped database test.
Hardening audit verification: targeted suite passed (4 files, 42 tests); full npm test passed (21 files, 99 tests); npm run build passed.

Budget guards medium polish RED: schema lacked a single-column `memories(thread_id)` index for cascade/delete paths, MCP descriptions did not clearly document Markdown-string return shape, nested SearchResult memory fields, or rawFormat values, and blank search query coverage was missing.
Budget guards medium polish GREEN: targeted tests passed after adding `idx_memories_thread`, adding an OR-term empty-query defensive guard, clarifying MCP descriptions for get_context_bundle/search_memory/save_thread, and adding blank `searchMemories` regression coverage.
Budget guards medium polish verification: targeted suite passed (3 files, 30 tests); full npm test passed (21 files, 101 tests); npm run build passed.

Low-priority audit cleanup RED: context bundle did not budget Working Memory edge cases, CLI accepted invalid thread formats/context numeric ranges, MCP low-priority description and top-N budget paths lacked coverage, direct memory SQL writes did not sync FTS, deleteThread redundantly cleared memories, and database/export/distill defensive paths lacked tests.
Low-priority audit cleanup GREEN: targeted tests passed after budgeting Working Memory with final maxCharacters guard, adding thread format/context range validation, documenting MCP low-priority behavior, validating rawFormat at the MCP execution boundary, adding FTS insert/update triggers, relying on cascade thread deletion, and covering database-open/export/addMemory/distill rollback cases.
Low-priority audit cleanup verification: targeted suite passed (9 files, 69 tests); full npm test passed (22 files, 110 tests); npm run build passed.

## Current Files Of Interest

```text
src/index.ts
src/db/client.ts
src/db/schema.ts
src/projects/projectRoot.ts
src/projects/projectStore.ts
src/threads/threadStore.ts
src/memory/memoryStore.ts
src/workingMemory/workingMemoryStore.ts
src/distill/distillThread.ts
src/distill/llmDistill.ts
src/context/contextBundle.ts
src/export/exportProject.ts
src/importers/agentSessionImporter.ts
src/mcp/server.ts
src/mcp/transport.ts
tests/importers/agentSessionImporter.test.ts
tests/cli/import-cli.test.ts
tests/cli-smoke.test.ts
tests/cli/phase4-cli.test.ts
tests/cli/mcp-serve.test.ts
tests/db/schema.test.ts
tests/projects/projectRoot.test.ts
tests/projects/projectStore.test.ts
tests/threads/threadStore.test.ts
tests/memory/memoryStore.test.ts
tests/workingMemory/workingMemoryStore.test.ts
tests/distill/distillThread.test.ts
tests/distill/llmDistill.test.ts
tests/context/contextBundle.test.ts
tests/export/exportProject.test.ts
tests/mcp/tools.integration.test.ts
tests/cli/llm-distill-cli.test.ts
tests/integration/localLoop.test.ts
tests/infrastructure/packageMetadata.test.ts
tests/infrastructure/docs.test.ts
tests/infrastructure/schemaReadiness.test.ts
vitest.config.ts
specs/010-post-fix-audit-hardening/spec.md
specs/010-post-fix-audit-hardening/plan.md
specs/010-post-fix-audit-hardening/tasks.md
docs/audit-reports/2026-07-13-post-fix-audit.md
docs/audit-reports/2026-07-13-hardening-audit.md
docs/audit-reports/2026-07-13-budget-guards-audit.md
specs/012-budget-guards-medium-polish/spec.md
specs/012-budget-guards-medium-polish/plan.md
specs/012-budget-guards-medium-polish/tasks.md
specs/011-hardening-audit-budget-and-cli-guards/spec.md
specs/011-hardening-audit-budget-and-cli-guards/plan.md
specs/011-hardening-audit-budget-and-cli-guards/tasks.md
specs/001-mira-mvp/spec.md
specs/001-mira-mvp/plan.md
specs/001-mira-mvp/tasks.md
specs/002-agent-session-import/spec.md
specs/002-agent-session-import/plan.md
specs/002-agent-session-import/tasks.md
specs/003-llm-distill-agent-guidance/spec.md
specs/003-llm-distill-agent-guidance/plan.md
specs/003-llm-distill-agent-guidance/tasks.md

tests/db/client.test.ts
specs/013-low-priority-audit-cleanup/spec.md
specs/013-low-priority-audit-cleanup/plan.md
specs/013-low-priority-audit-cleanup/tasks.md
specs/004-transcript-jsonl-import/spec.md
specs/004-transcript-jsonl-import/plan.md
specs/004-transcript-jsonl-import/tasks.md
specs/005-audit-alignment/spec.md
specs/005-audit-alignment/plan.md
specs/005-audit-alignment/tasks.md
specs/006-mcp-agent-usability/spec.md
specs/006-mcp-agent-usability/plan.md
specs/006-mcp-agent-usability/tasks.md
specs/007-mcp-agent-polish-and-boundary-tests/spec.md
specs/007-mcp-agent-polish-and-boundary-tests/plan.md
specs/007-mcp-agent-polish-and-boundary-tests/tasks.md
specs/008-deep-audit-remediation/spec.md
specs/008-deep-audit-remediation/plan.md
specs/008-deep-audit-remediation/tasks.md
```

## Next Step

1. 进入 Phase 5 Obsidian-ready Markdown Vault 展示层。
2. 继续用真实 Codex / Claude Code 会话观察候选质量并校准自动接受策略。
3. 观察 Briefing 与 lifecycle history 的实际可读性，再决定 post-MVP 分支历史需求。

## Notes For Next Agent

- All MVP phases are implemented locally.
- P0 Agent Session Import currently supports Markdown files for `codex`, `claude-code`, and `markdown`.
- P1 LLM Distill currently uses a provider-neutral prompt + reviewed candidate JSON workflow.
- P2 JSONL import normalizes transcript records into Markdown Thread text while preserving `rawFormat=jsonl`.
- Phase 1 automatically injects Context Bundle at SessionStart and captures Codex/Claude Code transcripts on lifecycle Hooks.
- Schema v2 persists capture cursors so unchanged transcripts are skipped and failed imports remain retryable.
- Schema v3 adds idempotent distill jobs and evidence-backed memory candidates.
- Phase 2 supports Agent-submitted candidates plus an optional OpenAI-compatible Provider; both share the same trust policy.
- Low-risk candidates require confidence >= 0.9 and exact Thread evidence for auto-acceptance; high-impact, low-confidence and conflicting items remain reviewable.
- Candidate review is bound to a Thread input hash, project-wide duplicate Memory is linked instead of rewritten, and Provider calls preflight common secret patterns.
- Running distill jobs use a five-minute recovery lease and detached spawn errors are handled without crashing Hook execution.
- Schema v4 adds active/superseded/archived/rejected states, immutable successor chains and a lifecycle event ledger.
- Default list/search/context only use active Memory; archive/restore and candidate supersede preserve auditable history.
- Schema v5 adds versioned deterministic Project Briefings with exact Memory, Thread and Working Memory provenance.
- Context Bundle proactively refreshes stale Briefings and budgets Working Memory, Briefing, warnings and relevant Memory in that order.
- Project-local absolute-path integration configs are protected through a managed `.git/info/exclude` block.
- Real Mira status reports Codex and Claude Code hooks/MCP installed; SessionStart output, live transcript capture, and static transcript cursor idempotency were smoke-tested with the built CLI.
- Audit alignment keeps existing kinds and CLI flags while adding planned kinds and compatibility aliases.
- MCP usability hardening replaces placeholder tool descriptions and validates kind values at runtime.
- MCP agent polish adds `search_memory.kind`, optional MCP `save_thread.id`, config prerequisites, and boundary tests.
- Deep audit remediation adds FTS cleanup, deletion APIs, improved Context Bundle, distill fallback, export threads, CLI UX polish, shared MCP sessions, and JSONL spec alignment.
- Infrastructure audit remediation adds bounded search, top-N bundle retrieval, WAL/busy_timeout, schema indexes/version checks, safer distill replacement, CLI validation, package readiness metadata, docs corrections, MCP error wrapping, and portability polish.
- Post-fix audit hardening aligns thread deletion semantics, hardens MCP schema/direct-call validation, removes the legacy MCP `thread` alias, improves MCP error wrapping, and adds defensive tests for OR search and duplicate race fallback.
- Hardening audit budget and CLI guards apply context maxCharacters to warnings, stop budget filling on the first oversized entry, harden MCP query/tool-name validation, validate CLI kind values, and cover addMemory catch fallback.
- Budget guards medium polish adds thread_id indexing, defensive OR-term query handling, clearer MCP return-shape/rawFormat descriptions, and blank search regression coverage.
- Local branch still needs explicit user confirmation before push.
- Do not commit `.mira/`, `dist/`, `node_modules/`, `.env`, or temporary exports.
