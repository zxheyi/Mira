# Interaction Lifecycle Context

Interaction Lifecycle translates host-specific activity into one project-scoped turn protocol. It coordinates recall and capture without deciding whether a Memory or Research Claim is true.

## Language

**Host**:
An external surface that starts or completes work through Mira, such as Codex, Claude Code, Cursor, CLI, MCP, or Viewer.
_Avoid_: Agent, integration

**Host Adapter**:
A translator between one Host's event shape and the Turn Lifecycle Port.
_Avoid_: memory policy, research policy

Adapters declare whether they represent a content-producing **Source Host** (Codex, Claude Code, Cursor) or an invocation **Transport** (CLI, MCP, Viewer). Both use the same lifecycle contract; Turn Domain Events record both `sourceHost` and `transport` when a Source Host enters through a Transport.

**Lifecycle Session**:
A project-scoped sequence of related Host turns with a stable Host identity.
_Avoid_: Thread, task

**Turn**:
One user request and its resulting Host outcome inside a Lifecycle Session.
_Avoid_: Thread, message

**Before Turn**:
The phase that prepares audited project context before a Host acts.
_Avoid_: search, prompt

**After Turn**:
The phase that records the completed outcome and requests downstream capture work.
_Avoid_: distillation, approval

**Capture Record**:
The immutable project-scoped record of one completed Turn.
_Avoid_: Memory, Thread

**Quarantine**:
The state in which extracted proposals remain non-authoritative until Project Memory or Investment Research policy accepts them.
_Avoid_: rejected, archived

**Domain Event**:
An append-only statement that a committed domain transition occurred.
_Avoid_: diagnostic log

**Outbox Message**:
A durable request for retryable work emitted in the same transaction as its Domain Event.
_Avoid_: Domain Event, background process
