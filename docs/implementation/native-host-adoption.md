# Native host adoption record

Date: 2026-09-14. Validated application source: `96d5368787b2acd164d1717872ed0943a2bb271b`.

The first live Codex-to-Claude Code handoff succeeded in the Mira project. A fresh Claude Code session received three Working Memory entries through its native SessionStart hook, accurately restated the completed work, decisions, and next step, and saved its transcript through the native Stop hook. This is one observed handoff, not a general reliability or retrieval-quality result.

## README integration

[PR #20](https://github.com/zxheyi/Mira/pull/20) merged after independent standards and requirements reviews. Its initial documentation checks failed because the rewrite omitted cleanup and recall-feedback guidance and retained assertions requiring Chinese text in the English README. The repair restored the guidance and checked both languages without removing the original requirements.

- Local build and all four targeted documentation tests passed.
- Each README's 20 relative links resolved and its JSON example parsed.
- [PR CI](https://github.com/zxheyi/Mira/actions/runs/34825977643) and [merged main CI](https://github.com/zxheyi/Mira/actions/runs/34826162734) passed both Build and test and Research invariants.

The earlier source fingerprint excluded README files. Matching that fingerprint did not establish that this documentation change passed its tests.

## Live handoff

1. Codex used the connected Mira MCP server to capture the actual PR outcome and save project-level `current_task`, `recent_decision`, and `next_step` entries.
2. A new local Claude Code process used the installed project hooks. Its prompt asked for the previous work, decisions, and next step without supplying the answers. Tools were disabled so the answer could be checked against the injected context alone.
3. The native SessionStart event returned a Mira Context Bundle containing the three entries. The assistant made no tool calls and correctly reproduced PR #20, the merge commit, both CI checks, the contribution policy, and the next validation steps.
4. The process returned `is_error: false`. Its native Stop hook succeeded, and the database retained the corresponding Thread and capture record.

Observed environment: Node 24.11.1 and Claude Code 2.1.252. The successful invocation reported 51,796 ms and a cost of USD 0.04152375; these are host-reported values for this invocation only.

The initial invocation failed with `ConnectionRefused` because the configured local provider proxy was not running. Starting the existing CC Switch application restored that connection; a second, fresh session succeeded. No credentials or provider settings were changed. SessionStart had also succeeded on the failed invocation, so a hook success alone would have overstated the result.

Capture and model success were checked separately. The successful capture's downstream distillation and projection messages were still pending when inspected; automatic extraction was not validated. The source Codex phase used explicit MCP capture, so this run does not prove Codex's native Stop hook or automatic per-prompt recall.

## First long-term Memory recall comparison

The initial database contained no long-term Memories and no user feedback. A single Memory was subsequently created from the user's existing four contribution rules. The candidate preserved the source text verbatim, entered `pending_review` because the excerpt lacked attributed transcript spans, and was accepted through the documented local CLI review after Codex checked the original user instructions. Its acceptance mode is `reviewed`, not automatic.

Two controlled recalls then used the same real project question: “Mira 仓库贡献流程：修改代码后如何提交和合并到 main？”

| Token budget | Candidate Memories | Memories selected into generated context | Observed result |
| --- | --- | --- | --- |
| 1,000 | 1 | 0 | Working state consumed the available budget; the contribution Memory was omitted with reason `budget`. Output token upper bound: 956. |
| 2,000 | 1 | 1 | All four contribution rules were included. Output token upper bound: 1,682. |

Both receipts were recorded as `prepared`; these two calls were observed in Codex and were not a second native-host delivery experiment. This observation identifies budget competition, not an FTS retrieval miss. It does not establish that 2,000 tokens is an optimal global default. The user's evaluation was requested for each result; no usefulness labels are inferred from successful tool calls or from this comparison. At the time of this record, there were 0/20 labeled recalls.

Working-Memory-only handoff receipts are kept as adoption evidence. They are not used here to fill the long-term retrieval feedback threshold. The current feedback implementation accepts empty Memory ID sets and counts all stored labels, so operators must preserve that distinction when gathering evidence.

## Evidence and remaining work

Local evidence is retained under the ignored `artifacts/trust-validation/adoption-20260914/` directory: native event streams, the neutral handoff prompt, a read-only database evidence summary, candidate review output, and both recall receipts. Raw host streams are not committed because they also contain unrelated host initialization context.

The next step is to record only explicit user evaluations against the corresponding receipts and gather further independent examples during normal work. The [recall feedback rule](../../specs/029-recall-feedback/spec.md) requires at least 20 labeled recalls; at least five distinct true retrieval-miss records are needed before it suggests evaluating hybrid retrieval. This single-project run does not meet that evidence threshold.
