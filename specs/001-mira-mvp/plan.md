# Mira MVP Plan

Feature ID: `001-mira-mvp`
Status: In Progress
Source spec: `specs/001-mira-mvp/spec.md`

## Technical Context

- Language: TypeScript
- Runtime: Node.js
- CLI: `commander`
- Database: SQLite via `better-sqlite3`
- Search: SQLite FTS5
- Tests: `vitest`
- Dev runner: `tsx`
- Agent interface: MCP TypeScript SDK

## Design Decisions

### Local-first storage

Mira stores runtime data locally. The project-local default database path is `.mira/mira.sqlite`, and `.mira/` is ignored by Git.

### Per-project MCP server

MVP uses one stdio MCP server per project. The server is launched with a bound `--project-root` and `--db`; tools may accept `projectRoot`, but default to the bound project.

### Project auto-creation

If a command detects a project root that does not exist in the database, Mira creates a Project using the root directory basename. `mira project add` remains useful for explicit naming or updates.

### Search contract

Search returns:

```ts
type SearchResult = {
  memory: Memory;
  score: number;
};
```

FTS matches `title` and `content`; score is normalized so higher means more relevant.

### Working Memory shape

Working Memory is one row per `projectId + kind`. Multiple blockers or next steps are encoded in Markdown list content.

## Implementation Phases

### Phase 1: Skeleton and Storage Foundation

Completed.

- TypeScript project skeleton.
- `mira health` CLI command.
- SQLite open helper.
- Schema version table.
- Project, Thread, Working Memory, Memory, and FTS tables.
- CLI and schema tests.

### Phase 2: Core Data Loop

Completed.

- Project root detection.
- Project Store.
- Thread Store.
- Memory Store with FTS search.

### Phase 3: Working Memory and Context

Completed.

- Working Memory set/list/clear.
- Deterministic distillation rules.
- Clear-before-write distill orchestration.
- Context Bundle generation.

### Phase 4: CLI Commands and Export

- Init, project, thread, memory, working, context, export commands.
- Script-friendly output.

### Phase 5: MCP Agent Interface

- MCP server factory.
- stdio transport.
- Agent-facing tools.
- Agent config examples.

### Phase 6: End-to-End Loop

- Import first real planning session.
- Run complete local loop.
- Add integration tests.

## Verification Strategy

Run narrow tests first, then broader checks:

```bash
npm test -- tests/projects/projectRoot.test.ts
npm test -- tests/projects/projectStore.test.ts
npm test -- tests/threads/threadStore.test.ts
npm test -- tests/memory/memoryStore.test.ts
npm test -- tests/workingMemory/workingMemoryStore.test.ts
npm test -- tests/context/contextBundle.test.ts
npm test -- tests/mcp/tools.integration.test.ts
npm test
npm run build
```

Current verified commands:

```bash
npm test
npm run build
npm run dev -- health
```

## Constraints

- Use SDD to change scope or contracts before implementation.
- Use TDD for new behavior.
- Do not add UI, cloud sync, vector DB, or external integrations in MVP.
- Do not commit `node_modules/`, `dist/`, `.mira/`, `.env`, or temporary exports.

## Open Items

- Phase 4 is the next implementation step.
- MCP and export behavior remain planned, not implemented.
