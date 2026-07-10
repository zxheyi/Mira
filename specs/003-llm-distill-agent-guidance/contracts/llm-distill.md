# LLM Distill Contract

## Prompt Command

```bash
mira memory llm-prompt --thread <thread-id>
```

Output: Markdown prompt with a strict JSON schema.

## Apply Command

```bash
mira memory apply-candidates --thread <thread-id> --path <json-file>
```

Output: saved Memory JSON array.

## Candidate Shape

```ts
type LlmMemoryCandidate = {
  title: string;
  kind:
    | "decision"
    | "convention"
    | "architecture"
    | "preference"
    | "lesson"
    | "constraint"
    | "todo"
    | "note";
  content: string;
  confidence?: number;
  importance?: number;
};
```

## Semantics

- Applying candidates replaces existing memories for the same Thread.
- Source is stored as `llm-distill:<threadId>`.
- Default `confidence` is `0.8`.
- Default `importance` is `5`.
