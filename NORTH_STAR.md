---
type: north_star
target: Production runs for long unattended stretches
project: arcadia
why: 'The operator plans a day at a time: planning and design fill an approved queue; work that needs his merge runs in the day lane and reaches him in batches, and autonomous work runs in the night lane. Every Project is built faster as the hours between operator-needed stops grow and no night is empty. Unattended-run reliability breaks ties.'
looks_like: "Each night production runs the night lane's approved work with no operator step; each day the day lane's pull requests reach him in batches; the 8 AM report shows the hours between operator-needed stops rising and no empty night."
updated: 2026-11-20
gates:
  - id: merges-without-a-person-under-checked-conditions
    title: Merges happen without a person under checked conditions
    action: plan/draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production#worker-applies-standing-merge-conditions
  - id: one-failure-never-ends-the-night
    title: One failure never ends the night
    action: plan/draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production#park-and-continue
  - id: both-lanes-filled-across-approved-plans
    title: Both lanes are filled across approved Plans
    action: plan/draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production#queue-approved-plans-and-start-the-next
  - id: every-overnight-merge-reverified
    title: Every overnight merge is reverified at 8 AM
    action: plan/draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production#verify-overnight-merges-at-8am
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

Every Plan in every Project goes faster as production runs longer without an
operator-needed stop. The order of work toward that is in `docs/roadmap.md`,
and how planning ranks and fills the two lanes is in `docs/planning-process.md`.

## Measures

Hours between operator-needed stops, read from the 8 AM report, and empty
nights per week; the target is zero empty nights.

## History

The one-click whole-Plan goal was retired as superseded on 2026-11-18 ("what we
have is better ... There's a big process of planning and design that creates a
queue of work. Right now we're doing it a day at a time, and that seems good.").
On 2026-11-19 the operator made long unattended stretches the target, with day
and night lanes.

## The gates

Each gate takes its status from the Action it names, so this list never needs
maintaining by hand.

`docs/managed-production-readiness.md` carries the derivation behind this list.
It is re-derived whenever a gate moves.

## After the target

Plan G comes next, then the host-coordinators Plan, then concurrency behind
Decisions 0066 and 0071.
