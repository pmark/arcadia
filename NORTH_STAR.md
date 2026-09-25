---
type: north_star
target: Automated production is live for Arcadia
project: arcadia
why: Once the worker takes an Action from the queue to a landed change with no operator in between, every other Plan in every Project is built faster and cheaper than any hand-driven session can build it. Everything else waits for this.
looks_like: With production activated once, the worker launches Action A, preserves and lands it, and launches the dependent Action B with no operator step in between. prove-two-action-unattended-production records that run.
updated: 2026-09-25
gates:
  - id: preservation-refusals-actionable
    title: A refused preservation names its failing check, and a Session stops after a bounded number of identical refusals
    action: plan/bootstrap-managed-production-to-build-flight-deck#name-failing-preservation-check-and-bound-retries
  - id: policy-providers-honored
    title: Launch selects only providers the standing policy permits, or surfaces the mismatch once
    action: plan/bootstrap-managed-production-to-build-flight-deck#honor-policy-providers-at-launch
  - id: unpreservable-sessions-refused
    title: A Project with no validation commands is refused before a Session is spent on it
    action: plan/bootstrap-managed-production-to-build-flight-deck#refuse-packets-without-validation-commands
  - id: two-action-proof
    title: Two dependent Actions run from one activation with no operator step between them
    action: plan/bootstrap-managed-production-to-build-flight-deck#prove-two-action-unattended-production
---

# Arcadia North Star

This is **Arcadia's own** target. The workspace `NORTH_STAR.md` stays the
portfolio-wide target. Arcadia reads only the workspace file today, so this
file is for people and agents until `support-per-project-north-star` teaches
the loader to read it. It uses the same schema, so it becomes live without an
edit. It deliberately omits the `arcadia: v1` marker: `docs sync` does not know
the `north_star` type yet and would report this file as a schema error in
Arcadia's own repository. `support-per-project-north-star` should register the
type and restore the marker.

## Why this target, and why now

Every Plan in every Project goes faster once the worker can carry work from the
queue to a landed change unattended. The shortest path is therefore the only
path worth working. `arcadia go` in this repository is held to it by three
separate controls:

- **This Plan's off-path Actions** depend on
  `prove-two-action-unattended-production`, directly or transitively, so
  dispatch cannot select them until the proof has run.
- **`prove-zero-prompt-production-loop`** is operator-only
  (`responsibility: requires_review`), so dispatch never selects it.
- **Other Plans' ready Actions** wait for the pointer. Dispatch never selects
  them while this Plan is active and incomplete.

## The gates

Each gate takes its status from the Action it names, so this list never needs
maintaining by hand. Gates already passed were dropped rather than listed as
done: releasing finished Sessions' admissions (#610), preserving candidates
across a moved base (#539), withholding worker control from Sessions (#611),
and not killing busy workers (#617).

The one operator step is not a gate. After the first three gates pass, the
operator reverses Decision 0057's deferral and starts the rehearsal. That is the
revival trigger Decisions 0057 and 0061 recorded.

`docs/managed-production-readiness.md` carries the derivation behind this list.
It is re-derived whenever a gate moves.

## After the target

Continuous production (`prove-multi-provider-production-recovery`,
`run-managed-production-live-soak`) comes next, followed by every Action held
behind the proof. Removing that sequencing dependency is one Plan amendment.
