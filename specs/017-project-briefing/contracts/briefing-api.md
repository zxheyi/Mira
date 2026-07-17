# Project Briefing API Contract

## Core

- `rebuildProjectBriefing(db, projectId, options?) -> ProjectBriefing`
- `ensureFreshProjectBriefing(db, projectId, options?) -> ProjectBriefing | undefined`
- `getLatestCompleteProjectBriefing(db, projectId) -> ProjectBriefing | undefined`
- `listProjectBriefings(db, projectId, limit?) -> ProjectBriefing[]`

`ProjectBriefing` exposes `id`, `projectId`, `version`, `markdown`, source ID arrays, `generationMethod`, `characterCount`, `estimatedTokens`, `status`, optional `staleAt/error`, and `createdAt`.

## CLI

- `briefing show`: ensure fresh and print one JSON object or `null`.
- `briefing rebuild`: force a new version and print it.
- `briefing history --limit N`: newest-first JSON array, `1 <= N <= 100`.

## MCP

- `get_project_briefing {}`: ensure fresh and return `{ briefing }`.
- `rebuild_project_briefing {}`: force rebuild and return `{ briefing }`.
- `get_context_bundle.maxTokens`: integer `25..250000`.
