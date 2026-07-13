# Cursor MCP Config Example

Use one Mira server per project and keep paths absolute.

## Prerequisites

From the Mira repository:

```bash
npm install
npm run build
```

From the target project:

```bash
mira init
```

`mira init` creates the project record and the `.mira/` database directory when needed. If `mira` is not on your PATH yet, run it from the Mira repository with `npm run dev -- init` during local development.

## MCP Config

```json
{
  "mcpServers": {
    "mira": {
      "command": "node",
      "args": [
        "/absolute/path/to/Mira/dist/src/index.js",
        "mcp",
        "serve",
        "--project-root",
        "/absolute/path/to/project",
        "--db",
        "/absolute/path/to/project/.mira/mira.sqlite"
      ]
    }
  }
}
```

When calling `save_thread`, `id` is optional. Omit it to create a new generated `thread_...` id, or provide a stable id to update the same saved summary.

Expected agent behavior is documented in `docs/agent-config/AGENTS-template.md`.
