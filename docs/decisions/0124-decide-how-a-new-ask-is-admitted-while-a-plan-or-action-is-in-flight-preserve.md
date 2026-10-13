---
arcadia: v1
type: decision
id: "0124"
slug: decide-how-a-new-ask-is-admitted-while-a-plan-or-action-is-in-flight-preserve
project: arcadia
status: open
question: "Decide how a new Ask is admitted while a Plan or Action is in flight: preserve current work by default, represent urgency through the existing scheduling authority, and optionally admit bounded independent side Sessions ending at a reviewed green PR."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Preserve in-flight work; offer queued or bounded independent side Sessions
options:
  - label: Preserve in-flight work; offer queued or bounded independent side Sessions
    consequence: Adopt the recommended design for later governed implementation. Ask exposes disposition capture-only, queued (default for approved executable work), independent side Session, or request-interruption; urgency is an ordering request mapped into the existing operator-owned Project preferences and within-Plan queue, never a second scheduling authority. Dependencies and approved scope always filter eligibility. Ordinary arrivals never cancel or replace current work. An independent side Session requires verified operator authorization or an exact standing policy, a free permitted slot, no overlapping claims/files or dependency conflict, isolated candidate, one concrete scoped assignment, explicit model/time/retry limits, and its own auditable identity and evidence. It does not move active_plan/current_action or evade admission, ownership, capacity or review gates. It ends at a PR with independent review and all required checks green; failed or exhausted work ends with preserved evidence and a visible blocker, never a false green. Merge remains separately governed. Interruption requires a pinned operator choice naming the affected Action/Session, checkpoint and preservation/resumption consequences. Production Off blocks new automatic managed admissions in every mode; an explicitly authorized bounded manual test is separate and cannot resume a stopped experiment. Ask response, To-do and shared CLI/API/UI data show disposition, effective order, launch eligibility, why waiting, and linked Session/Run/PR/evidence. No new runtime authority is granted until an implementation Plan and scope are approved.
    recommended: true
  - label: Queue-only intake; defer automatic side Sessions
    consequence: Keep current work running. New executable Asks enter existing approved scheduling controls, and urgency requests only a visible ordering change. No automatic ad hoc lane or implicit interruption. Existing directly authorized manual side work remains available under current guidance. Revive the side-Session capability after deterministic Ask-to-reviewed-PR evidence and verified operator identity are demonstrated. Production remains Off; this choice does not launch or reorder work.
    recommended: false
  - label: Defer policy selection pending a narrower design
    consequence: Keep all existing admission and operator-directed-work rules unchanged. Preserve this question; revisit when the operator specifies the allowed side-work classes and interruption boundaries. Production remains Off, current Plan/Action untouched, and no Session is dispatched.
    recommended: false
confidence: high
plan: every-operator-decision-in-a-production-run-is-a-pinned-decision-card-on-a
updated: 2026-10-13
---

# Decision 0124: Decide how a new Ask is admitted while a Plan or Action is in flight: preserve current work by default, represent urgency through the existing scheduling authority, and optionally admit bounded independent side Sessions ending at a reviewed green PR.

## Options

- **Preserve in-flight work; offer queued or bounded independent side Sessions** (recommended): Adopt the recommended design for later governed implementation. Ask exposes disposition capture-only, queued (default for approved executable work), independent side Session, or request-interruption; urgency is an ordering request mapped into the existing operator-owned Project preferences and within-Plan queue, never a second scheduling authority. Dependencies and approved scope always filter eligibility. Ordinary arrivals never cancel or replace current work. An independent side Session requires verified operator authorization or an exact standing policy, a free permitted slot, no overlapping claims/files or dependency conflict, isolated candidate, one concrete scoped assignment, explicit model/time/retry limits, and its own auditable identity and evidence. It does not move active_plan/current_action or evade admission, ownership, capacity or review gates. It ends at a PR with independent review and all required checks green; failed or exhausted work ends with preserved evidence and a visible blocker, never a false green. Merge remains separately governed. Interruption requires a pinned operator choice naming the affected Action/Session, checkpoint and preservation/resumption consequences. Production Off blocks new automatic managed admissions in every mode; an explicitly authorized bounded manual test is separate and cannot resume a stopped experiment. Ask response, To-do and shared CLI/API/UI data show disposition, effective order, launch eligibility, why waiting, and linked Session/Run/PR/evidence. No new runtime authority is granted until an implementation Plan and scope are approved.
- **Queue-only intake; defer automatic side Sessions**: Keep current work running. New executable Asks enter existing approved scheduling controls, and urgency requests only a visible ordering change. No automatic ad hoc lane or implicit interruption. Existing directly authorized manual side work remains available under current guidance. Revive the side-Session capability after deterministic Ask-to-reviewed-PR evidence and verified operator identity are demonstrated. Production remains Off; this choice does not launch or reorder work.
- **Defer policy selection pending a narrower design**: Keep all existing admission and operator-directed-work rules unchanged. Preserve this question; revisit when the operator specifies the allowed side-work classes and interruption boundaries. Production remains Off, current Plan/Action untouched, and no Session is dispatched.

## Rationale

Operator request on 2026-10-12: production is Off during other work; formally decide how Ask CLI/UI requests interact with the in-flight Plan/Action, including priority/urgency and next-free-slot ad hoc Sessions. This changes scheduling and agent execution authority, not merely the priority of one Action. Decision 0122 governs Project preferences and within-Plan queue order after implementation; Decisions 0048/0054 reject a competing priority store. Decision 0116's actual approved answer is Run the same Project's next Plan. Existing operator-directed-work guidance permits directly instructed side work without pointer changes, but remote Ask requests are signals until operator identity is verified. Production status observed inactive, revision 47, epoch 28, zero live admissions. No production activation, dispatch, interruption, queue change, Decision answer, merge or deployment is requested by this capture.

Proposed by Agent Ask decide-ask-inflight-disposition-2026-10-12.
