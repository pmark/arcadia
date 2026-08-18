---
arcadia: v1
type: decision
id: "0028"
slug: ppn-capability-reconciliation
project: arcadia
status: open
question: Which capabilities Private Practice Now built locally does Arcadia promote for every project, which are deleted there as superseded, and which are struck as never-implemented?
gap_type: missing-decision
recommendation: >-
  Promote three - trigger evaluation over governed documents, the operator task
  ledger, and the demo proof-target registry. Retire four from PPN as already
  provided by Arcadia (docket, advance, report, go). Strike nine from PPN's
  capability registry as declared-but-never-built, and defer `capabilities`
  behind a trigger. Sequence trigger evaluation first, because Arcadia is
  currently writing deferrals in nine of its own governed documents that
  nothing can evaluate.
confidence: high
updated: 2026-08-17
---

# Reconciling what PPN built locally

## Context

Private Practice Now's `scripts/arcadia.mjs` is 1,064 lines, and its
`.arcadia/arcadia-way/capabilities.json` declares 21 commands. Ten are
implemented. Eleven were never built.

This is the reconciliation Decision 0025 was written to make possible, and
[PPN proposal 0001](../../../PrivatePracticeNow/platform/docs/proposals/0001-promote-locally-built-capabilities.md)
is the first document filed under it. Verified working on 2026-08-18: the
proposal was committed in PPN and `arcadia docs sync` discovered and ingested
it from this repository with no new channel, exactly as 0025 specified.

The operator's own framing is the correct diagnosis and belongs in the record:
these capabilities were described to coding agents as things Arcadia should do,
and the agents built them where they were standing rather than in Arcadia or
through a formal request. There was no formal request path until 0025. The
work is not waste, and PPN is not at fault — but it is in the wrong repository,
and some of it is now actively harmful there.

## The ruling

### Promote — general, and absent from Arcadia

**1. Trigger evaluation over governed documents.** Highest priority, and the
reason to sequence this first is embarrassing: nine of Arcadia's own Decisions
and plans currently declare deferrals with stated reviving conditions, and
Arcadia cannot evaluate one of them. Every `**Trigger:**` clause written into
0021 through 0027 and into `arcadia-way-propagation` is prose that no command
reads. The Way instructs agents to trust `arcadia triggers`; in this repository
there is nothing to run.

Note carefully what is *not* the gap. `back_burner_items` already carries
`surface_kind`, `surface_date`, `surface_dependency_status`, and
`surface_predicate` — Arcadia can evaluate surfacing conditions on captured
database items. What it cannot do is evaluate a deferral declared in a managed
document. Those are different layers, and the document layer is the one the
Constitution calls authoritative.

PPN's implementation reads a `.arcadia/triggers.json` registry and evaluates
`count` and `observed` condition kinds against files in the repository. It is
repo-local and pure, which means it fits the same shape as `resolveDispatch`
and would work in a container.

**2. The operator task ledger — `todo`, `needs`, `done`, `decline`.** Ratified
in PPN as its ADR 0025 on 2026-08-14. Append-only JSONL; every entry cites an
action or decision already in project control and states why an agent cannot do
it; agent-supplied evidence is separated from operator closure; `done` and
`decline` are operator-only.

Arcadia has adjacent concepts and none of them is this. `attention` surfaces
Decisions awaiting Approve/Reject/Defer — decision review. `back-burner` holds
captured ideas awaiting a surfacing condition. Neither records "an agent is
blocked because a person must go create a resource in a third-party console,"
which is the single most common way work actually stalls. The separation
between an agent attaching evidence and an operator closing the entry is the
part worth copying exactly.

**3. The demo proof-target registry.** PPN's `.arcadia/demo.json` carries
versioned targets with a `primary` flag, per-target URLs, live reachability
probing with timeout and retry, and a portfolio-level go/no-go `signal` with
its `blocking` reasons attached, so a link never travels without its verdict.

Arcadia's active Action `build-demo-hero-vertical-slice` is specified to build
a proof-target contract with URL, environment kind, source revision, access
state, health state, and last verification time — and names PPN as its fixture.
Working prior art for that contract already exists in the fixture. Whoever runs
that Action should read `.arcadia/demo.json` and `demo()` before designing
anything.

### Retire from PPN — Arcadia already provides these

`docket`, `advance`, and `report` are implemented in both repositories. `go` is
declared in PPN and implemented here.

These are not merely redundant, they are unsafe. Because `arcadia` on the
operator's `PATH` resolves to a global script that unconditionally executes
Arcadia's CLI, running bare `arcadia docket` from PPN returns *Arcadia's*
dispatch state with no indication the wrong project was read. Verified
2026-08-18. `arcadia done` failing loudly that day was the safe version of the
same collision; these three fail silently.

Deleting PPN's copies removes one half of the collision. The other half — that
the bare name `arcadia` on `PATH` belongs to a Codex skill script rather than
to a project's own CLI — is outside both repositories and is not settled here.

### Strike from PPN's registry — declared, never built

`focus`, `decide`, `record`, `hold`, `atlas`, `history`, `council`,
`expedition`, and `ask` carry full invocation strings in `capabilities.json`
and have no implementation. An agent reading that registry cannot tell them
apart from the working ones. `status: specified` is honest metadata, but the
registry is consumed as a command list, and nine phantom entries in it is a
trap of the same family as the one that produced today's error.

Strike them. Any that is genuinely wanted can be re-proposed individually under
0025, which now costs a document rather than an implementation.

### Defer

`capabilities` — a command that lists the registry. Arcadia already *validates*
this file: `src/docs/capabilities.ts` blocks dispatch when a command declares
`kind: "query"` with `mutates: true`. It cannot list it. Genuinely useful,
genuinely minor.

### Stays in PPN

`plan` renders PPN's own session brief in PPN's own format, and Arcadia has
`work plan`. No promotion.

## What approval would settle

- Three capabilities become Arcadia's to build, as Actions on `way-delivery`.
- PPN may delete `docket`, `advance`, `report`, and `go` from its shim once the
  promotions land, and may strike the nine phantom entries immediately.
- The 1,064-line shim has a defined end state rather than an open-ended one.

## Keep triggered

| Increment | Reactivate when |
| --- | --- |
| `capabilities` as a listing command | An agent or operator is misled by the registry a second time, or a third project adopts one. |
| Re-propose any struck command | Someone states the concrete work it would unblock, as a proposal under 0025. |
| Resolve the bare-`arcadia` name collision | The operator decides how the global script should behave; this Decision deliberately does not settle it. |
| Promote PPN's `plan` brief renderer | A second project wants the same brief format, which would make it general rather than local. |

## What this Decision does not authorize

- It does not implement any of the three promotions. Each becomes an Action
  with its own gate.
- It does not delete anything in PPN. That is a change in PPN's repository,
  made there, after the promotions land.
- It does not change the global `arcadia` binary or the `arcadia-go` skill.
- It does not alter Decision 0026's deferred migration or Decision 0027's
  deferred schema change.
