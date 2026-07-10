# Agent Session Import Contract

## Supported Sources

- `codex`
- `claude-code`
- `markdown`

## P0 Supported Formats

- `markdown`

## Normalized Session

```ts
type NormalizedAgentSession = {
  id: string;
  source: "codex" | "claude-code" | "markdown";
  title: string;
  rawFormat: "markdown";
  rawText: string;
  metadata: {
    inputPath: string;
  };
};
```

## CLI Contract

```bash
mira import --source <codex|claude-code|markdown> --path <file> [--id <id>] [--title <title>]
```

Output: saved Mira Thread JSON.
