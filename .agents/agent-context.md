# Mira Agent Context

This file is the project entry card for coding agents working on Mira. It is inspired by Rowboat's `CLAUDE.md`, but scoped to Mira's current stage: project-level memory infrastructure for coding agents.

## Quick Reference

Current commands:

```bash
git -C /Users/limaolin/Desktop/Mira status --short
npm run dev -- health
npm test
npm run build
sed -n '1,260p' docs/superpowers/plans/2026-07-09-mira-mvp.md
sed -n '1,220p' .agents/development-rhythm.md
```

Planned MVP commands after later phases:

```bash
npm run dev -- init
npm run dev -- project list
npm run dev -- memory search "SQLite FTS"
npm run dev -- context bundle
npm run dev -- mcp serve --project-root /Users/limaolin/Desktop/Mira --db /Users/limaolin/Desktop/Mira/.mira/mira.sqlite
```

## Current Repository State

Mira has started MVP implementation. Phase 1.1 and 1.2 are complete: the TypeScript CLI skeleton, health command, SQLite connection, schema migration, and first tests exist.

Current tracked areas:

```text
Mira/
  README.md
  package.json
  package-lock.json
  tsconfig.json
  .gitignore
  src/
    index.ts
    db/
      client.ts
      schema.ts
  tests/
    cli-smoke.test.ts
    db/
      schema.test.ts
  .agents/
    agent-context.md
    development-rhythm.md
    progress.md
  specs/
    001-mira-mvp/
      spec.md
      plan.md
      tasks.md
  docs/
    agent-config/
      AGENTS-template.md
    research/
      nowledge-mem-analysis.md
      nowledge-mem-reverse-engineering.md
      rowboat-summary.md
    sessions/
      019f45f0-40bf-7261-8685-d5e0a6a8bf13.md
    superpowers/plans/
      2026-07-09-mira-mvp.md
```

The TypeScript project now exists. `.mira/` is still runtime data and must remain ignored. Later MVP phases will add more `src/` modules and tests.

## Source Of Truth

Read these first, in order:

1. `specs/001-mira-mvp/spec.md` — official what/why requirements.
2. `specs/001-mira-mvp/tasks.md` — compact execution checklist.
3. `.agents/progress.md` — current progress pointer and latest verification evidence.
4. `README.md` — positioning, scope, and design principles.
5. `.agents/agent-context.md` — quick project map and Agent entry context.
6. `.agents/development-rhythm.md` — SDD/TDD development rhythm.
7. `docs/superpowers/plans/2026-07-09-mira-mvp.md` — detailed historical MVP plan and acceptance gates.
8. `docs/agent-config/AGENTS-template.md` — target behavior for agents using Mira.

If these files disagree, treat `spec.md` and `tasks.md` as the implementation contract, then update the other docs to match.

## Product Focus

Mira is not a general AI workspace. Mira is a local-first project memory system for coding agents.

The MVP loop is:

```text
Thread save
  -> Memory distill / manual add
  -> Working Memory maintain
  -> Memory search
  -> Context Bundle output
  -> CLI / MCP access
  -> Agent writes back Thread / Memory after work
```

## Target Architecture

The MVP target stack is intentionally small:

| Layer | Planned Technology |
| --- | --- |
| Runtime | Node.js + TypeScript |
| Storage | SQLite + FTS5 |
| DB Driver | `better-sqlite3` |
| CLI | `commander` |
| Tests | `vitest` |
| Dev runner | `tsx` |
| Agent protocol | MCP TypeScript SDK |

No Electron, Next.js, vector database, queue, hosted service, multi-user account, or plugin marketplace in MVP.

## Target Build Order

Once the TypeScript project exists, implement in this order:

```text
schema / db client
  -> project root detection
  -> project store
  -> thread store
  -> memory store + FTS search
  -> working memory store
  -> distill + clear-before-write
  -> context bundle
  -> export
  -> CLI
  -> MCP server + stdio
  -> MCP tools integration
  -> local end-to-end loop
```

This order keeps lower-level data contracts stable before exposing CLI and MCP surfaces.

## Planned Key Files

| Purpose | Planned File |
| --- | --- |
| CLI entry | `src/index.ts` |
| DB connection | `src/db/client.ts` |
| Schema and migration | `src/db/schema.ts` |
| Project root detection | `src/projects/projectRoot.ts` |
| Project storage | `src/projects/projectStore.ts` |
| Thread storage | `src/threads/threadStore.ts` |
| Memory kinds | `src/memory/kinds.ts` |
| Memory storage/search | `src/memory/memoryStore.ts` |
| Distill rules | `src/memory/distill.ts` |
| Distill orchestration | `src/memory/distillThread.ts` |
| Working Memory | `src/workingMemory/workingMemoryStore.ts` |
| Context Bundle | `src/context/contextBundle.ts` |
| Exporter | `src/export/exporter.ts` |
| MCP server | `src/mcp/server.ts` |
| MCP stdio | `src/mcp/stdio.ts` |

## Important Contracts

### Project Resolution

- Explicit `--project-root` wins.
- Otherwise use `detectProjectRoot(process.cwd())`.
- If the root is missing in the database, automatically create Project with directory basename.
- `mira project add` is for explicit name creation/update, not a mandatory first step.

### Search Result

Search returns:

```ts
type SearchResult = {
  memory: Memory;
  score: number;
};
```

FTS searches both `title` and `content`. `score` is normalized so higher means more relevant.

### Working Memory

- One record per `projectId + kind`.
- Multiple blockers or next steps belong in Markdown list content.
- Use `clearWorkingMemory` / `mira working clear` when a kind becomes stale.

### MCP Runtime

MVP uses one stdio server per project:

```bash
mira mcp serve --project-root /abs/project --db /abs/project/.mira/mira.sqlite
```

MCP tools may accept `projectRoot`; if omitted, use the server-bound project.

### save_thread

In MVP, `save_thread` stores an Agent-generated summary or key excerpt. Do not pretend the Agent has access to a full transcript. Full transcript capture belongs to post-MVP hooks/adapters.

## Development Rhythm

Use SDD for direction and TDD for execution:

```text
SDD: decide scope, contracts, data model, CLI/MCP interfaces, acceptance gates.
TDD: write failing tests for each store/CLI/MCP behavior, then implement the smallest passing code.
```

Before implementation, read `.agents/development-rhythm.md`.

## Common Tasks

### Start A New MVP Phase

1. Read the relevant phase in `docs/superpowers/plans/2026-07-09-mira-mvp.md`.
2. Confirm the phase boundaries and acceptance gates.
3. Add or update tests first.
4. Implement the smallest code needed.
5. Run the phase-specific test, then broader tests.
6. Update checkboxes only after verification evidence exists.

### Change A Data Contract

1. Update the MVP plan first.
2. Update schema expectations.
3. Update store tests.
4. Update CLI/MCP docs if the contract is user-facing.
5. Then implement.

### Add A CLI Command

1. Add CLI smoke or behavior test.
2. Wire command to existing store/context/export functions.
3. Keep output script-friendly.
4. Document the command in the MVP plan if it changes scope.

### Add An MCP Tool

1. Define input/output shape in plan first.
2. Add tool-level test.
3. Reuse core store/context functions.
4. Confirm default project resolution uses bound project.
5. Avoid tool behavior that cannot be tested without a real client.

## Verification Commands

Use the narrowest relevant command first, then broaden:

```bash
npm test -- tests/db/schema.test.ts
npm test -- tests/memory/memoryStore.test.ts
npm test -- tests/mcp/tools.integration.test.ts
npm test
npm run build
```

If the Node project does not exist yet, verify documentation changes with:

```bash
git -C /Users/limaolin/Desktop/Mira diff --check
rg -n "TBD|TODO" README.md .agents docs
```

## Do Not Do In MVP

- Do not add cloud sync.
- Do not add a UI.
- Do not add vector search before SQLite FTS is working.
- Do not build a general personal memory product.
- Do not add integrations like email, Slack, browser, calendar, or meetings.
- Do not create a second competing plan outside the MVP plan.

## Research References

- `docs/research/rowboat-summary.md` — Rowboat architecture and product summary.
- `docs/research/nowledge-mem-analysis.md` — Nowledge Mem architecture lessons.
- `docs/research/nowledge-mem-reverse-engineering.md` — reverse analysis notes.
- Rowboat `CLAUDE.md`: https://github.com/rowboatlabs/rowboat/blob/main/CLAUDE.md
