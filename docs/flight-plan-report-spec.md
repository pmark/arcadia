---
arcadia: v1
type: reference
slug: flight-plan-report-spec
project: arcadia
updated: 2026-09-09
---

# Flight Plan — report specification

A forward-looking executive report: what work is committed, what it will cost in
continuous building hours, and how much token exposure is in flight at once.
Named to pair with Flight Deck — a flight plan states the route, the waypoints,
the ETA, and the fuel aboard.

Status: specification and measured prototype. Not built. Sequenced behind stale
Action triage, for the reason in [Why triage lands first](#why-triage-lands-first).

## What it is not

`arcadia docket` reads one repository with no workspace and answers "what is next
here." `arcadia portfolio` reads the database and gives project-level status and
clarity counts. `arcadia report daily|weekly` looks backwards at what moved.
None of them answer "how long is the committed work, and can I afford it this
week." That is the gap this fills, and it is why this is a sibling command
rather than a flag on `docket` — `docket` is deliberately single-repository and
database-free, and a portfolio mode would contradict its own contract.

## Shape

A read-only noun command. Portfolio-scoped, deterministic, no writes, and no
model call on the default path.

Sources, joined on `work_items.doc_ref` = `plan/<slug>#<action-id>`:

- the workspace database — `projects`, `work_items` where status is not done,
  and `milestones`;
- each project's `<repo_path>/docs/plans/*.md` frontmatter, for plan `status`,
  `token_impact`, `token_budget`, and `current_action`.

Documents win on status and token fields, per the authoritative-documents rule
in [managed-documents.md](managed-documents.md).

## The four buckets

Bucketing on plan document status is what makes this a plan rather than a list.

| Bucket | Selected by | Means |
| --- | --- | --- |
| Committed | plan `active` | Real dispatch authority. The ETA that counts. |
| Queued | plan `draft` or `proposed` | Real work, not yet claimable. |
| Adrift | plan `complete` or `superseded` | A defect. Reported as one, with the pointer-chain reason. |
| Unplanned | no plan `doc_ref` | Captured intent that was never planned. |

## Estimate arithmetic

Reuses `EFFORT_CEILING_MINUTES` from
[`src/orientation/effort.ts`](../src/orientation/effort.ts) and introduces no new
constants. The low bound of each tier is the previous tier's ceiling:

| Effort | Band |
| --- | --- |
| `quick` | 0–0.25h |
| `short` | 0.25–1h |
| `session` | 1–3h |
| `project` | excluded — unbounded by definition, counted as *needs breakdown* |
| unsized | excluded, counted |

Hours are continuous building only. Review, QA, and operator feedback are
deliberately outside the number, because mixing them produces an estimate that
is wrong in a way nobody can decompose.

**Any band that excluded something is labeled a floor, never an ETA.** This is
the rule that keeps the report honest, and on today's data it fires constantly.

## Fuel

Committed plans grouped by `token_impact` tier. Never a token count and never a
dollar figure — [arcadia-semantics.md](arcadia-semantics.md) defines Token Impact
as relative exposure, not a forecast, and a fabricated number here would be worse
than no number.

The decision signal is concurrency: how many heavyweight plans are simultaneously
active. On the measured run that was three `xlarge` and six `large` plans at once.

## Weeks

When daily capacity is set, convert hours to weeks. When it is not, say so and
name the command that fixes it. The measured workspace had no capacity set, so
the report says exactly that rather than inventing a delivery date.

## Selection

Default to projects with status `active`, with `--project a,b` to combine an
explicit set and `--all` as the escape hatch.

Deliberately **not** a new "selected projects" concept. The first measured run
included six projects because all six are status `active` in the database, while
only two are actually being worked. The fix is correcting those statuses —
`status` already carries this meaning, and the vocabulary is fixed.

## Caching

The deterministic report needs no cache. Measured against the live six-project
portfolio, including reading six repositories' plan documents from disk:

```
real 0.10    real 0.08    real 0.08
```

At 80ms a cache buys nothing and costs invalidation bugs and staleness.

Local AI is genuinely slow, but it is the only layer that needs caching, and the
stale-Action triage plan already builds exactly that: a classification cached
against a content hash of the Action and its plan status, making zero model calls
when nothing changed. Flight Plan's optional `--narrate` reuses that cache rather
than introducing a second one.

## Hard rules

- No model call on the default path. `--narrate` runs one bounded pass through
  the local LiteLLM route only — a report about the token budget must never
  spend it.
- No guessed sizes, no invented token numbers, no silently omitted Actions.
  Every excluded Action is counted in the open where it was excluded.
- `--json` from the first version. Flight Deck's Orientation section needs these
  same numbers, and a second implementation would drift from this one.

## Why triage lands first

The prototype found that 79 of 134 open Actions carry no effort size, so the
report's honest output for most of the portfolio is "size these first." Flight
Plan reads the data that triage produces. Built in the other order, it is a
well-made instrument pointed at missing data.

## Measured findings, 2026-09-09

From the prototype run in [`scripts/flight-plan-prototype.mjs`](../scripts/flight-plan-prototype.mjs):

```
ETA TO CLEAR THE BOARD
  Committed   active plans          22.5–68h      63 Actions  (+5 unbounded, +34 unsized)
  Queued      draft/proposed plans  10.75–33h     15 Actions  (+2 unbounded)
  Adrift      complete/superseded   5.25–16.25h   9 Actions   (+2 unbounded)
  Unplanned   captured, no plan     0.25–1.25h    44 Actions  (+42 unsized)

SIZING COVERAGE — the report is only as good as this
  Arcadia                   80% sized  (48/60) · 9 need breakdown
  Living Songbook          100% sized  (1/1)
  Martian Rover              0% sized  (0/8)
  Private Practice Now      19% sized  (5/27)
  Rebuster                   0% sized  (0/34)
  Zero Prompt Rehearsal    100% sized  (1/1)
```

Nine Actions are adrift on `complete` or `superseded` plans across Arcadia and
Private Practice Now, unreachable through the pointer chain. That is the finding
that produced the triage plan.

## Open debt this surfaced

- `work_items.status` has no terminal state meaning "decided not to do", which is
  why Actions go adrift instead of being retired. Addressed by the triage plan.
- `token_impact` and `token_budget` live only in plan documents, so a
  portfolio-wide read must open every project's repository. Persisting them at
  `docs sync` would make the report database-only and safe to run where the
  repositories are not checked out.
- Generated plan slugs truncate mid-word, producing slugs like
  `...organic-search-readi`.
- `assertClean` requires the whole repository to be clean before a settlement,
  even when the dirty paths are unrelated to the managed documents being
  written. Multiple Agent Ask input files already work via `--file`; this is the
  constraint that actually makes them awkward to use.
