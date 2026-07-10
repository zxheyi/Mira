# Mira MVP Spec

Feature ID: `001-mira-mvp`
Status: In Progress
Last updated: 2026-07-10
Primary user: the local developer and coding agents working in the same project

## Summary

Mira is a local-first project memory system for coding agents. Its MVP must let Codex, Claude Code, Cursor, OpenClaw, and similar agents recover project context across sessions without requiring the user to repeatedly explain project goals, decisions, conventions, failed attempts, or current next steps.

Mira is not a general AI workspace, consumer memory product, hosted team service, or desktop coworker. The MVP is intentionally narrow: project-level continuity memory for development workflows.

## Problem

Coding agents lose context between sessions and across tools. Important information often lives only in chat transcripts: why a decision was made, what failed, what conventions were chosen, and what should happen next. Without a local memory layer, users repeat themselves and agents repeat mistakes.

## Goals

- Save agent sessions as project-associated Threads.
- Distill stable project Memory from Threads.
- Allow manual Memory writes when distillation misses important facts.
- Maintain Working Memory for the current project state.
- Search project Memory with a stable `SearchResult` contract.
- Generate a short Markdown Context Bundle for agents.
- Expose the workflow through CLI and MCP stdio tools.
- Keep data local, inspectable, exportable, and ignored from Git by default.

## Non-Goals

- No cloud sync.
- No multi-user accounts.
- No public web app.
- No billing.
- No general consumer personal memory.
- No email, Slack, meeting, browser, or calendar integrations in MVP.
- No vector database before SQLite FTS is working.
- No full knowledge graph UI in MVP.

## User Stories

### US1: Start a project with Mira

As a developer, I can initialize Mira in a project and run a health check so I know the CLI and local database foundation works.

Acceptance:

- `npm run dev -- health` outputs `mira:ok`.
- `npm test` passes.
- `npm run build` passes.
- `.mira/`, `node_modules/`, and `dist/` are ignored by Git.

### US2: Persist project memory data locally

As a developer, I can migrate a local SQLite database with the MVP schema so future commands can store Projects, Threads, Working Memory, and Memory records.

Acceptance:

- `schema_version` exists and records version `1`.
- `projects`, `threads`, `working_memory`, `memories`, and `memory_fts` exist.
- `threads` includes `raw_format`.
- `memories` includes `title`, `source`, `confidence`, and `content_hash`.
- `memory_fts` indexes both `title` and `content`.

### US3: Resolve project context automatically

As a developer or agent, I can run project-level commands from inside a repo without always passing `--project-root`.

Acceptance:

- Mira finds the nearest parent directory containing `.git`.
- If no `.git` exists, Mira uses the provided current directory.
- If the detected root is not in the database, Mira auto-creates a Project using the directory name.
- `mira project list` shows known Projects.

### US4: Save and search Memory

As an agent, I can write and search durable project Memory so future sessions can recover important context.

Acceptance:

- Manual `addMemory` supports `title`, `kind`, `content`, `source`, `confidence`, and `importance`.
- Duplicate memories are prevented with `content_hash`.
- Search returns `SearchResult[]` with `{ memory, score }`.
- Search matches both `title` and `content`.

### US5: Maintain Working Memory

As an agent, I can update the current project snapshot so a new session can quickly know the current task, blockers, and next steps.

Acceptance:

- Working Memory supports set, list, and clear.
- One record exists per `projectId + kind`.
- Multiple blockers or next steps are stored as Markdown list content.
- Context Bundle prints Working Memory before long-term Memory.

### US6: Expose memory to agents through MCP

As a coding agent, I can use Mira through MCP tools without relying on a human to run CLI commands after every session.

Acceptance:

- MCP stdio server can bind to a project root and db path.
- MCP tools cover `get_context_bundle`, `search_memory`, `set_working_memory`, `list_working_memory`, `clear_working_memory`, `add_memory`, and `save_thread`.
- `save_thread` stores an agent-generated summary or key excerpt in MVP, not an assumed full transcript.
- MCP tool integration tests cover the core read/write loop.

## Requirements

### Functional Requirements

- FR1: Mira must provide a TypeScript CLI entrypoint.
- FR2: Mira must provide a `health` command that prints `mira:ok`.
- FR3: Mira must create and migrate SQLite schema version `1`.
- FR4: Mira must support Project, Thread, Memory, Working Memory, and FTS data structures.
- FR5: Mira must detect project roots from the current directory.
- FR6: Mira must auto-create Projects for detected roots that do not exist.
- FR7: Mira must save Threads with `raw_format` and raw text.
- FR8: Mira must write Memories with `title`, `source`, `confidence`, `content_hash`, and `importance`.
- FR9: Mira must search Memory via FTS over `title` and `content`.
- FR10: Mira must return search results as `{ memory, score }`.
- FR11: Mira must support Working Memory set, list, and clear.
- FR12: Mira must generate a Markdown Context Bundle.
- FR13: Mira must export project memory as Markdown and JSON.
- FR14: Mira must expose agent-facing MCP stdio tools.
- FR15: Mira must provide Agent configuration and behavior guidance docs.

### Non-Functional Requirements

- NFR1: Default data storage must be local.
- NFR2: Runtime data under `.mira/` must not be committed.
- NFR3: CLI output should be script-friendly.
- NFR4: MVP implementation must remain small: Node.js, TypeScript, SQLite, CLI, MCP.
- NFR5: New behavior must be covered by tests written before implementation.

## Assumptions

- The MVP is single-user and local-only.
- The first storage backend is SQLite with FTS5.
- Each project owns its local `.mira/mira.sqlite` by default.
- The MVP uses one MCP stdio server per project.
- Agents can save summaries, but automatic full transcript capture is post-MVP.

## Current Progress

Completed:

- Phase 1.1: TypeScript CLI skeleton and `health` command.
- Phase 1.2: SQLite client, schema migration, schema tests.
- Phase 2.1: Project root detection.
- Phase 2.2: Project Store.
- Phase 2.3: Thread Store.
- Phase 2.4: Memory Store and Search.
- Phase 3: Working Memory and Context.

Next:

- Phase 4: CLI Commands and Export.

Progress pointer: `.agents/progress.md`.
