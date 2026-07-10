# Claude Code MCP Config Example

Use absolute paths so the MCP client does not depend on its startup cwd.

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

During local development, replace `node .../dist/src/index.js` with `npm run dev --` from the Mira repo only when your MCP client supports a working directory.

For project behavior guidance, copy or adapt [CLAUDE-template.md](CLAUDE-template.md) into the target project's `CLAUDE.md`.
