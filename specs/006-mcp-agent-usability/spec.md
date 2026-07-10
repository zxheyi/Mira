# MCP Agent Usability Spec

Feature ID: `006-mcp-agent-usability`
Status: Complete

## Goal

Resolve the top MCP usability and safety findings from the MVP audit so an agent can understand Mira tools and cannot write unsupported kinds through MCP.

## Scope

- Replace placeholder MCP tool descriptions with precise agent-facing descriptions.
- Add runtime whitelist validation for `MemoryKind` and `WorkingMemoryKind` arguments in MCP tool handlers.
- Add MCP abnormal-path tests for missing arguments and invalid kinds.
- Synchronize the historical MVP plan kind lists with the implemented compatible superset.

## Non-Goals

- No transport-level stdio end-to-end implementation in this phase.
- No MCP connection pooling.
- No global multi-project MCP server.

## Acceptance Criteria

- MCP tool descriptions are exported/testable and are not placeholder strings.
- `add_memory` rejects unsupported Memory kinds before database write.
- `set_working_memory` and `clear_working_memory` reject unsupported Working Memory kinds.
- Missing required MCP arguments still produce explicit errors.
- `npm test` and `npm run build` pass.
