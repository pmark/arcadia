# Field Notes evidence for why-autonomous-production-is-not-a-coding-speed-problem

- Article: 2026-10-12-why-autonomous-production-is-not-a-coding-speed-problem.md
- Type: essay.
- Source revision: [88045ef97](https://github.com/pmark/arcadia/tree/88045ef9712fa0341bdc5be2df45eee2334e8eaa).
- Destination: [Field Notes](https://pmark.github.io/arcadia/posts/why-autonomous-production-is-not-a-coding-speed-problem/) and its [Atom feed](https://pmark.github.io/arcadia/feed.xml).
- Release: operator-directed November 9, 2026 batch in America/Los_Angeles, scoped to the four shortlisted essays. The standing automatic cadence remains separate.
- Previous feed check: November 9, 2026. The feed contained two ship notes, and this slug was absent.
- Governing destination: [Decision 0165](../../decisions/0165-may-decision-0120-s-automatic-field-notes-publication-use-the-arcadia-field.md). [Decision 0206](../../decisions/0206-record-the-operator-s-one-time-approval-to-publish-the-four-shortlisted-field.md) records the one-time batch approval.

## Claims

The summary is covered by the claims below. Suggested developer practices and hypothetical examples are editorial advice.

| ID | Claim | Pinned public evidence | Proof boundary |
| --- | --- | --- | --- |
| C1 | An October regression fixture asserts that approval wording with a nice-to-have exception is flagged. The validator took several review rounds. | [Validator PR #1296](https://github.com/pmark/arcadia/pull/1296) · [Regression fixture](https://github.com/pmark/arcadia/blob/88045ef9712fa0341bdc5be2df45eee2334e8eaa/tests/planning-artifact-validator.test.ts#L199-L204) | Supports the test and the review history; the story does not assert that the reviewer used the exact string against an earlier implementation. |
| C2 | On November 5 one START was followed by three worker merges on the Arcadia repository, with serial test-only work and frozen main. Review and QA were the longest measured stage. | [November 5 run record](https://github.com/pmark/arcadia/blob/88045ef9712fa0341bdc5be2df45eee2334e8eaa/docs/managed-production-readiness.md#run-record-attempt-3-card-start-run-unattended-20261105d) | The combined timing cannot separate CI wait from review and QA execution. |
| C3 | Twenty worker merges landed in five separately started test-only batches on November 8 Pacific time. One batch stopped on a quoted example path; PR #2325 fixed that case. | [November batch accounting](https://github.com/pmark/arcadia/blob/88045ef9712fa0341bdc5be2df45eee2334e8eaa/docs/managed-production-readiness.md#operator-view-the-rovers-route-from-here) · [Parser PR #2325](https://github.com/pmark/arcadia/pull/2325) | UTC interval from 19:41Z Nov 8 to 07:20Z Nov 9 falls on Nov 8 in America/Los_Angeles. The verified outcome is limited to the test-only serial envelope. |

## Mechanical checks

The candidate uses the Field Notes front matter, a public canonical URL, site and RSS channels, and a specific unfinished-work section. The article body is short-form.

## Independent review

- Reviewer: separate read-only Codex context `field_notes_publication_review`.
- Reviewed candidate: `8c047010b08a9626965bab2ee1ae8eafd7e1762f`. Pinned source: `88045ef9712fa0341bdc5be2df45eee2334e8eaa`.
- Reviewed article SHA-256: `7dcad5d834141263b9a689982d3baeae915012275c31ce4a0b04eebbce788682`.
- Reviewed claims receipt SHA-256: `ff66307d1beb6adce06602e828d38277ba9af85610df5b878b3ae82d567e6d98`.
- Findings: none blocking. The publication candidate records the approved status and Decision. The timing summary calls the November observations efforts to distinguish the five-batch follow-up from a single run. [PR #2393](https://github.com/pmark/arcadia/pull/2393) records the final approval-delta review.
- Verdict: PASS

## Delivery handoff

Pending. The exact approved source, Pages run, canonical page, full-text Atom entry and link notification will be recorded on [release PR #2393](https://github.com/pmark/arcadia/pull/2393). To withdraw the article, set its source status to withdrawn in a reviewed PR and verify the next Pages build removes its page and feed entry.

## Earlier draft record

## Field Notes evidence: why-autonomous-production-is-not-a-coding-speed-problem

### Editorial refresh, 2026-11-09

Source checked at [`2e5b841bd`](https://github.com/pmark/arcadia/tree/2e5b841bde29efa63e9f7fa77d1455deb6457444). Claim C4 records the October validator regression test and review rounds. The draft uses the test as an example of the rule and leaves the unverified history of the first implementation out. The shortened draft uses the [readiness record](../../managed-production-readiness.md) for the November 5 timeline and November 8 Pacific time batch count (November 8–9 UTC), and [PR #2325](https://github.com/pmark/arcadia/pull/2325) for the parser fix. It drops the provider-mode comparison and preserves the timing limitation.

The claims and review below apply to the earlier draft. The refreshed version awaits independent fact-checking.

- Type: essay draft (operator-requested repository storage)
- Article: docs/articles/2026-10-12-why-autonomous-production-is-not-a-coding-speed-problem.md
- Source repository and pinned revision: pmark/arcadia@17f05f789 (merge of #1348)
- Intended destination: ArcadiaMissionControl.com; proposed canonical path /notes/why-autonomous-production-is-not-a-coding-speed-problem/
- Eligibility: operator-requested draft; contains judgement (the ultracode comparison) that is explicitly not a measurement
- Publication: future intent only; no site, RSS, deploy or notification receipt
- Publication policy reference: [Decision 0120](../../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md)

### Claims

| ID | Factual sentence or clause | Pinned public evidence | What it proves and its limits |
| --- | --- | --- | --- |
| C1 | The first supervised run took about three hours to launch one Session, then spent about 11.1M input tokens (98% cache re-reads) with no diff because the Session sandbox could not write the workspace database. | [first-supervised-production-run-learnings-2026-10-11.md](../../reports/first-supervised-production-run-learnings-2026-10-11.md), [living notes](../../reports/production-simulation-living-notes.md) | Token and sandbox figures from the report; "about three hours" is living-notes friction #1. Not independently re-measured. |
| C2 | A platform per-Session token ceiling is merged. | [PR #1303](https://github.com/pmark/arcadia/pull/1303) | Delivery to main; not live behaviour. |
| C3 | An in-Session environment probe is merged and was repaired across several commits for packaging, nonce binding and an overly broad allow rule. | [PR #1306](https://github.com/pmark/arcadia/pull/1306) commit history | The PR carries no review summary; the specifics are inferred from commit subjects. |
| C4 | The approval validator needed three reviews; "Implementation requires no approval, but a separate approval is nice to have" is a regression-test case it must flag. | [PR #1296](https://github.com/pmark/arcadia/pull/1296), `tests/planning-artifact-validator.test.ts` | Whether the first draft let it through is not confirmed by the PR text; disclosed bypass classes remain. |
| C5 | The decision-card contract failed open on a bad clock and treated invisible characters as non-empty text before it was repaired; it merged with 70 tests. | [PR #1348](https://github.com/pmark/arcadia/pull/1348) review summary comment | A schema only; no rendering or execution engine. |
| C6 | A guard that refuses Plan changes inside an Active production scope, a validated session ledger, role guidance and one-click clears for two blocker kinds are merged. | [#1297](https://github.com/pmark/arcadia/pull/1297), [#1301](https://github.com/pmark/arcadia/pull/1301), [#1304](https://github.com/pmark/arcadia/pull/1304), [#1309](https://github.com/pmark/arcadia/pull/1309) | Delivery; none ran as an unattended Session. |
| C7 | More than twenty pull requests merged during the day, four of eight guard/validator PRs were blocked by independent review (two in successive rounds), and about twenty-five frictions were recorded. | [living notes](../../reports/production-simulation-living-notes.md), PR history of pmark/arcadia on 2026-10-12 | The fact-check counted 37 PRs merged that UTC day, about 25 from the supervised team; the rest were other agents' work. Counts are approximate. |
| C8 | As described in the Claude Code harness, ultracode is an explicit opt-in to a scripted multi-agent workflow that can spawn many agents and consume many tokens. | The Claude Code harness tool description available to the Lead session | Not in the repository; unverifiable from public evidence. Ultracode was not run on this problem. |

### Mechanical checks

Front matter, draft status, receipt link, intended destination, channels, the limitation section, relative links and absence of placeholders checked by the author; independent fact-check recorded below.

### Independent review

- Independent fact-checker: fresh read-only Sonnet agent, separate lineage.
- Reviewed candidate: ba6b867dd. Verdict: needs minor edits; nothing invented. Applied in the following commit: dropped "governed", softened the review-round and probe claims, cited the test file for the quoted string, attributed "about three hours" to the living notes and attributed the ultracode description to the harness.
- This section records review of the preceding revision; the edited bytes were not re-reviewed.

### Delivery handoff

Draft for eventual posting to ArcadiaMissionControl.com. Website publication is outside this writing request. No publication or notification has occurred.
