# Phase 7 Local Viewer

## Goal

Add a local-only web viewer so a user can inspect Mira project data without opening SQLite or browsing raw vault files manually. Management extensions and recovery acceptance are specified in [025](../025-recovery-and-management-ui/spec.md).

## Requirements

### R1 CLI Server

Add `mira ui` to start a local HTTP server for the current project.

- Default host: `127.0.0.1`.
- Default port: `4317`.
- `--host <host>` overrides the loopback bind host (127.0.0.1, localhost, ::1 only).
- `--port <port>` overrides the port. `0` is allowed for tests and lets the OS assign a port.
- The command prints JSON containing `url`, `host`, `port`, `projectRoot`, and `dbPath` once the server is listening.
- The command keeps running until interrupted.
- It must not open a browser automatically.

### R2 Read-Only Data API

The viewer server must expose read-only JSON endpoints:

- `GET /api/overview`: project, database size, counts, integration status, latest import run, and latest briefing summary.
- `GET /api/threads`: list threads for the current project with metadata and preview text, excluding full raw text.
- `GET /api/threads/:id`: return one thread with full raw text.
- `GET /api/import-runs`: list recent import runs.
- `GET /api/briefing`: return the latest complete Project Briefing without rebuilding stale data; null when absent.
- `GET /api/context-bundle`: preview the same context preparation logic without recording a receipt or refreshing Briefing.

All API routes must bind to the project selected by global `--project-root` and `--db`.

### R3 Dashboard UI

Serve a single-page HTML app at `/` with an Operations Dashboard layout:

- Default UI language is Simplified Chinese.
- Left navigation: 总览、会话、导入批次、简报、记忆.
- Overview shows project root, db size, thread/memory/candidate/import counts, latest import, and integration status with Chinese labels.
- Threads view shows a list and a detail pane for transcript Markdown with Chinese empty states and metadata labels.
- Import Runs view shows recent batch status and counts with Chinese labels.
- Briefing view shows Project Briefing and Context Bundle under Chinese section titles.
- Memory view shows current memory count and a Chinese empty state when no memories exist.

The management extension adds candidate review, immutable correction, archive/restore, history, recall audit and job retry as defined in 025. No hard-delete, import, provider-call or integration-install buttons.

### R4 Safety

- The server must only serve the built-in app and API for the bound project.
- Unknown routes return 404.
- API errors return JSON with an `error` string and status 500.
- No external network requests from the served HTML.

## Non-Goals

- Local-only access, exact Host checking and same-origin CSRF protection; no remote bind.
- No browser auto-open.
- No automatic approval from browsing or previewing.
- No LLM distillation trigger from the UI.
- No multi-project registry.

## Acceptance

- TDD tests cover viewer data summaries, server API routes, and the CLI help surface.
- `npm run build` passes.
- Relevant and full tests pass.
- README documents `mira ui`, local-only write safety and the management boundary.
