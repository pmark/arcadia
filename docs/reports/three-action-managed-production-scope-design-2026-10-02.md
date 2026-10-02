# Three-Action managed-production scope design

This is preparation for operator judgment, not accepted work, a pointer change,
an immutable packet replacement or production authority.

## Verified prerequisite publication

Run `20261002T164449Z-98726/publication.json` confirms publication of exactly
`ec53674aaaad0148e3ed7e6f3da3a9bb75ab3d64` and
`a5a6844e751a6441576871b8b20ae8ccf2ab9d6e`; remote main independently matched
the latter. `canonical-applied-observation.json` preserves settlement
`asksettle_92f59561766c40079e` with `applied:true`, unchanged operator acceptance
and `settlementReapplied:false` in the publication receipt. The live one-shot
button is succeeded. Earlier failures and both commits remain retained. Do not
offer or revive that button again.

## Proposed three actual implementation records

1. Keep `persist-inactive-production-configuration` and its six criteria.
2. Amend `enroll-session-through-governed-host-request`, keeping its identity
   and six criteria verbatim, adding the three durability criteria and the
   saved-configuration dependency.
3. Create `prove-installed-three-action-autonomous-rehearsal`, dependent on
   both prerequisites, with the seven prepared evidence criteria.

The separate disposable repository still has exactly one active Plan,
`autonomous-three-action-rehearsal`, and exactly `write-start-marker`,
`transform-start-marker`, `verify-final-rehearsal`. The older literal split,
browser and ledger Action remains open. Four records are never called three.

The initial local-review design had high one-session risk. The narrower design
uses an actual disposable GitHub repository with CodeRabbit and required checks,
existing PR QA and existing remote preservation. Independent read-only planner
`/root/scope_planner` and adversary `/root/scope_adversary` inspected the seams;
the adversary judges this revised route plausibly one heavy/high session. That
is a sizing estimate, not a guarantee or completion evidence. The helpers are
not governed Sessions, admissions or mutation owners.

## Finite missing implementation

| Seam | Existing mechanisms to reuse | Bounded missing behavior |
| --- | --- | --- |
| Enrollment | `src/sessions/goRequestExecutor.ts`, `preservationTransport.ts`, `launch.ts`, `index.ts` | Fixed request identity, caller and mode binding; derive governed Action, approved packet and candidate on the host; replay the original receipt; managed launch reuses guarded launch/admissions; unsupported native adoption refuses before mutation. |
| Five role attempts | `src/db/schema.ts`, `src/db/connection.ts`, admission replay and Session terminal reconciliation | One additive fixed-role lineage store: requirement/input identity, unique transport ID, role and bounded ordinal, observable actor/host execution identity and terminal receipt. Atomic retry allocation requires terminal failure and exact current authority. Existing executors perform work; no new role framework or scheduler. |
| Independent verdicts | `src/qa/prReview.ts` readiness, immutable evidence, read-only execution and stale-evidence checks; CodeRabbit actor/reviewed commit | Host-derived independent QA execution identity and exact head/criteria/evidence binding. CodeRabbit's actual actor and reviewed head supply code review; an aggregate approval label or developer assertion cannot substitute. |
| Serial handoff | `src/production/tick.ts`, `sessionHandoff.ts`, candidate preservation and same-candidate completion | Consume both current independent verdicts; recheck head, evidence and Grant; durable bounded draft-to-ready/review waiting survives restart. Existing lease, serial dependency, restart and Off paths remain authoritative. |

Current preservation creates draft PRs, while PR QA refuses drafts. The later
Grant must explicitly cover publication, PR readiness and bounded integration
for the exact disposable repository; that authority is not granted here.
Confirm its CodeRabbit installation and required checks before live dispatch.
If those are unavailable, report the external gate rather than creating an
unbounded replacement reviewer.

Focused proof covers migration, two-connection ordinal races, replay and changed
identity refusal, bounded terminal retries, no orphan claims/admissions,
developer-verdict refusal, stale head/criteria/evidence, three serial integrations,
restart replay and between-Action Off. Reuse existing transport, launch, QA,
preserve/integrate and production-tick suites. Deterministic readiness precedes
reviewer inference. Packet bindings are never silently rebound.

## Writer and custody boundaries

The shared `arcadia-plan-amendment-v1` runner changes one existing Action only.
Its exact envelope preserves every other Action, Project/Plan pointer and queue.
Creating rehearsal is a separate Action Ask; `advance queue make-next` is a
separately fingerprinted pointer transition after acceptance and clean-state
validation. Queue position is not execution authority.

The mixed dirty primary checkout currently prevents protected Go and the shared
amendment runner. Protected Go exempts canonical untracked drafts but not the
modified library pair/readiness/notes/AGENTS or narrative reports. Legacy Ask
recovery handles only a sole dirty Ask. Protected preservation requires an
already registered Session/manual candidate; main has no such binding.

The documented operator recovery playbook in `docs/working-copy-safety.md` is the
bounded preparation route: preserve the explicitly pinned mixed documents and
inputs on a named recovery branch and publish its review PR. This is disclosed
operator-owned recovery, not a new broker capability or governed candidate. It
does not mark the literal proof done, settle any Ask, move a pointer, merge,
install, restart, activate production or consume a rehearsal Grant. Main's ref
and original history remain intact; the checkout may stay on the recovery
branch until reviewed integration and protected continuation.

The operator's separate learning contribution in `AGENTS.md`,
`docs/notes-to-self.md`, `docs/reports/autonomous-production-session-friction-2026-10-02.md`
and its validated Log Ask must travel with this preparation. Preserve their
failed-preview evidence and source history; no canonical Log is claimed until
an authorized settlement receipt exists.
