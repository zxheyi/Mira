# MCP Agent Usability Plan

Feature ID: `006-mcp-agent-usability`
Status: Implemented

## Approach

Use a small, backward-compatible MCP hardening pass:

1. Add failing MCP tests for descriptions and invalid kind arguments.
2. Export concrete MCP tool descriptions from `src/mcp/server.ts`.
3. Add runtime kind guards using the existing kind arrays.
4. Keep all existing MCP tool names and argument names stable.
5. Update the MVP plan document to reflect the implemented kind superset.
6. Run full tests and build.

## Design Notes

- Runtime validation must check the arrays, not TypeScript assertions.
- Error messages should name the unsupported kind and list the supported values.
- Tool descriptions should be short English sentences because MCP clients expose them directly to coding agents.
