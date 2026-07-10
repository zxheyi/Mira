# Audit Alignment Contract

## Memory Kind Superset

Required planned values:

- `decision`
- `convention`
- `architecture`
- `preference`
- `task`
- `fact`
- `failed_attempt`

Backward-compatible extension values:

- `lesson`
- `constraint`
- `todo`
- `note`

## Working Memory Kind Superset

Required planned values:

- `current_task`
- `current_phase`
- `recent_decision`
- `blocker`
- `next_step`
- `preference`

Backward-compatible extension values:

- `decision`
- `note`

## Search Ordering

```sql
importance desc,
confidence desc,
score desc,
created_at desc
```

## CLI Compatibility

```bash
mira thread save --id t1 --title T --source codex --raw-format markdown --file ./session.md
mira memory search "query"
```
