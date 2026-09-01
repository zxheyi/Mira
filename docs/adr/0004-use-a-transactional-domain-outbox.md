---
status: accepted
date: 2026-09-01
---

# Use a transactional Domain Event and Outbox ledger

## Decision

Domain transitions that require asynchronous follow-up append a Domain Event and an Outbox Message in the same SQLite transaction. Workers claim messages with a lease, record bounded retry state, and complete idempotently. Derived outputs consume committed state and never become a second fact source.

## Context

Mira already has durable distillation jobs and context/research audit tables, but follow-up work is scheduled separately by callers. A process failure between state commit and scheduling can therefore lose downstream work, while adding new pipelines would multiply job-specific recovery logic.

## Alternatives

- Best-effort callbacks after commit: small but permits lost work.
- A separate message broker: durable but operationally disproportionate for a local-first modular monolith.
- SQLite transactional outbox: preserves local reliability and can later feed another transport.

## Consequences

- Event and Outbox payloads contain identifiers and bounded metadata, not full sensitive transcripts.
- At-least-once delivery requires idempotent handlers.
- Existing job tables may remain specialized execution state while creation is driven through the Outbox.
