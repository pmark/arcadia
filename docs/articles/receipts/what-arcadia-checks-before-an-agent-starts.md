# Field Notes evidence

- Draft: [What Arcadia checks before an agent starts](../2026-11-09-what-arcadia-checks-before-an-agent-starts.md)
- Evidence observed: November 8, 2026, America/Los_Angeles.
- Retrospective source: `pmark/arcadia@1dcc6295be6037056d548f551b33fec81ad4ea50`.
- Candidate: `pmark/arcadia@ef638bc883ae7ae661a2d811f701a58afcb7726f`. The reviewed candidate merged into `main` through [PR #2287](https://github.com/pmark/arcadia/pull/2287) on November 8, 2026 at 21:06 UTC, as commit [`564789b97`](https://github.com/pmark/arcadia/commit/564789b97dfedba5f80146bb6c30ce4884d12f1a).
- Cadence window: `[2026-11-02T08:00:00Z, 2026-11-09T08:00:00Z)`, America/Los_Angeles. Publication is held until the window closes at midnight Pacific.
- Evidence collection window: `[2026-11-01T11:15:00Z, 2026-11-09T08:00:00Z)`. The prior cutoff comes from the [One press receipt](one-press.md). Prior delivery was confirmed in the [live feed](https://pmark.github.io/arcadia/feed.xml) and [last successful Blog deployment](https://github.com/pmark/arcadia/actions/runs/41677764024).
- Eligibility: the operator explicitly requested this ship note for the Field Notes site and feed. The preflight fix merged on November 8 in this window. The only prior published ship note, [One press](https://pmark.github.io/arcadia/posts/one-press/), is dated November 1 in the previous Pacific calendar week. This is a focused report on #2287. The canonical URL in frontmatter is the intended GitHub Pages destination under Decision 0165.
- Authoring: Clara / Claudia Mason, Claude Sonnet 5.5, medium. Rowan edited for clarity and added the METR source.

| Claim | Primary source | Limit |
| --- | --- | --- |
| GitHub's guide treats agentic engineering as planning, building, verifying, and observing. It prompted the Arcadia comparison in this assignment. | [Original GitHub guide by Nick Liffen and Philip Holleran, November 6, 2026](https://github.blog/ai-and-ml/github-copilot/beyond-code-generation-a-developers-guide-to-agentic-engineering/) and the operator's article review and implementation request. | GitHub provides a practice guide. The local comparison was retrospective. |
| Who participates and which tasks are submitted affect interpretation of METR's estimates. | [METR research update, February 24, 2026](https://metr.org/blog/2026-02-24-uplift-update/) | The post cites the measurement limitation and makes no claim about the size or direction of productivity effects. |
| Both runs involved test-only work. Review and QA occupied the longest stage in the clean run. | [Clean-run evidence](https://github.com/pmark/arcadia/blob/1dcc6295be6037056d548f551b33fec81ad4ea50/docs/managed-production-readiness.md#L18-L66) and [record-run overview](https://github.com/pmark/arcadia/blob/1dcc6295be6037056d548f551b33fec81ad4ea50/docs/reports/relay-record-run-night-2026-11-07.md#L1-L19) | Timing is limited to those runs. The clean-run evidence does not isolate CI wait, review execution, and QA execution. |
| Arcadia mistook an example test path for a required file and retried. | [Incident #2272](https://github.com/pmark/arcadia/issues/2272) and [record run, row 49](https://github.com/pmark/arcadia/blob/1dcc6295be6037056d548f551b33fec81ad4ea50/docs/reports/relay-record-run-night-2026-11-07.md#L28-L81) | A reported event in the test-only run. |
| The candidate warns on ambiguous filenames, refuses targeted invisible characters before card pinning, reuses the completion parser, and adds no AI calls. | [Pinned candidate source](https://github.com/pmark/arcadia/blob/ef638bc883ae7ae661a2d811f701a58afcb7726f/src/commands/startRun.ts#L131-L220) and [PR #2287](https://github.com/pmark/arcadia/pull/2287) | Ambiguous paths are advisory. The check detects specific invisible characters and a bounded set of path patterns. |
| The change is on main. Independent review, offline tests and GitHub CI passed. Live results and time savings remain unmeasured. | [Merged PR](https://github.com/pmark/arcadia/pull/2287), [review and offline test evidence](https://github.com/pmark/arcadia/pull/2287#issuecomment-6724398417), [final review](https://github.com/pmark/arcadia/pull/2287#issuecomment-6724444365), and [GitHub CI](https://github.com/pmark/arcadia/actions/runs/42503213179) | Evidence applies to the reviewed candidate. |

The repeated Field Notes habit is editorial direction proposed in this post.

## Follow-up run evidence

Mira / Claudia Mason reviewed the retained part-2 evidence after the four successful STARTs following [#2287](https://github.com/pmark/arcadia/pull/2287). The first batch ended at 21:05 UTC, before #2287 merged at 21:06 UTC, and is excluded. The [public readiness account](https://github.com/pmark/arcadia/blob/b3cef2f2e/docs/managed-production-readiness.md#L5-L15) gives the delivery and failure scope. The original publication date and cutoff are preserved.

| Post-merge START | Pinned source revision | Selected Action slots | Recorded build sessions | Worker merges | Replay warnings / refusals |
| --- | --- | ---: | ---: | ---: | ---: |
| Nov 8 22:04 UTC, batch 2 | `564789b97dfedba5f80146bb6c30ce4884d12f1a` | 5 | 6 | 3 | 0 / 0 |
| Nov 9 00:47 UTC, batch 3 | `bff95d6880d9283570355befe152e4fc89d5475b` | 5 | 5 | 5 | 0 / 0 |
| Nov 9 02:51 UTC, batch 4 | `21d1b56b9bf65538fc983b842e7bcc5919a58acb` | 5 | 5 | 5 | 0 / 0 |
| Nov 9 06:49 UTC, batch 5 | `bf1b304c5b2dbf3d09270922ee23b2aea6384be8` | 2 | 2 | 2 | 0 / 0 |

- **Replay method:** Read each successful START descriptor, extract its selected Action IDs from the Plan frontmatter at the pinned revision, and call `startRunCriteriaFindings` on each Action. The validator and its completion-parser source matched #2287 byte for byte. Batches 2 and 3 overlap by two Actions, so 17 slots represent 15 distinct Actions. A superseded batch 4 descriptor is excluded.
- **Session accounting:** `arcadia start-run day-evidence --json` supplied activation and admission counts. The `attemptTokens` rows in `arcadia production status --json`, grouped by Action, show 14 of the 15 Actions at one recorded build session each and `pin-authoritative-control-path` at four. These are build session counts. They exclude individual process launches, CI retries, reviewer calls and any retries the check may have prevented.
- **Separate failure:** The [later QA-plan defect](https://github.com/pmark/arcadia/issues/2324) stopped batch 2 after three merges. [#2325](https://github.com/pmark/arcadia/pull/2325) fixed the QA renderer, and [#2326](https://github.com/pmark/arcadia/pull/2326) delivered the Action in batch 3.
- **Limits:** Shell executor receipts omit the earlier pin-command output. These successful-card replays cannot reveal a warning, early refusal or edit that left no retained descriptor. No live catch or reduction in retries is established. This is a serial, test-only cohort.

## Independent review

- Reviewer: separate read-only Codex context `field_notes_factcheck`.
- Reviewed article SHA-256: `4172944db116d19f3192e7debdeb19577097325bc9a9c0464cdb034120c85f31`.
- Reviewed evidence receipt SHA-256: `b393e0db26e6851e04bb0561ed5c454dbf201708e12c6e4ff64872421f5fb1d3`.
- Repository filing initially changed only the receipt path and intended canonical URL. After #2287 merged, the summary and limitation section were updated to reflect the verified merge. The delta review is tracked on [draft filing PR #2312](https://github.com/pmark/arcadia/pull/2312).
- Findings: none blocking. Recheck live-use status before publication.
- Verdict: PASS

## Delivery handoff

Publication authorized for the [Arcadia Field Notes blog](https://pmark.github.io/arcadia/) and its feed under [Decision 0165](../../decisions/0165-may-decision-0120-s-automatic-field-notes-publication-use-the-arcadia-field.md). The delivery outcome is recorded after verifying the page and feed. To unpublish, set the article status to `withdrawn` in a reviewed PR and verify the next Blog deployment removes the page and feed entry.
