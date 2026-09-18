# Query recall and budget allocation

Date: 2026-09-14

## Problem

The [native adoption evaluation](../../docs/implementation/native-host-adoption.md) found three independent failures with an existing contribution-rule Memory:

- Chinese questions about working on a branch or putting a fix on the main branch produced no candidate.
- A port question matched the project name in an unrelated Memory. An English approval question matched only the article `a`.
- At a 1,000-token upper bound, optional Working Memory consumed the space needed to inject the complete matching rule.

## Behavior

Default Memory search uses local lexical query analysis: Unicode word segmentation, common-word filtering, project-name filtering when specific terms remain, and a bounded vocabulary of English/Chinese development concepts. Keyword queries retain OR matching. Natural questions asking about a recognized object such as a port, version, or database require that object to match. Explicit phrase mode remains a literal contiguous phrase without expansion.

For explicit generic Memory queries, context preparation selects `blocker` and `current_task` first, then reserves enough space for the first complete candidate that fits in the existing warning-first order. Optional Working Memory and Briefing metadata use the remaining space. An oversized candidate does not prevent a later candidate from fitting. Both character and UTF-8 byte limits apply, and Memory entries remain atomic.

The selection manifest identifies the query policy and budget-allocation policy, the reserved Memory, and optional entries omitted to preserve it. The UTF-8 token upper-bound calculation and receipt schema remain unchanged.

## Preserved contracts

| Partition | Required behavior |
| --- | --- |
| Scope and lifecycle | Only active Memories in the bound project and requested kind are eligible. |
| Keyword and phrase search | Independent keywords retain OR matching; explicit phrase mode stays literal. |
| No query | Existing project-priority selection and Working Memory order remain unchanged. |
| Task state | Task entries override shared entries of the same kind; other tasks remain isolated. |
| Very small budget | Critical state keeps priority; no promise that any complete Memory can fit. |
| Explicit Research Cases | Existing evidence gates and Research allocation order remain unchanged. |
| Preview | No Recall, feedback, or Briefing writes. CLI and MCP render the same selection. |
| Feedback | Agent fixtures do not become user labels or change the existing 20/5 feedback threshold. |

## Verification

Use regression tests for the failed examples and additional port, version, database, project-scope, inactive-memory, and phrase/keyword cases. Test the complete selection through fresh CLI and stdio MCP processes. Replay the eight adoption queries at both 1,000 and 2,000 token upper bounds against a frozen fixture, and retain the existing 20-case recall baseline thresholds.

This is a local lexical improvement. It adds no embeddings, network model, schema migration, or general semantic-retrieval guarantee. The small evaluation corpus measures these regressions and does not establish production recall quality.
