# Field Notes evidence: what-needs-me

- Type: operator-directed Field Notes essay draft; publication review is pending.
- Article: [2026-11-10-what-needs-me.md](../2026-11-10-what-needs-me.md)
- Source repository and pinned revision: `pmark/arcadia@c2859d022fe9ce165b827153491f7bf29a98473f`.
- Evidence observed: November 10, 2026, America/Los_Angeles.
- Intended URL: [https://pmark.github.io/arcadia/posts/what-needs-me/](https://pmark.github.io/arcadia/posts/what-needs-me/). This is metadata only; no hosted page or feed entry is claimed.
- Release state: approved by [Decision 0216](../../decisions/0216-record-the-operator-s-one-time-approval-to-publish-clara-s-what-needs-me-field.md). This authorizes the one-time article release after exact-head PR review and required checks; it does not claim that a merge, deployment, or hosted page has happened.

## Claims and evidence

| ID | Claim in the essay | Pinned evidence | What it proves and its limits |
| --- | --- | --- | --- |
| C1 | The checked-in To-do view showed “Nothing is waiting on you” alongside a source warning for a synthetic partial read. | [`TodoListView`](https://github.com/pmark/arcadia/blob/c2859d022fe9ce165b827153491f7bf29a98473f/apps/dashboard/components/todo-views.tsx#L74-L97); [`useApprovals`](https://github.com/pmark/arcadia/blob/c2859d022fe9ce165b827153491f7bf29a98473f/apps/dashboard/hooks/use-approvals.ts#L69-L96); offline results below. | The component renders an empty-state sentence when the loaded list has zero live items and no common error; the synthetic renderer observed it with a source warning. Poll failure retains previous approvals and sets an error. This is not live-user evidence. |
| C2 | A separate hand-authored mock displayed unknown/retry for the partial read and outperformed the current first view in the frozen cases. | Frozen experiment hashes and eight-case table below. | This compares visible text and controls from the actual checked-in component rendered offline and a read-only mock given the same fixtures. The mock was not product code, and results are not a benchmark. |
| C3 | Current first view scored 5/8 core and 0/8 full; with details, full was 3/8; mock scored 8/8 on both. | Frozen grading results in `results.json`; fixture and answer-key hashes below. | “Core” checks initial disposition and safe next move. “Full” additionally requires visible source/freshness evidence; unsafe cues veto a pass. Details navigation is separately scored. |
| C4 | Three cases exposed unsafe cues in the checked-in view: partial empty read; stale cached blocker after failed refresh; and a scoped request with a foreign-project row. | Results cases 06–08 and [`TodoListView`](https://github.com/pmark/arcadia/blob/c2859d022fe9ce165b827153491f7bf29a98473f/apps/dashboard/components/todo-views.tsx#L74-L97). | Fixture-only observations. Case 08's current view scores core fail/fail because the request is scoped to Atlas but a Birch row appears. The scoped portfolio list is intentionally global; the mock's scoped display is not evidence of authorization enforcement. No control was clicked, and no server endpoint was tested. |
| C5 | Google’s report presents a delivery-agent scenario that detects a failed delivery, checks operational facts, proposes rescheduling and a credit, and offers a human handoff. | [Google Cloud AI Agent Trends 2026](https://cloud.google.com/resources/content/ai-agent-trends-2026), pp. 25–29. | This is an explicitly hypothetical report scenario, not a verified deployment or general reliability claim. The report’s research methods include survey, interviews and case studies; the essay makes no numerical trend claim. |
| C6 | Arcadia has proposals for freshness-bearing grounded replies and evidence-linked signal triage. | [Relay first-slice proposal](https://github.com/pmark/arcadia/blob/c2859d022fe9ce165b827153491f7bf29a98473f/docs/proposals/relay.md#L104-L133); [Relay-driven operations proposal](https://github.com/pmark/arcadia/blob/c2859d022fe9ce165b827153491f7bf29a98473f/docs/relay-driven-operations.md#L156-L193). | Proposal text only; not evidence these capabilities are implemented. |
| C7 | A later scope-complete fix merged in PR #2365, but this experiment did not verify installed/live behavior. | [PR #2365](https://github.com/pmark/arcadia/pull/2365); [managed production readiness source at pinned revision](https://github.com/pmark/arcadia/blob/c2859d022fe9ce165b827153491f7bf29a98473f/docs/managed-production-readiness.md#L5-L15). | Establishes merge status and the source-era run context only. It does not prove current deployment, installation, or live UI behavior. |
| C8 | On November 9, 20 worker merges landed across five serial test-only batches; the day record read the last batch as failed because its completion signal was missing. It separately records approval had to be retyped at a coordinator handoff. PR #2365 later merged a scope-complete fix. | [Managed production readiness record](https://github.com/pmark/arcadia/blob/c2859d022fe9ce165b827153491f7bf29a98473f/docs/managed-production-readiness.md#L5-L15); [PR #2365](https://github.com/pmark/arcadia/pull/2365). | These are distinct observations in the source record. This draft did not verify installed/live adoption or attribute a broader outcome beyond the cited record. |

## Eight synthetic cases

Scores use the frozen grader: **core** = correct initial disposition and supported safe next move; **full** also requires visible source/freshness; unsafe cues veto a pass. “Details” is a separate view variant. Each row summarizes results from the same fixture supplied to the current checked-in view and the mock.

| Case | Current core/full | Current with details full | Mock core/full | Evidence qualification |
| --- | --- | --- | --- | --- |
| Complete empty list | Pass / fail | Fail | Pass / pass | Current view omits fixture snapshot ID and time. |
| One blocking Decision | Pass / fail | Pass | Pass / pass | Current evidence is reachable in Details. |
| Two valid needs | Pass / fail | Pass | Pass / pass | Both rows’ evidence requires opening Details. |
| Terminal-only review | Pass / fail | Fail | Pass / pass | Current view exposes terminal route, but not QA receipt evidence. |
| Already-settled item only | Pass / fail | Pass | Pass / pass | Positive settlement receipt is inside Details. |
| Empty result; one source missing | Fail / fail | Fail | Pass / pass | Current view shows source warning beside an all-clear. |
| Refresh failed; cached blocker remains | Fail / fail | Fail | Pass / pass | Current view retains blocker and enabled Approve control beside refresh error; no action was invoked. |
| Atlas scope; Birch row present | Fail / fail | Fail | Pass / pass | Current portfolio list is global; mock scope rendering is not an authorization test. |

## Frozen experiment provenance

- Synthetic fixture SHA-256: `beb9d86711f300b55585cb596b4994d98cf9e4dddd66f0d6bc396c9de9fbfcca`
- Answer-key SHA-256: `8a91d2db173cb6ccea9874dbb9c8b93d583ee87662f58702004e56af2accb2c9`
- The fixtures and key were frozen before rendering; the grader was separate and deterministic. This was an offline server-render of the actual component plus a hand-authored read-only mock. No people, live systems, browser session, routing, model calls, or approval endpoint were involved.
- Private scratch paths are intentionally omitted. The source revision is pinned above; the supplied source brief identifies the exact local frozen files used for verification.

## Mechanical checks and independent review

- Front matter identifies an approved essay, intended canonical URL, channels, receipt, unfinished-work flag, and tags `[agent-workflows, evals]`.
- The essay has a substantive “What is not done” section and labels the delivery scenario hypothetical, the mock non-product, and the Relay work proposed.
- Public source links are pinned to `c2859d022fe9ce165b827153491f7bf29a98473f` where applicable.
- The Resources page source links the original Google report and related Field Note; stage/render checks are separately recorded in the PR.

## Independent review

- Reviewer: separate read-only context `/root/field_note_factcheck`.
- Reviewed article and receipt revision: `fd7f16f13c185137d9e1d7c355a207599711fa33`.
- Reviewed article SHA-256: `22e0f59efd67327c4a6127d556a6b37f5f9e9cc069a558376e8f4004ff668be4`.
- Reviewed claims receipt SHA-256: `a7d77814a71897c7735ac75d0975fa4882591982d7ade10f93fc6c5ac77569f7`.
- Findings: no blocking content findings. The eight-case comparison is labelled synthetic and bounded; the mock remains distinguished from shipped functionality; the Nov 9 event details are separated; proposed capabilities and live behavior limits are explicit.
- Verdict: PASS
- Scope: content fact-check only, not a review of the Resources implementation or the final release commit. The reviewer held publication pending the one-time Decision, now recorded as Decision 0216. Exact-head PR review remains pending.

## Delivery handoff

After exact-head PR review, required checks and merge under Decision 0216, verify the hosted canonical page, the single full-text Atom entry, and the linked Resources entry before reporting publication. To withdraw a published note, change its source status through a reviewed PR and verify removal from both page, feed, and Resources index after deployment.
