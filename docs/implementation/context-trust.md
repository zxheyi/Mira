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
