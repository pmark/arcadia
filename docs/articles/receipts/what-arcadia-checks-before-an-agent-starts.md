# Field Notes evidence

- Draft: [What Arcadia checks before an agent starts](../2026-11-08-what-arcadia-checks-before-an-agent-starts.md)
- Evidence observed: November 8, 2026, America/Los_Angeles.
- Retrospective source: `pmark/arcadia@1dcc6295be6037056d548f551b33fec81ad4ea50`.
- Candidate: `pmark/arcadia@ef638bc883ae7ae661a2d811f701a58afcb7726f`. The public PR was open, clean, and unmerged when checked.
- Eligibility: editorial draft requested directly. A shipped-change cutoff and publication eligibility have not been established. The canonical URL in frontmatter is the intended GitHub Pages destination under Decision 0165.
- Authoring: Clara / Claudia Mason, Claude Sonnet 5.5, medium. Rowan edited for clarity and added the METR source.

| Claim | Primary source | Limit |
| --- | --- | --- |
| GitHub's guide treats agentic engineering as planning, building, verifying, and observing. It prompted the Arcadia comparison in this assignment. | [Original GitHub guide by Nick Liffen and Philip Holleran, November 6, 2026](https://github.blog/ai-and-ml/github-copilot/beyond-code-generation-a-developers-guide-to-agentic-engineering/) and the operator's article review and implementation request. | GitHub provides a practice guide. The local comparison was retrospective. |
| Who participates and which tasks are submitted affect interpretation of METR's estimates. | [METR research update, February 24, 2026](https://metr.org/blog/2026-02-24-uplift-update/) | The post cites the measurement limitation and makes no claim about the size or direction of productivity effects. |
| Both runs involved test-only work. Review and QA occupied the longest stage in the clean run. | [Clean-run evidence](https://github.com/pmark/arcadia/blob/1dcc6295be6037056d548f551b33fec81ad4ea50/docs/managed-production-readiness.md#L18-L66) and [record-run overview](https://github.com/pmark/arcadia/blob/1dcc6295be6037056d548f551b33fec81ad4ea50/docs/reports/relay-record-run-night-2026-11-07.md#L1-L19) | Timing is limited to those runs. The clean-run evidence does not isolate CI wait, review execution, and QA execution. |
| Arcadia mistook an example test path for a required file and retried. | [Incident #2272](https://github.com/pmark/arcadia/issues/2272) and [record run, row 49](https://github.com/pmark/arcadia/blob/1dcc6295be6037056d548f551b33fec81ad4ea50/docs/reports/relay-record-run-night-2026-11-07.md#L28-L81) | A reported event in the test-only run. |
| The candidate warns on ambiguous filenames, refuses targeted invisible characters before card pinning, reuses the completion parser, and adds no AI calls. | [Pinned candidate source](https://github.com/pmark/arcadia/blob/ef638bc883ae7ae661a2d811f701a58afcb7726f/src/commands/startRun.ts#L131-L220) and [PR #2287](https://github.com/pmark/arcadia/pull/2287) | Ambiguous paths are advisory. The check detects specific invisible characters and a bounded set of path patterns. |
| Independent review, offline tests and GitHub CI passed. Live results and time savings remain unmeasured. | [Review and offline test evidence](https://github.com/pmark/arcadia/pull/2287#issuecomment-6724398417), [final review](https://github.com/pmark/arcadia/pull/2287#issuecomment-6724444365), and [GitHub CI](https://github.com/pmark/arcadia/actions/runs/42503213179) | Evidence applies to the reviewed candidate. |

The repeated Field Notes habit is editorial direction proposed in this post.

## Independent review

- Reviewer: separate read-only Codex context `field_notes_factcheck`.
- Reviewed article SHA-256: `4172944db116d19f3192e7debdeb19577097325bc9a9c0464cdb034120c85f31`.
- Reviewed evidence receipt SHA-256: `b393e0db26e6851e04bb0561ed5c454dbf201708e12c6e4ff64872421f5fb1d3`.
- The article body is identical to the reviewed draft. Repository filing changed its receipt path and intended canonical URL.
- Findings: none blocking. Recheck PR #2287 and live-use status before publication.
- Verdict: PASS

## Delivery handoff

Draft for the [Arcadia Field Notes blog](https://pmark.github.io/arcadia/) under [Decision 0165](../../decisions/0165-may-decision-0120-s-automatic-field-notes-publication-use-the-arcadia-field.md). Publication eligibility is pending.
