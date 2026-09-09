# Trust hardening

## Explicit authority (PR 1)

Absent policies, missing scopes, and empty scopes deny governed operations. Local CLI and authenticated same-origin Viewer actions supply explicit scopes for their operations. MCP tool profiles select available tools; they never grant authority.

For a trusted local stdio host, configure both `--confirmation-policy <reason>` and `--allow-scopes <comma-separated scopes>`. A confirmation reason alone grants no governed operation. The optional `--development-legacy-broad` flag explicitly enables the old broad policy for development; it requires a confirmation policy and cannot be combined with allow-scopes. Runtime status reports this mode as `development_legacy_broad`. Do not use it for production delegation.

This is an in-process capability model. It does not authenticate a remote host or constrain a process that can write the SQLite database. Remote transport remains unsupported; an external issuer, audience binding, credential verification, expiry/revocation and replay rules require a separate deployment design.

Test discovery is restricted to this repository's `tests/` directory, so local nested worktrees are not accidentally executed as part of the suite.

## Selection manifests (PR 2)

New generic and Research receipts include a versioned selectionManifest: immutable input fingerprint, policy/ordering, input versions/hashes, selected and omitted entries, section/rank, body cost, total cost, shared overhead and output hash. Evidence references include evidence, verification and snapshot versions/hashes. Costs use the existing UTF-8 byte token upper bound, not a model-specific tokenizer. Entries remain atomic; shared headings and status text account for overhead.

Generic retrieval records its bounded pool and query mode. IDs absent from that pool are `not_in_candidate_pool`, not assumed budget failures. Research coverage is all Claims in the requested Case. Existing receipts remain readable without invented manifests. A manifest proves which identified inputs and policy were used; hashes alone cannot reconstruct deleted source bodies or reproduce an unavailable historical ranking implementation.

## Event and Outbox contracts (PR 3)

Domain events and Outbox topics have strict allowlists, a 16 KiB UTF-8 payload ceiling and sensitive-value rejection. Metadata has bounded IDs and timestamps. Unknown event types and extra fields are rejected before insertion. Source URLs are represented by hashes in domain events; full source data stays in its source store. Outbox links must refer to an event in the same project. Workers validate persisted payloads again before invoking handlers, including legacy rows.

Schema v17 stores detailed Research recall receipts in research_context_recalls. Research domain events retain receipt IDs and hashes only. Existing full-receipt events remain readable without retroactively rewriting their history.

`mira outbox prune` removes payloads only from completed messages: projection requests after one day; capture/distillation and evidence-verification requests after seven days. It retains message identity, status, completion time, handler receipts and all domain events. Pending, running and failed work is never pruned, so retries and recovery keep their input. Pruning is explicit maintenance, not a claim that a background scheduler has run. Lifecycle transcript/result retention and context payload TTL remain separate policies.
