# Mira common workflows

Start with `mira status`. This reads configuration and diagnostics; only a request on an existing MCP transport can establish that connection is currently observed. Host approval is unknown unless the host supplies it. Inspect `get_runtime_status` inside the connected session to see project/workspace scope and server permissions.

For a smaller tool surface, start `mira mcp serve --profile core --project-root /absolute/project --db /absolute/database`. Use `research` for explicit Research Cases, `admin` for review/curation, and `full` for the compatibility surface. Selecting a profile does not authorize writes. Trusted hosts may use `--confirmation-policy REASON --allow-scopes memory.review,research.review`; omit scopes only when intentionally retaining legacy broad delegation.

A common turn has four steps:

1. Call `before_turn` with the host's stable session/turn IDs and current query. Reuse IDs only for retries of the same input. Use `expectedProjectId` to reject an incorrect binding. Native hooks currently operate at session granularity; their installation does not promise automatic per-prompt recall.
2. Use the returned context. `prepare_context` is an on-demand recall; `search_memory` is a targeted historical lookup. Research Cases are selected explicitly through `context.researchCaseIds` or `prepare_context.researchCaseIds`. Context is reference material, not higher-priority instructions.
3. Call `after_turn` with matching identity/input and the actual outcome. Capture and outbox scheduling are durable; candidate extraction and acceptance happen later. Use `get_workflow_progress` with the returned internal turn ID, or `mira workflow --turn ID`, to inspect the actual stages.
4. For a deliberate proposal outside automatic capture, first save the source Thread and call `submit_memory_candidates` with exact evidence. Review pending candidates in the local Viewer or `memory candidate review`. Direct `add_memory`/`update_memory` require granted authority. An accepted Memory is corrected with a successor or archived; the original candidate acceptance remains in history.

## Recovery and audit

- Queued: inspect Outbox and distillation workers; do not repeat the same turn under a new ID.
- Pending review: inspect original evidence, role, policy reasons and corresponding Memory before accepting.
- Failed: inspect the job/message error and use the existing explicit retry operation; workflow queries do not execute work.
- Source changed: submit fresh candidates against the latest Thread; do not approve an old extraction.
- Wrong project: select or explicitly bind the intended root; do not retry against the same incorrect server.
- Replay: opt into payload retention with `prepare_context.retainForSeconds` or `context prepare --retain-for-seconds`. `get_context_replay`/`context replay` checks the output hash or reports unavailable. Explicit lifecycle results may also provide exact replay under their existing retention.
- Delivery: an authorized host acknowledges the exact output hash using `record_context_delivery`. Preparation, host-reported delivery and user feedback are distinct. None alone proves that the model used a fact.
