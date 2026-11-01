# Field Notes evidence: one-press

- Type: ship
- Article: docs/articles/2026-11-01-one-press.md
- Source repository and pinned revision: pmark/arcadia@ee843dab0ca0de3558c36131ff13d3ad5e9be8b4
- Cadence window: [2026-10-26T07:00:00Z, 2026-11-02T08:00:00Z); timezone: America/Los_Angeles (the week in progress; this is the first Field Note, so no earlier note shares the window)
- Evidence collection: [2026-10-31T00:00:00Z, 2026-11-01T11:15:00Z), explicit first-run baseline: the START work tracked on Issue #1929 from the #1950 blocker to the 11:15Z planning-gate report
- Previous verified publication/cutoff: none; this is the first Field Note on the GitHub Pages site
- Eligibility: shipped, merged work (PRs #1951–#1964) and a live START on the operator's host. Not an essay: the Milestone (unattended delivery) is unproven.
- Decisions: [0120](../../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md); the destination amendment is recorded separately (see Delivery handoff)

## Run receipts (host-local, redacted)

The START executor writes its receipts on the operator's machine under
`artifacts/generated/operator-scripts/runs/<card>/<run>/receipt.json`. They are
not in Git. The fields below are copied verbatim from them; local paths, PIDs
and hashes beyond the revision are omitted.

| Card | Run id | Mode / outcome | Phase | Reason (verbatim, truncated) |
| --- | --- | --- | --- | --- |
| start-run-first-unattended-20261101 | 20261101T024607Z-28597 | preflight_ok | P2 state | — |
| start-run-first-unattended-20261101 | 20261101T031235Z-75038 | refused | P4 install_and_worker | "go-broker ensure did not report success; no worker restart was attempted" |
| start-run-unattended-20261101b | 20261101T040024Z-38768 | refused | P4 sign_in | "the diagnostic Agent Ask preview failed [code RECORDS_FAILED; dayClaimed true]" |
| start-run-unattended-20261101c | 20261101T060326Z-62346 | refused | P4 sign_in | "… OPERATOR_SETTLEMENT_SCOPE_MISMATCH …" |
| start-run-unattended-20261101d | 20261101T064034Z-57889 | succeeded (started 06:40:34Z, updated 06:45:06Z) | P6 complete | — |

Card d's receipt also records: reviewed revision installed
`25758fcae9d6c8b8de3d9d9c104f9ce2c3b122fd`; worker binding to that release;
one Haiku renewal and one bound-worker usage check; diagnostic Decision 0164
published to main at `8f6c8fddcdddae2e9bf973c210826e4e9f1e5693`; Plan activated
by this card; `production.activate` to policy revision 84, epoch 47.

## Claims

| ID | Exact factual sentence, summary or number | Pinned public evidence | What it proves and its limits |
| --- | --- | --- | --- |
| S1 | Summary: a START card that could not be made on 31 October started the unattended run on 1 November; nothing admitted for about four hours. | C2, C9, C11 | Live START on the operator's host; delivery not proven. |
| C1 | This ran live on the operator's own machine, against Arcadia's own repository. | [#1929 comment ~06:55Z](https://github.com/pmark/arcadia/issues/1929); run receipts above | Real use, not a fixture. Receipts are host-local; redacted here. |
| C2 | On 31 October the card could not be made: the worker ran from source with no binding, so no sign-in check could pass. | [Issue #1950](https://github.com/pmark/arcadia/issues/1950); [#1929 comment ~23:55Z 2026-10-31](https://github.com/pmark/arcadia/issues/1929) ("blocked before minting the first START card") | Observed blocker. |
| C3 | Decision 0161 let the card bind the worker and renew and check sign-in itself. | [Decision 0161](../../decisions/0161-may-a-per-run-start-card-also-install-a-bound-worker-and-run-one-bounded-claude.md) (answer A, recorded in [#1951](https://github.com/pmark/arcadia/pull/1951)); implemented in [#1952](https://github.com/pmark/arcadia/pull/1952) | Decision and merged code. |
| C4 | Each attempt after that stopped before START and named its cause. | Run receipts table above (`productionActivated: false`, named `reason`) | Observed for every press run listed. Two earlier P0 preflight refusals at 02:45Z (`ARCADIA_WORKSPACE` set; executor hash mismatch) were session-environment and pin checks, also before START, and are omitted from the table. |
| C5 | A host preflight found a process-ID mismatch. | [#1954](https://github.com/pmark/arcadia/pull/1954) "START preflight accepts the source-run worker's child pid"; #1929 comment ~02:50Z ("the host preflight found that defect") | Merged fix. |
| C6 | Build noise in the install's JSON output stopped a press. | Run 20261101T031235Z-75038 (refused at P4 install); [Issue #1956](https://github.com/pmark/arcadia/issues/1956); fix [#1957](https://github.com/pmark/arcadia/pull/1957) | Observed refusal and merged fix. |
| C7 | An absolute file path failed the diagnostic Ask and used up that day's sign-in renewal. | Run 20261101T040024Z-38768 (`dayClaimed true`); [Issue #1958](https://github.com/pmark/arcadia/issues/1958) "the diagnostic Agent Ask cites an absolute path in references, so its preview always fails"; fix [#1961](https://github.com/pmark/arcadia/pull/1961); Decision 0162 rationale | Observed refusal and merged fix. |
| C8 | A settlement-scope check stopped the next. | Run 20261101T060326Z-62346 (`OPERATOR_SETTLEMENT_SCOPE_MISMATCH`); fix [#1964](https://github.com/pmark/arcadia/pull/1964); #1929 comment ~06:55Z | Observed refusal and merged fix. |
| C9 | The operator's direction was "no red tape is allowed to impede progress". | [Decision 0163](../../decisions/0163-may-the-operator-s-next-per-run-start-card-press-authorize-rowan-to-carry-that.md) rationale quotes it | Operator quote as recorded in a Decision. |
| C10 | Decision 0162 removed the daily renewal limit; Decision 0163 let Rowan press retry cards for this run, up to five attempts (#1963). | [Decision 0162](../../decisions/0162-remove-the-once-per-day-ceiling-on-claude-sign-in-renewal-and-worker-check.md) ([#1959](https://github.com/pmark/arcadia/pull/1959)); Decision 0163 ([#1960](https://github.com/pmark/arcadia/pull/1960)); implementation [#1963](https://github.com/pmark/arcadia/pull/1963); ceiling removal also in #1961 | Decisions and merged code. 0163 is bounded to 5 START attempts in 72 hours. |
| C11 | At 06:40 UTC on 1 November Rowan pressed card d; it installed, bound the worker, renewed sign-in, recorded Decision 0164, checked usage, activated the Plan and reached START at 06:45. | Card d receipt (above); [#1929 comment ~06:55Z](https://github.com/pmark/arcadia/issues/1929) ("Rowan's delegated press … SUCCEEDED at 06:45:07Z"); [Decision 0164](../../decisions/0164-authorize-one-start-card-worker-claude-usage-diagnostic-2026-10-31-777fb72e.md) on main at `8f6c8fd` | Observed live START. |
| C12 | As of 11:15 UTC, no work had been admitted for about four hours. | [#1929 comment ~11:00Z](https://github.com/pmark/arcadia/issues/1929) ("Active with no admitted work for about 4 hours") | Observed by Rowan; not independently re-measured here. |
| C13 | Gates held two of the three Actions: a carried-over repair escalation and a superseded Agent Ask, since rejected at the operator's choice. A planning approval then blocked the second, and the third was waiting to launch. | #1929 comments ~06:55Z, ~11:00Z, ~11:05Z (operator choice B; four rejections, receipts `asksettle_74555fdf…` etc.; Action 3 "waiting to launch"), ~11:15Z (R493 "planning approval pending") | Observed. The escalation is from epoch 46 (#1783). Action 3's likely planning gate is not claimed. |
| C14 | Unattended delivery is still unproven. | [Readiness checklist](../../managed-production-readiness.md) row "Unproved: first-unattended-run"; #1929 | Stated limit. |
| C15 | Six lessons are listed on #1929. | #1929 comment ~11:05Z (six `lesson_…` ids) | Captured via `arcadia learn`. |

## Mechanical checks

- Front matter: title, ISO date, `type: ship`, slug, summary, agent author, status, receipt path, `not_done: true`, canonical, `channels: [site, rss]` present.
- Body: 249 words including the limitation section (ship-note range 100–250).
- `## What is not done` names specific gates and the unproven delivery.
- No placeholders; all links are public GitHub URLs or repository-relative paths.

## Independent review

- Reviewer identity and independent lineage: pending
- Reviewed article and receipt revision: pending
- Source revision: ee843dab0ca0de3558c36131ff13d3ad5e9be8b4
- Report: pending
- Verdict: pending
- Findings and resolution: pending

## Delivery handoff

Pending. Destination: the Arcadia Field Notes site on GitHub Pages
(`https://pmark.github.io/arcadia/posts/one-press/`), subject to the
destination Decision and to GitHub Pages being enabled for the repository.
