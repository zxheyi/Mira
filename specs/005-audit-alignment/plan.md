# Audit Alignment Plan

Feature ID: `005-audit-alignment`
Status: Implemented

## Compatibility Strategy

The implementation will use superset enums instead of replacing existing values:

- Existing `lesson`, `constraint`, `todo`, and `note` remain valid.
- Planned `task`, `fact`, and `failed_attempt` become first-class Memory kinds.
- Existing `decision` and `note` Working Memory values remain valid.
- Planned `current_phase` and `recent_decision` become first-class Working Memory kinds.

This keeps current databases and tests valid while making the implementation satisfy the original plan.

## Implementation Steps

1. Extend kind arrays and TypeScript unions.
2. Add deterministic heading mappings.
3. Update importance defaults for new Memory kinds.
4. Reorder FTS search by importance, confidence, score, created_at.
5. Add CLI aliases and file-reading support.
6. Update README / `.agents` progress after verification.
