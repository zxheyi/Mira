---
status: accepted
date: 2026-09-01
---

# Route every host through one Turn Lifecycle Port

## Decision

Codex, Claude Code, Cursor, CLI, MCP, and Viewer translate their events through a Host Adapter and call one Turn Lifecycle Port. Before Turn owns Context Orchestration and recall audit; After Turn owns Capture Record persistence and durable requests for downstream processing. Host Adapters cannot implement Memory acceptance or Research review policy.

## Context

Mira previously integrated host hooks, CLI commands, MCP tools, and Viewer actions directly with lower-level modules. The implementations reused many domain functions, but no persisted Turn contract proved that recall and capture belonged to the same host interaction. Adding more Hosts in that shape would duplicate identity, idempotency, failure, and audit rules.

## Alternatives

- Keep independent host flows: fewer files initially, but lifecycle behavior and receipts drift across Hosts.
- Introduce a network lifecycle service: creates an operational boundary before Mira needs independent scaling.
- Use one in-process lifecycle module with Host Adapters: keeps a small public interface and one local transactional fact source.

## Consequences

- A Host must supply stable session and turn identities.
- Duplicate Before Turn and After Turn calls are idempotent.
- Existing Thread and Memory interfaces remain valid behind the lifecycle module.
- The module can later be hosted out of process without changing Host semantics, but no network service is introduced now.
