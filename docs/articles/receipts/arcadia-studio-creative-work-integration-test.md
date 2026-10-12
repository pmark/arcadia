# Field Notes evidence: arcadia-studio-creative-work-integration-test

- Type: essay draft describing a proposal
- Article: docs/articles/2026-10-12-arcadia-studio-creative-work-integration-test.md
- Source repository and pinned revision: pmark/arcadia@586a5d96becb0f71b3674c9da09b52d1c09df99c (scout implementation)
- Intended destination: ArcadiaMissionControl.com; proposed canonical path /notes/arcadia-studio-creative-work-integration-test/
- Eligibility: operator-requested draft; no claim of a completed Studio milestone or automatic publication eligibility
- Publication: future intent only; no site, RSS, deploy, or notification receipt
- Publication policy reference: [Decision 0120](../../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md)

## Claims

The summary and all descriptions of Studio personas, interfaces, feedback loops, and future costs are explicitly proposed design. They assert no implemented capability, human-like subjective experience, activation, spending authority, or measured cost saving. The following rows cover the factual implementation claims in the article.

| ID | Factual sentence or clause | Pinned public evidence | What it proves and its limits |
| --- | --- | --- | --- |
| C1 | The first scout probe is merged. | [PR #1325](https://github.com/pmark/arcadia/pull/1325), merge 586a5d96becb0f71b3674c9da09b52d1c09df99c | Repository delivery; not installation or a live successful build. |
| C2 | It exercises Ask and To-do directly in a disposable fixture and captures a structured report without model calls. | [Scout test at the merge](https://github.com/pmark/arcadia/blob/586a5d96becb0f71b3674c9da09b52d1c09df99c/tests/fast-rehearsal/ask-todo-scout.test.ts), [launcher descriptor](https://github.com/pmark/arcadia/blob/586a5d96becb0f71b3674c9da09b52d1c09df99c/artifacts/generated/operator-scripts/run-scout-hello-world-probe.json) | Deterministic scenario and provider guards; excludes coding and review usage used to develop the probe. |
| C3 | Its current result is No: approval queues an execution Run, but the fixture has no worker to execute it. | Same pinned scout test, assertion of outcome and queued-versus-launched evidence | Expected and tested fixture result, not a failed live worker or proof that all Arcadia execution is broken. |
| C4 | Ask does not expose that queued Run's identity, tracked in issue #1320. | [Issue #1320](https://github.com/pmark/arcadia/issues/1320), same pinned test's public Run-id observation | Captured interface defect in this review-execution path; does not claim a universal status defect. |
| C5 | The harness can complete its observation while the product journey remains incomplete. | Same pinned test and launcher descriptor, distinct harness-success and product-outcome assertions | Runner success is not Hello World completion. |
| C6 | The merged probe does not launch a live builder or prove Hello World end to end; its scope excludes workers and automatic Issue publication. | Same pinned launcher descriptor, authority.never_does; same scout test | Explicit current scope. Proposed shared API/CLI contract, personas, and governed repair automation are future design, not shipped claims. |

## Mechanical checks

Passed local checks of required front matter, draft status, receipt link, intended publication destination, exact site/rss channels, limitation section, relative links, and no article placeholders. Public source URLs are pinned to the known scout merge; no executable product code is changed. The directory guide intentionally shows filename patterns. An initial overbroad placeholder check rejected that guide pattern; the article-only check was corrected and passed.

## Independent review

Pending an independent read-only review of the article and receipt's exact committed revision. No author self-approval or publication eligibility is claimed.

## Delivery handoff

Draft for eventual posting to ArcadiaMissionControl.com. Website publication is outside this writing request. No publication or notification has occurred.
