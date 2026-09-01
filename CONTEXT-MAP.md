# Context Map

## Contexts

- [Interaction Lifecycle](./src/lifecycle/CONTEXT.md) — normalizes host turns and owns the before-turn recall and after-turn capture contract.
- [Project Memory](./src/memory/CONTEXT.md) — preserves project continuity through durable and transient memory.
- [Investment Research](./src/research/CONTEXT.md) — records evidence-constrained research cases, claims, and reviews.

## Relationships

- **Interaction Lifecycle → Project Memory**: before-turn preparation recalls project state; after-turn capture may submit Memory Candidates but never confirms them.
- **Interaction Lifecycle → Investment Research**: captured turns may propose research packets, but cannot verify Evidence or review Claims.
- **Investment Research → Project Memory**: reviewed stable methods or source facts may be proposed as Memory Candidates through the existing curation protocol.
- **Project Memory → Investment Research**: recalled Memory supplies prior context and source leads, not automatically revalidated Evidence Items.
- **Investment Research → Thesis Protocol**: a Thesis Impact Proposal is handed to an external domain review protocol; Mira does not execute the mutation.
