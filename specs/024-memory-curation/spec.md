# Unified memory curation

- Confirmed add/correct/archive/restore and candidate submit/review share a project-bound curation interface. CLI/MCP are adapters; UI will use the same service.
- Confirmed writes are explicit user/protocol operations, not model inference. Existing reviewed file import remains a confirmed batch operation. Automatic provider extraction must use candidates.
- Before persistence, all curation payload text is checked for recognizable secrets. Atomic corrections preserve predecessors and lifecycle events; invalid writes do not archive existing data.
- Exact source provenance is necessary but not semantic proof. Automatic acceptance additionally requires candidate content to occur verbatim in its evidence after whitespace normalization. Non-verbatim inferences remain pending even at confidence 1. Existing high-impact/conflict/low-confidence gates still apply.
- Architecture, decision and constraint candidates always require explicit review, including verbatim candidates with confidence 1. This policy applies to new candidates; it does not retroactively archive existing memories. Duplicate links to an already-active identical memory do not grant replacement authority or modify that memory.
- Explicit review can approve a paraphrase after rechecking source freshness. Approving a replacement uses the existing atomic successor mechanism. No curation operation writes investment thesis state; that domain protocol is outside this repository's memory runtime.
- Public tests cover ungrounded inference, confirmed-write secret rejection, CLI/MCP correction and audit history. No external provider calls are required.
