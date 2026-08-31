# Unified memory curation

- Confirmed add/correct/archive/restore and candidate submit/review share a project-bound curation interface. CLI/MCP/UI are adapters.
- Confirmed writes are explicit user/protocol operations, not model inference. Existing reviewed file import remains a confirmed batch operation. Automatic provider extraction must use candidates.
- Before persistence, all curation payload text is checked for recognizable secrets. Atomic corrections preserve predecessors and lifecycle events; invalid writes do not archive existing data.
- Exact source provenance is necessary but not semantic proof. Automatic acceptance additionally requires candidate content to occur verbatim in its evidence after whitespace normalization. Non-verbatim inferences remain pending even at confidence 1. Existing high-impact/conflict/low-confidence gates still apply.
- Architecture, decision and constraint candidates always require explicit review, including verbatim candidates with confidence 1. This policy applies to new candidates; it does not retroactively archive existing memories. Duplicate links to an already-active identical memory do not grant replacement authority or modify that memory.
- Explicit review can approve a paraphrase after rechecking source freshness. Approving a replacement uses the existing atomic successor mechanism. No curation operation writes investment thesis state; that domain protocol is outside this repository's memory runtime.
- Public tests cover ungrounded inference, confirmed-write secret rejection, CLI/MCP correction and audit history. No external provider calls are required.

## Confirmed-write authority (schema v10)

- `authorizeCuration` issues an opaque in-process capability bound to one database connection and project. `curateMemory` requires it for every operation except proposal submission. Payload actor/source/confidence or a serialized capability cannot grant authority. This interface separates trusted application configuration from untrusted extraction; it is not a sandbox against local code or direct SQLite access.
- Local CLI mutation commands and CSRF-checked UI actions explicitly grant authority. Both reviewed-file and deterministic batch extraction require caller-supplied authority before archiving or writing anything. The background provider receives no capability and may only propose.
- MCP formal-memory writes are proposal-only by default. Host startup may explicitly delegate writes using `mira mcp serve --confirmation-policy "approved protocol reference"`. This authorizes that server's formal-memory operations as `mcp:protocol`; it is not per-command human confirmation. Tool arguments cannot enable it. Read tools, session saving and task Working Memory remain available without this delegation; Working Memory is not an approved formal-memory record.
- Successful confirmed operations write `curation_events` in the same transaction as their state changes. Receipts record host actor, authority reason, optional action reason, operation, outcome and target IDs, not memory/transcript bodies. `mira memory audit --limit 50` reads project-scoped receipts, including rejected candidate reviews. Failed operations leave neither changed state nor a success receipt. Target/project privacy hard deletion cascades to their receipts.
- The v9-to-v10 migration adds audit storage without rewriting existing memory. Before migrating a real database, back it up. Older runtimes reject schema v10; rollback requires restoring a matching backup, not reducing the version marker.

Implementation: [curation interface](../../src/memory/curationService.ts), [MCP adapter](../../src/mcp/server.ts). Tests: [curation](../../tests/memory/curationService.test.ts), [MCP](../../tests/mcp/tools.integration.test.ts), [CLI](../../tests/cli/memory-lifecycle-cli.test.ts).

## Reviewed batch lifecycle

- Deterministic extraction and reviewed JSON application both call `curateMemory` with `replace_thread`. They supply content and extraction method, not archive lists or lifecycle policy. The interface verifies authority, source-project ownership and the complete batch before committing any change.
- Only memories belonging to the selected project and Thread with `distill:<thread>` or `llm-distill:<thread>` sources are managed by a batch. Manual and candidate-derived records are preserved. An explicit correction defaults to `manual` source unless its caller explicitly supplies another source, so later batches do not silently archive a human correction; its predecessor remains traceable.
- Exact kind/content duplicates keep their identity. A unique same-kind, normalized-title match creates an immutable successor; ambiguous matches fail and roll back. Entries omitted from a non-empty reviewed batch are archived with reviewer attribution. No semantic matching is claimed.
- Empty batches are no-ops, not erase instructions. Invalid, sensitive, ambiguous or failed batches preserve all prior memory and success-audit state. All adds, corrections and archives are committed atomically through the same curation operations and audit policy.

Adapters: [deterministic extraction](../../src/distill/distillThread.ts), [reviewed file](../../src/distill/llmDistill.ts). Public batch coverage lives in the curation tests above.
