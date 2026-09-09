# Context trust implementation

This series preserves SQLite as the fact source and the existing lifecycle/curation boundaries. Each phase is a separate topic branch and PR; dependent branches must be merged in order after review.

1. Research eligibility: approval and recall require every linked support to be current, verified against a current snapshot, and valid at the Case as-of date. Historical approved records failing this rule are excluded on read, not rewritten. Briefing summaries distinguish approved from eligible claims.
2. Scope envelopes and expected-project guards.
3. Runtime status, scoped capabilities and actionable errors.
4. Whole-context budgets, selection audit and delivery semantics.
5. Candidate provenance, acceptance policy and correction navigation.
6. Workflow profiles and durable processing progress.
7. Migration and cross-entrypoint verification.

Phase 1 validation covers mixed expired/current supports and inclusive validity boundaries, in addition to the research lifecycle suite. Verification certifies snapshot/excerpt binding, not the correctness of Claim inference.

Phase 2: structured context packets carry schemaVersion, scope and generatedAt. Scope distinguishes the registered primary root from the invoking workspace and leaves absent session identity null. MCP context/lifecycle requests accept expectedProjectId; CLI accepts --expected-project-id; Viewer read requests accept the same query parameter. A mismatch is rejected before context/turn writes. Legacy Markdown consumers retain their string contract, including small-budget behavior.

Phase 3: `mira status [--json]`, MCP `get_runtime_status`, and Viewer `/api/status` report observations without business writes. CLI configuration cannot prove an MCP connection or server policy. Only a native MCP request reports a current connection; host approval always remains unknown. `mcp serve --confirmation-policy REASON --allow-scopes memory.review,research.review` narrows delegated operations. Omitting scopes preserves the explicitly labelled legacy broad delegation. Domain services enforce scopes, including batch replacements; tool arguments cannot grant them.

Phase 4: default context budgets are 12,000 characters and 36,000 UTF-8 bytes (a conservative token upper bound). `prepare_context` / `context prepare --research-cases` opt into explicit Cases under the same budget; lifecycle context accepts researchCaseIds. Receipts now include working-memory overrides/omissions, projection metadata, Memory and Claim selection reasons, scope and correlated Research recall IDs. Legacy fields remain readable.

`prepare_context.retainForSeconds` / `context prepare --retain-for-seconds` optionally retains exact rendered payloads for up to 86,400 seconds. Expired payloads cannot be replayed and are purged on the next audited preparation; audit receipts are never purged by this policy. Existing lifecycle results retain their existing lifetime. `get_context_replay` / `context replay` verifies the output hash or reports unavailable instead of reconstructing changed Working Memory. Host-reported delivery requires context.delivery authority and an exact output hash; it is separate from preparation and does not certify model use. Schema v15 adds disposable context_payloads without changing old receipt JSON.
