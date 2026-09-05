# Bootstrap Managed Production, then use it to build Flight Deck

Latest operator direction, 2026-09-05. This replaces the single-plan sequencing
in the earlier proposals. Separate Plans are the clearest way to keep the
production capability independent and prove Flight Deck is its real workload.

## Two Plans, one Project pointer

| Plan | Produces | How it is built | Completion evidence |
| --- | --- | --- | --- |
| A: Bootstrap managed production to build Flight Deck | Existing worker/Session/queue integration, capacity admission, canonical completion and automatic continuation; minimal control in the existing Work Queue | Initial supervised arcadia go sessions, reusing current implementation | Two dependent test Actions run after one activation; Off, restart, provider/capacity recovery and evidence gates proven; stable controller handoff |
| B: Flight Deck | Full first-stop operator experience over the proven production service | Managed Production launches and supervises its real Actions | Actual board/orientation Actions produced by the controller, followed by the rest of Flight Deck; no manual Session relays |

Proposed Plan A slug is `bootstrap-managed-production-to-build-flight-deck`.
The new-plan Ask allocates the actual slug; verify it before activation. Plan B
keeps `flight-deck-board-carries-the-whole-portfolio-on-one-surface` and its four
existing Action ids. The pending amendments add no second implementation of the
production engine to Plan B.

The current checked-in Project still points at Flight Deck. These supporting
records propose switching to Plan A first; they do not perform that transition.
A new Agent Ask Plan is an inactive draft by contract. Explicit activation must
set the Project milestone, active_plan/current_action and the required model/budget
metadata consistently, plus the approved queue segment. The live Agent Ask
schema does not by itself expose every activation/metadata field. Never claim
that settling Plan creation completes this activation. Resolve the exact supported
governance transition or surface its precise missing operation before dispatch.

Only one Plan/Action pointer is authoritative at a time. Cross-Plan handoff is an
explicit activation/production-scope transition, not a fabricated cross-plan
`depends_on` value (the parser requires local Action dependencies). Runtime
admission checks the accepted bootstrap proof and the current scoped authority.

## No circular UI dependency

Bootstrap exposes controls through `/work-queue` and existing CLI/service paths.
It must not require `/flight-deck`, its rail, its new navigation shell, or any
Flight Deck Action to complete. The same small production control component and
API are subsequently reused by Flight Deck. The existing Work Queue remains an
independent place to see and stop production while the new UI is incomplete.

The first Flight Deck Action produces the basic route/board; the second adds
orientation. Managed Production executes both. The third Action verifies their
real production receipts and operator interventions before treating this as a
successful dogfood. Subsequent Actions build the rest through the same controller.
An independent disposable rehearsal proves the mechanism first, but does not
substitute for this actual Flight Deck build.

## The controller must survive work on its own repository

Arcadia is both the controller and the repository being built. Keep the running
production service pinned to a known-good, identified runtime artifact or isolated
clean runtime checkout. Its source revision, executable paths, dependency/build
resolution, workspace/schema compatibility and recovery command must be proved.
Do not rely on a worktree dependency symlink pointing to a changing main `dist/`.

Agents work on isolated Candidate branches/worktrees. Editing or building the
Flight Deck Candidate must not hot-reload, replace, install dependencies into,
or restart the controller. A browser tab or agent terminal is not its lifecycle
owner. The independent stop/status route stays on the stable runtime.

Controller upgrades follow a separate controlled procedure: turn admissions off,
finish/checkpoint existing work according to the proven policy, validate the exact
new runtime, check schema compatibility and rollback limits, then perform the
explicitly authorized switch and resume. Never let a Candidate self-promote its
controller or run unverified migrations against the production workspace merely
to keep the pipeline moving. A failure uses the known-good recovery route and
preserves all leases, receipts and worktrees for reconciliation.

## What dogfood must prove

1. Activate the approved Flight Deck production scope once.
2. Observe the controller choose the first real Flight Deck Action, select its
   configured provider, prepare/launch its Session and collect validation/output.
3. Where mechanical acceptance and pointer advancement are delegated, observe
   the canonical result and next pointer. If a merge or subjective Decision is
   required, answer that exact judgment through the existing review surface;
   an approval is allowed, manual session coordination is not.
4. Observe the second dependent Flight Deck Action start automatically once its
   gates are satisfied. Link both Sessions, policy and runtime revision, output
   commits, acceptance evidence, Log/pointer receipts and every human intervention.
5. Exercise Off from the existing control, preserving current work; explicitly
   reactivate and verify no duplicate execution. Test worker/browser recovery.
6. Complete the rest of Flight Deck through this same production loop, recording
   actual controller defects as defects rather than normal operator chores.

The operator may still supply product judgment, authorize a PR merge or settle
an actual scope change. They should not create every coding-agent session, relay
packets, pick the next provider, update completion by hand, or remember to restart
production after capacity resets. No new merge/publication/credential authority
is inferred from the desire to dogfood.

## Current review package

- [19](./19-managed-production-bootstrap-ask.yaml): create Plan A with 14 bounded
  Actions; no activation claimed.
- [14](./14-flight-deck-plan-amendment.yaml): amend Plan B to 17 Actions, preserving
  the four existing ids and consuming the proven production engine.
- [13](./13-flight-deck-delivery-sequence.md): both sequences and handoff order.
- [15](./15-flight-deck-acceptance-matrix.md): full operational tests plus the
  self-hosted production scenarios below.

Earlier 20- and 27-Action proposals remain unsettled historical receipts, not
alternate things to execute. At approved settlement, explicitly dispose of old
versions under operator authority. Do not apply both an old combined Plan and
these separate Plans. The new separation is the operator's chosen direction;
merge, canonical settlement and activation still need the exact applicable
review/authority steps, without re-asking whether the Plans should be separated.

Quality and release gates: [20](./20-production-quality-and-reliability.md) adds criterion-level revision-bound acceptance, independent review, fault injection and a bounded live soak. The revised bootstrap Ask incorporates these gates without adding a second implementation or changing its 14-Action order.
