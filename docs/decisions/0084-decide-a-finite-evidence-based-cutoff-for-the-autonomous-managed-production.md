---
arcadia: v1
type: decision
id: "0084"
slug: decide-a-finite-evidence-based-cutoff-for-the-autonomous-managed-production
project: arcadia
status: approved
question: Decide a finite evidence-based cutoff for the autonomous managed-production milestone and the condition that shifts Arcadia's primary engineering priority to same-repository parallel production, without treating an unfinished proof as complete or granting concurrent live execution.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Use a two-stage finite cutoff
options:
  - label: Use a two-stage finite cutoff
    consequence: "Recommended. Start a non-resetting 14-calendar-day Stage A clock when this Decision answer is committed. Finish the reviewed run-3 preparation and allow one fresh exact three-Action rehearsal. After an eligible Arcadia product failure, allow at most one targeted repair and one fresh retry only when a deterministic replay reproduces the failed gate, the repaired replay passes it, and the retry names the next unproved stage it tests. A repeat Arcadia failure at that gate, an unplanned manual Session relay, no complete three-Action chain with terminal Off after the retry, or the Stage A deadline triggers a priority pivot. If Stage A passes, start a non-resetting 21-calendar-day Stage B clock from its accepted live receipt. Pursue the remaining mandatory evidence: literal same-candidate continuation, actual browser-close/Off and complete intervention ledger, current fault matrix, both-provider Actions, the Contract-20 ten-Action/two-Project soak, operator controls and current release index. Permit at most one targeted repair/replay per newly failing mandatory stage without extending the clock. A stage still failing after its permitted repair and replay, or any mandatory evidence still unproven at the Stage B deadline, triggers the pivot. Classify absent Grant or provider capacity as evidence unavailable rather than a product defect; it still does not extend either clock. At a pivot, preserve unfinished Actions and receipts, record the reason and revival condition, and make same-repository parallel production the primary planning and engineering priority through a canonical Plan/queue amendment. Fix any safety-critical showstopper under existing stop-the-line rules. The trigger grants no live concurrency, merge, production, spending or credential authority."
    recommended: true
  - label: Pivot after the third rehearsal
    consequence: Run the fresh third rehearsal once after its scripts are reviewed. If an eligible Arcadia failure prevents the complete three-Action chain and terminal Off, shift priority immediately to same-repository parallel production. Lack of provider capacity or a Grant is recorded separately as evidence unavailable and needs its own operator review. This limits rehearsal cost but may abandon a near-term proof after the specific run-2 QA blocker was repaired.
    recommended: false
  - label: Keep proof-first sequencing
    consequence: Continue the autonomous milestone and its current dependencies without a fixed attempt or availability cutoff. Parallel production remains behind Decision 0066's existing trigger; repeated rehearsals may keep consuming the only Arcadia repository lane until the full live proof succeeds or a later operator Decision changes course.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-05
answer: Use a two-stage finite cutoff
decided: 2026-10-05
---

# Decision 0084: Decide a finite evidence-based cutoff for the autonomous managed-production milestone and the condition that shifts Arcadia's primary engineering priority to same-repository parallel production, without treating an unfinished proof as complete or granting concurrent live execution.

## Options

- **Use a two-stage finite cutoff** (recommended): Recommended. Start a non-resetting 14-calendar-day Stage A clock when this Decision answer is committed. Finish the reviewed run-3 preparation and allow one fresh exact three-Action rehearsal. After an eligible Arcadia product failure, allow at most one targeted repair and one fresh retry only when a deterministic replay reproduces the failed gate, the repaired replay passes it, and the retry names the next unproved stage it tests. A repeat Arcadia failure at that gate, an unplanned manual Session relay, no complete three-Action chain with terminal Off after the retry, or the Stage A deadline triggers a priority pivot. If Stage A passes, start a non-resetting 21-calendar-day Stage B clock from its accepted live receipt. Pursue the remaining mandatory evidence: literal same-candidate continuation, actual browser-close/Off and complete intervention ledger, current fault matrix, both-provider Actions, the Contract-20 ten-Action/two-Project soak, operator controls and current release index. Permit at most one targeted repair/replay per newly failing mandatory stage without extending the clock. A stage still failing after its permitted repair and replay, or any mandatory evidence still unproven at the Stage B deadline, triggers the pivot. Classify absent Grant or provider capacity as evidence unavailable rather than a product defect; it still does not extend either clock. At a pivot, preserve unfinished Actions and receipts, record the reason and revival condition, and make same-repository parallel production the primary planning and engineering priority through a canonical Plan/queue amendment. Fix any safety-critical showstopper under existing stop-the-line rules. The trigger grants no live concurrency, merge, production, spending or credential authority.
- **Pivot after the third rehearsal**: Run the fresh third rehearsal once after its scripts are reviewed. If an eligible Arcadia failure prevents the complete three-Action chain and terminal Off, shift priority immediately to same-repository parallel production. Lack of provider capacity or a Grant is recorded separately as evidence unavailable and needs its own operator review. This limits rehearsal cost but may abandon a near-term proof after the specific run-2 QA blocker was repaired.
- **Keep proof-first sequencing**: Continue the autonomous milestone and its current dependencies without a fixed attempt or availability cutoff. Parallel production remains behind Decision 0066's existing trigger; repeated rehearsals may keep consuming the only Arcadia repository lane until the full live proof succeeds or a later operator Decision changes course.

## Rationale

The 2026-10-05 read-only audit found that run 2 preserved only the first Action and passed code review; QA stopped at the missing Operator QA plan, now repaired in PR #969, and G8 proved terminal Off. Run 3 is planned, with its scripts still being prepared under the current Action; no live run-3 success is claimed. Mandatory release proof also includes literal same-candidate continuation, actual browser-close/Off and intervention-ledger evidence, remaining fault-matrix proof, both-provider work, and the Contract-20 ten-Action/two-Project live soak and operator controls. docs/managed-production-readiness.md was last derived on 2026-10-02 and is not a current completion scoreboard. Decision 0066 defers two live Sessions in one repository. This Decision would govern sequencing only; every Grant, production activation, authority change, and same-repository concurrent Session still needs its own existing gate or a further Decision. This v3 supersedes the uncommitted preview-only proposals decide-autonomy-cutoff-parallel-pivot-2026-10-05 and decide-autonomy-cutoff-parallel-pivot-2026-10-05-v2 after independent review corrected ambiguous start, retry, and Stage B failure conditions.

Proposed by Agent Ask decide-autonomy-cutoff-parallel-pivot-2026-10-05-v3.
