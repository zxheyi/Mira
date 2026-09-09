# Trust hardening

## Explicit authority (PR 1)

Absent policies, missing scopes, and empty scopes deny governed operations. Local CLI and authenticated same-origin Viewer actions supply explicit scopes for their operations. MCP tool profiles select available tools; they never grant authority.

For a trusted local stdio host, configure both `--confirmation-policy <reason>` and `--allow-scopes <comma-separated scopes>`. A confirmation reason alone grants no governed operation. The optional `--development-legacy-broad` flag explicitly enables the old broad policy for development; it requires a confirmation policy and cannot be combined with allow-scopes. Runtime status reports this mode as `development_legacy_broad`. Do not use it for production delegation.

This is an in-process capability model. It does not authenticate a remote host or constrain a process that can write the SQLite database. Remote transport remains unsupported; an external issuer, audience binding, credential verification, expiry/revocation and replay rules require a separate deployment design.

Test discovery is restricted to this repository's `tests/` directory, so local nested worktrees are not accidentally executed as part of the suite.

## Selection manifests (PR 2)

New generic and Research receipts include a versioned selectionManifest: immutable input fingerprint, policy/ordering, input versions/hashes, selected and omitted entries, section/rank, body cost, total cost, shared overhead and output hash. Evidence references include evidence, verification and snapshot versions/hashes. Costs use the existing UTF-8 byte token upper bound, not a model-specific tokenizer. Entries remain atomic; shared headings and status text account for overhead.

Generic retrieval records its bounded pool and query mode. IDs absent from that pool are `not_in_candidate_pool`, not assumed budget failures. Research coverage is all Claims in the requested Case. Existing receipts remain readable without invented manifests. A manifest proves which identified inputs and policy were used; hashes alone cannot reconstruct deleted source bodies or reproduce an unavailable historical ranking implementation.
