# Mira MVP Tasks

Feature ID: `001-mira-mvp`
Status: In Progress

This is the SDD task source for implementation. The older MVP plan remains useful background, but this file is the compact execution checklist.

## Phase 1: Skeleton and Storage Foundation

- [x] Create `package.json` with build, dev, test, and bin settings.
- [x] Install TypeScript, tsx, Vitest, commander, better-sqlite3, and MCP SDK dependencies.
- [x] Create strict `tsconfig.json`.
- [x] Create `.gitignore` for `node_modules/`, `dist/`, `.mira/`, `.env`, `.DS_Store`.
- [x] Implement `src/index.ts` with `mira health`.
- [x] Add CLI smoke test for `mira health`.
- [x] Implement `openDatabase(path)`.
- [x] Implement `migrate(db)` with schema version `1`.
- [x] Add schema tests for required tables and fields.
- [x] Verify `npm test`, `npm run build`, and `npm run dev -- health`.

## Phase 2: Core Data Loop

### Phase 2.1: Project Root Detection

- [ ] Write failing `tests/projects/projectRoot.test.ts`.
- [ ] Implement `detectProjectRoot(startDir)`.
- [ ] Cover nearest `.git` parent lookup.
- [ ] Cover fallback to `startDir` when `.git` is absent.
- [ ] Verify `npm test -- tests/projects/projectRoot.test.ts`.

### Phase 2.2: Project Store

- [ ] Write failing `tests/projects/projectStore.test.ts`.
- [ ] Implement `createProject(db, { name, rootPath })`.
- [ ] Implement `findProjectByRoot(db, rootPath)`.
- [ ] Implement `ensureProjectForRoot(db, rootPath)`.
- [ ] Implement `listProjects(db)`.
- [ ] Verify `npm test -- tests/projects/projectStore.test.ts`.

### Phase 2.3: Thread Store

- [ ] Write failing `tests/threads/threadStore.test.ts`.
- [ ] Implement `saveThread(db, { id, projectId, title, source, rawFormat, rawText })`.
- [ ] Support updating an existing Thread.
- [ ] Verify `npm test -- tests/threads/threadStore.test.ts`.

### Phase 2.4: Memory Store and Search

- [ ] Write failing `tests/memory/memoryStore.test.ts`.
- [ ] Define Memory kinds.
- [ ] Implement `addMemory`.
- [ ] Implement idempotent content-hash behavior.
- [ ] Implement `clearMemoriesForThread`.
- [ ] Implement `searchMemories` returning `{ memory, score }`.
- [ ] Verify `npm test -- tests/memory/memoryStore.test.ts`.

## Phase 3: Working Memory and Context

- [ ] Implement Working Memory set/list/clear.
- [ ] Implement deterministic distill rules.
- [ ] Implement clear-before-write distill orchestration.
- [ ] Implement Context Bundle generation with Working Memory first.

## Phase 4: CLI Commands and Export

- [ ] Implement `mira init`.
- [ ] Implement project commands.
- [ ] Implement thread commands.
- [ ] Implement memory commands.
- [ ] Implement working memory commands.
- [ ] Implement context bundle command.
- [ ] Implement Markdown / JSON export.

## Phase 5: MCP Agent Interface

- [ ] Implement MCP server factory.
- [ ] Implement stdio transport.
- [ ] Add `get_context_bundle`.
- [ ] Add `search_memory`.
- [ ] Add `set_working_memory`.
- [ ] Add `list_working_memory`.
- [ ] Add `clear_working_memory`.
- [ ] Add `add_memory`.
- [ ] Add `save_thread`.
- [ ] Add MCP tool integration tests.

## Phase 6: End-to-End Validation

- [ ] Import session `019f45f0-40bf-7261-8685-d5e0a6a8bf13`.
- [ ] Run save -> distill -> search -> working memory -> bundle -> export loop.
- [ ] Add `tests/integration/localLoop.test.ts`.
- [ ] Verify `npm test` and `npm run build`.

## Current Next Task

Start Phase 2.1: project root detection.
