# Cursor MCP Config Example

Use one Mira server per project and keep paths absolute.

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

Expected agent behavior is documented in `docs/agent-config/AGENTS-template.md`.
