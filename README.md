# Mira

**Local-first project memory for coding agents, with evidence-gated research.**

**English** | [简体中文](README.zh-CN.md)

Mira keeps project decisions, conventions, failed attempts, and next steps available across agent sessions. It stores source conversations and durable memories locally, then prepares bounded Markdown context for the next session. A separate research layer tracks evidence, claims, and reviews without changing investment theses, positions, or trades.

## What Mira does

- **Continue work across sessions.** Working Memory captures current goals, blockers, and next steps; durable Memory preserves decisions and lessons.
- **Connect coding agents.** Codex and Claude Code have automatic Hook/MCP installation. Cursor can connect through MCP.
- **Recover project history.** Import Codex and Claude Code transcripts, preview bulk imports, and inspect failures. Repeated imports recognize unchanged sessions.
- **Keep memory auditable.** Trace memories to source Threads, review candidates, and preserve correction and archival history.
- **Retrieve bounded context.** SQLite FTS5 search, project briefings, context budgets, and recall receipts help inspect what was selected or omitted.
- **Browse local data.** Use the CLI, local Viewer, Markdown/JSON exports, or an Obsidian-ready Markdown Vault.
- **Review research separately.** Research Cases track evidence, supporting and contradicting claims, verification, review, and stale sources.

Mira is under active development. It does not provide cloud sync, multi-user accounts, a hosted web app, or trade execution.

## Quick start

### 1. Build from source

Use **Node.js 24 or later**, npm, and Git. The package is currently marked private; use this repository rather than assuming an npm registry release exists.

```bash
git clone https://github.com/zxheyi/Mira.git
cd Mira
npm install
npm run build
node dist/src/index.js --help
```

To make `mira` available on your PATH:

```bash
npm link
```

Alternatively, replace `mira` in the examples below with `node /absolute/path/to/Mira/dist/src/index.js`. For source development, use `npm run dev -- <command>` from the Mira repository, passing `--project-root` when targeting another project.

### 2. Create memory in your project

Run these commands from the project you want Mira to remember:

```bash
cd /absolute/path/to/your-project
mira init
mira doctor
mira working set --kind current_task --content "Prepare the next release"
mira memory add --title "Test convention" --kind convention --content "Run relevant tests before opening a pull request." --source manual
mira memory search "tests"
mira context bundle --max-tokens 1000
```

`init` creates the project record and local database. Search returns the saved convention; the context bundle includes current working state and selected memories. This path does not require a model provider.

### 3. Browse your memory

```bash
mira ui
```

Open the URL printed by the command (default: `http://127.0.0.1:4317`). The Viewer currently has a Chinese interface and supports memory browsing, candidate review, research cases, and diagnostics. It binds to loopback only.

## Connect your agent

### Codex and Claude Code

Preview the project configuration changes, then install:

```bash
mira --project-root /absolute/path/to/your-project integration install --agent all --dry-run
mira --project-root /absolute/path/to/your-project integration install --agent all
mira --project-root /absolute/path/to/your-project integration status
```

Use `codex` or `claude-code` instead of `all` to configure one agent. Hooks inject context at session start and capture the main transcript at stop/end. Unchanged transcripts are skipped. Native hooks operate at **session granularity**; installation does not imply automatic recall before every prompt. Host trust approval may still be required.

To remove Mira-managed entries:

```bash
mira --project-root /absolute/path/to/your-project integration uninstall --agent all
```

See the [automatic integration guide (Chinese)](docs/agent-config/automatic-integration.md) for configuration files and troubleshooting.

### Cursor and other stdio MCP clients

Configure one server per project, using absolute paths. For clients that accept `mcpServers` configuration:

```json
{
  "mcpServers": {
    "mira": {
      "command": "node",
      "args": [
        "/absolute/path/to/Mira/dist/src/index.js",
        "--project-root", "/absolute/path/to/your-project",
        "--db", "/absolute/path/to/your-project/.mira/mira.sqlite",
        "mcp", "serve", "--profile", "core"
      ]
    }
  }
}
```

The `core` profile exposes the common memory workflow; `research` adds research tools, while `admin` and `full` expose the full tool set. **Profiles select tools, not permissions.** Governed writes require an explicit host confirmation policy and allowed scopes; the default server does not grant them. See [workflows](docs/implementation/workflow-guide.md) and [authority boundaries](docs/implementation/trust-hardening.md) before delegating writes.

Useful tools include `before_turn`, `after_turn`, `prepare_context`, `search_memory`, `set_working_memory`, `save_thread`, and `submit_memory_candidates`. Check `get_runtime_status` inside the connected session to inspect binding and permissions. See the [Cursor example](docs/agent-config/cursor.md) and [agent guidance template](docs/agent-config/AGENTS-template.md).

## Everyday workflows

Run commands in the target project, or put `--project-root /absolute/path/to/project` before the subcommand. Use `mira <command> --help` for the full options.

| Task | Command |
| --- | --- |
| Inspect setup and diagnostics | `mira status` / `mira doctor` |
| Save the next step | `mira working set --kind next_step --content "Review the API change"` |
| Keep parallel task state separate | `mira --task api-review working list` |
| Read the project briefing | `mira briefing show` |
| Prepare context with a recall receipt | `mira context prepare --query "API" --max-tokens 1000` |
| Inspect recall history | `mira context recalls` |
| Review pending candidates | `mira memory candidate list --status pending_review` |
| Archive outdated memory | `mira memory archive --id memory_123 --reason "No longer current"` |
| Inspect background work | `mira workflow` / `mira distill jobs list` |
| Generate a Markdown Vault | `mira vault sync` |
| Export project data | `mira export --format json --out ./export` |

Replace example IDs with IDs returned by Mira. Memory corrections create successors rather than overwriting history. Archive removes a memory from default retrieval; permanent deletion uses separate commands with `--confirm-hard-delete`.

### Import existing sessions

Start with a bounded preview, then import:

```bash
mira history import --dry-run --max-file-size 20 --limit 20
mira history import --max-file-size 20 --limit 20 --report ./history-import.json
mira history runs --limit 20
mira history failures --limit 20
```

Bulk import scans local Codex and Claude Code history for the current project. Use `--root-alias /old/project/path` for a previous working directory, and `--since YYYY-MM-DD` / `--until YYYY-MM-DD` to filter by file modification date. Single-file import also supports Markdown and Codex/Claude Code JSONL transcripts:

```bash
mira import --source codex --format jsonl --path /path/to/session.jsonl
```

Importing saves Threads; it does not by itself make every conversation a durable Memory. Optional `--distill` queues provider extraction for new or updated Threads. A partial import failure returns exit code `2` and an audit summary.

### Optional model-assisted extraction

To enable an OpenAI-compatible provider, set these variables in the environment used to run Mira:

```bash
export MIRA_LLM_BASE_URL="https://provider.example/v1"
export MIRA_LLM_MODEL="model-name"
export MIRA_LLM_API_KEY="your-provider-key"
```

These are placeholders. Provider extraction sends saved Thread content to the configured service. Sensitive-pattern filtering is not a complete privacy guarantee. Without a provider, local capture, search, context, and agent-submitted candidates remain available.

Automatic acceptance is conservative: eligible low-risk candidates need high confidence, attributable user evidence, verbatim support, and no detected secret, duplicate, or conflict. High-impact or inferred content requires review. Confidence is extractor-reported, not proof of truth. See [memory governance](docs/implementation/trust-hardening.md).

## Research cases

Research uses a separate chain: **Research Case → Evidence → Claim → Review**. Context admits only eligible approved claims supported by current, verified evidence. Structural verification checks source/snapshot binding and excerpt integrity; it does not establish semantic entailment. Stale evidence and claim revisions remain auditable.

```bash
mira research list
mira research show --case research_case_123
mira research context --case research_case_123
mira research export --case research_case_123 --out ./research-case.md
```

Start with the [investment research skill](skills/mira-investment-research/SKILL.md), [Apple pilot](examples/research/apple-fy2024-pilot.json), and [multi-case source notes](docs/research/official-multi-case-source-notes.md). The skill submits memory candidates and research proposals; it does not execute trades or modify portfolios or investment theses.

## Storage and project scope

| Concept | Purpose |
| --- | --- |
| Thread | Saved source conversation or manual summary |
| Memory | Durable project knowledge with provenance and lifecycle history |
| Working Memory | Current task, blockers, decisions, and next steps |
| Project Briefing | Rebuildable project summary derived from stored state |
| Context Bundle | Bounded Markdown selected for an agent session |
| Markdown Vault | Generated browsing view; SQLite remains authoritative |
| Research Case | Project- and as-of-date-scoped evidence and claim review |

The default database is `<project>/.mira/mira.sqlite`. Linked Git worktrees share the main repository database by default and use workspace-scoped working state; `--task <id>` selects an explicit task scope. An explicit `--db` overrides the default. Independent clones are not automatically merged by remote URL.

Vault output defaults to `.mira/vault/`. Manual edits there do not write back and are overwritten on the next sync. Back up the database before migration or relocation. See [project identity and task scope](specs/022-project-identity-and-task-scope/spec.md) for root aliases and explicit rebinding.

## Development and documentation

```bash
npm run build
npm test
npm run benchmark:recall
```

Additional validation commands include `npm run verify:trust`, `npm run verify:research-pilot`, and `npm run verify:multi-case-research`. These checks have distinct scopes; see the [trust validation record](docs/implementation/trust-validation.md) for recorded results and limitations.

- [Common workflows and recovery](docs/implementation/workflow-guide.md)
- [Context trust and recall audit](docs/implementation/context-trust.md)
- [Authority, semantic review, and migration boundaries](docs/implementation/trust-hardening.md)
- [MVP specification (Chinese)](specs/001-mira-mvp/spec.md)
- [Implementation specifications](specs/)
- [Chinese README](README.zh-CN.md)

Contributions must use a topic branch and a reviewed pull request into `main`; do not commit or push directly to `main`. See [AGENTS.md](AGENTS.md). Keep both README versions aligned when changing setup or user-facing behavior. Supporting documents retain their original language.
