# Trust hardening

## Explicit authority (PR 1)

Absent policies, missing scopes, and empty scopes deny governed operations. Local CLI and authenticated same-origin Viewer actions supply explicit scopes for their operations. MCP tool profiles select available tools; they never grant authority.

For a trusted local stdio host, configure both `--confirmation-policy <reason>` and `--allow-scopes <comma-separated scopes>`. A confirmation reason alone grants no governed operation. The optional `--development-legacy-broad` flag explicitly enables the old broad policy for development; it requires a confirmation policy and cannot be combined with allow-scopes. Runtime status reports this mode as `development_legacy_broad`. Do not use it for production delegation.

This is an in-process capability model. It does not authenticate a remote host or constrain a process that can write the SQLite database. Remote transport remains unsupported; an external issuer, audience binding, credential verification, expiry/revocation and replay rules require a separate deployment design.

Test discovery is restricted to this repository's `tests/` directory, so local nested worktrees are not accidentally executed as part of the suite.
