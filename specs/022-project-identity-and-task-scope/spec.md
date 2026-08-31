# Stable project identity and task scope

## Contract

- Preserve project IDs when a local Git repository is moved or renamed. Git worktrees use the main repository's default `.mira/mira.sqlite`; an explicit database path always wins.
- Record root aliases separately from project identity. Local Git identity is derived from the common Git directory's filesystem identity, not a remote URL; unrelated clones are never merged by remote name.
- A moved, single-project legacy default database may retain its existing project only when its previous root no longer exists. Ambiguous/shared databases require explicit binding by project ID.
- An existing Thread cannot be transferred between projects by upsert. Capture IDs remain compatible with existing histories.
- Working Memory supports optional task IDs. Unscoped callers retain the existing project-level interface; scoped reads and clears cannot affect another task. Context combines shared entries with the selected task's overrides, never other tasks.
- CLI `--task` and MCP task parameters select a task. Linked worktrees default to their workspace identity when no task is selected. Session hooks select their session task.
- Schema migration preserves all v6 rows, legacy Working Memory remains in the shared scope, and repeat migration is idempotent.

## Verification

Public project, Thread, Working Memory, CLI, MCP and context interfaces are the approved test seams. Use temporary repositories/databases. Verify rename, worktree sharing, independent-clone separation, task isolation, rejection of Thread reassignment, migration preservation and command compatibility. Run targeted tests, full tests, build and diff checks before the independent commit.
