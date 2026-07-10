# JSONL Import Contract

## CLI

```bash
mira import --source <codex|claude-code> --format jsonl --path <file>
```

## Supported Format Values

- `auto`
- `markdown`
- `jsonl`

## Normalized Thread

```ts
type NormalizedAgentSession = {
  id: string;
  source: "codex" | "claude-code" | "markdown";
  title: string;
  rawFormat: "markdown" | "jsonl";
  rawText: string;
  metadata: {
    inputPath: string;
  };
};
```

## Error Semantics

- Unsupported format throws `Unsupported agent session format`.
- Invalid JSONL line throws `Invalid JSONL on line <n>`.
- A JSONL file with no importable messages throws `No messages found in JSONL transcript`.
