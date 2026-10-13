# Field Notes evidence: why-autonomous-production-is-not-a-coding-speed-problem

- Type: essay draft (operator-requested repository storage)
- Article: docs/articles/2026-10-12-why-autonomous-production-is-not-a-coding-speed-problem.md
- Source repository and pinned revision: pmark/arcadia@17f05f789 (merge of #1348)
- Intended destination: ArcadiaMissionControl.com; proposed canonical path /notes/why-autonomous-production-is-not-a-coding-speed-problem/
- Eligibility: operator-requested draft; contains judgement (the ultracode comparison) that is explicitly not a measurement
- Publication: future intent only; no site, RSS, deploy or notification receipt
- Publication policy reference: [Decision 0120](../../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md)

## Claims

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

## Mechanical checks

Front matter, draft status, receipt link, intended destination, channels, the limitation section, relative links and absence of placeholders checked by the author; independent fact-check recorded below.

## Independent review

- Independent fact-checker: fresh read-only Sonnet agent, separate lineage.
- Reviewed candidate: ba6b867dd. Verdict: needs minor edits; nothing invented. Applied in the following commit: dropped "governed", softened the review-round and probe claims, cited the test file for the quoted string, attributed "about three hours" to the living notes and attributed the ultracode description to the harness.
- This section records review of the preceding revision; the edited bytes were not re-reviewed.

## Delivery handoff

Draft for eventual posting to ArcadiaMissionControl.com. Website publication is outside this writing request. No publication or notification has occurred.
