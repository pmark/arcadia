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
| C1 | The first supervised run took about 3.5 hours to launch one Session, then spent about 11.1M input tokens (98% cache re-reads) with no diff because the Session sandbox could not write the workspace database. | [first-supervised-production-run-learnings-2026-10-11.md](../reports/first-supervised-production-run-learnings-2026-10-11.md) | The report's own figures; not independently re-measured here. |
| C2 | A platform per-Session token ceiling is merged. | [PR #1303](https://github.com/pmark/arcadia/pull/1303) | Delivery to main; not live behaviour. |
| C3 | An in-Session environment probe is merged and was blocked by independent review across multiple rounds (packaging, spoofable parse, widened allow rule, stale-failure re-wall). | [PR #1306](https://github.com/pmark/arcadia/pull/1306) and its review history | Review findings are those recorded in the PR; not a measure of all defects. |
| C4 | The approval validator needed three rounds; a draft let "Implementation requires no approval, but a separate approval is nice to have" through. | [PR #1296](https://github.com/pmark/arcadia/pull/1296) review summary comment | The example string is from the reviewer's trace; disclosed bypass classes remain. |
| C5 | The decision-card contract failed open on a bad clock and treated invisible characters as non-empty text before it was repaired; it merged with 70 tests. | [PR #1348](https://github.com/pmark/arcadia/pull/1348) review summary comment | A schema only; no rendering or execution engine. |
| C6 | A guard that refuses Plan changes inside an Active production scope, a validated session ledger, role guidance and one-click clears for two blocker kinds are merged. | [#1297](https://github.com/pmark/arcadia/pull/1297), [#1301](https://github.com/pmark/arcadia/pull/1301), [#1304](https://github.com/pmark/arcadia/pull/1304), [#1309](https://github.com/pmark/arcadia/pull/1309) | Delivery; none ran as an unattended Session. |
| C7 | More than twenty governed pull requests merged during the day, four of eight guard/validator PRs were blocked by independent review, and about twenty-five frictions were recorded. | [living notes](../reports/production-simulation-living-notes.md), PR history of pmark/arcadia on 2026-10-12 | Counts are approximate and by hand. |
| C8 | Claude Code's ultracode is an explicit opt-in to a scripted multi-agent workflow that can spawn many agents and consume many tokens. | The Claude Code harness tool description available to the Lead session | Description of the harness; ultracode was not run on this problem. |

## Mechanical checks

Front matter, draft status, receipt link, intended destination, channels, the limitation section, relative links and absence of placeholders checked by the author; independent fact-check recorded below.

## Independent review

Pending: a fresh read-only reviewer checks C1 to C8 against the pinned evidence; the result is added in a follow-up commit.

## Delivery handoff

Draft for eventual posting to ArcadiaMissionControl.com. Website publication is outside this writing request. No publication or notification has occurred.
