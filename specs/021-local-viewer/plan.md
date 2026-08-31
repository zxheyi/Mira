# Phase 7 Local Viewer Implementation Plan

This records the original Viewer implementation. The current management/recovery extension and verification boundary are in [025](../025-recovery-and-management-ui/spec.md); its contract supersedes the original read-only scope below.

**Goal:** Build `mira ui`, a local-only read-only dashboard for inspecting project Mira data.

**Architecture:** Add a focused viewer data module that reads existing SQLite stores and SQL counts, then a small Node `http` server that exposes JSON API routes and a single-page app. The CLI starts the server using the existing global project/db resolution and migration path.

**Tech Stack:** TypeScript, Node built-in `http`, `better-sqlite3`, existing Mira stores, Vitest.

---

### Task 1: Viewer Data API

**Files:**
- Create: `src/ui/viewerData.ts`
- Test: `tests/ui/viewerData.test.ts`

- [x] Write failing tests for overview, thread list/detail, briefing, context bundle, and import runs.
- [x] Implement read-only viewer data helpers using existing stores and focused SQL counts.
- [x] Run targeted tests until green.

### Task 2: Viewer HTTP Server

**Files:**
- Create: `src/ui/viewerServer.ts`
- Test: `tests/ui/viewerServer.test.ts`

- [x] Write failing tests for `/`, `/api/overview`, `/api/threads`, `/api/threads/:id`, `/api/import-runs`, `/api/briefing`, `/api/context-bundle`, and 404.
- [x] Implement a small Node `http` server with JSON error handling.
- [x] Run targeted tests until green.

### Task 3: CLI and Docs

**Files:**
- Modify: `src/index.ts`
- Modify: `README.md`
- Test: `tests/cli/ui-cli.test.ts`

- [x] Write failing CLI help test for `mira ui`.
- [x] Add `mira ui` command with host/port options and startup JSON.
- [x] Document `mira ui` as local-only read-only viewer.
- [x] Run targeted and full verification.
