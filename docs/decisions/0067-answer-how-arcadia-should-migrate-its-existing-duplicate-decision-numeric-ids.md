---
arcadia: v1
type: decision
id: "0067"
slug: answer-how-arcadia-should-migrate-its-existing-duplicate-decision-numeric-ids
project: arcadia
status: approved
question: Answer how Arcadia should migrate its existing duplicate Decision numeric ids and resolve review item R195's now-dangling reference, so docs sync's new duplicate-id and dangling-reference checks (Issue 268 and Issue 267) have somewhere to point once historical cleanup is authorized.
gap_type: missing-decision
gate_question: reasonable_disagreement
recommendation: Renumber the later duplicates to free ids
options:
  - label: Renumber the later duplicates to free ids
    consequence: Each later duplicate (0004-remaining-protocol-increment and 0005-recheck-readiness-hybrid, keeping the earlier-created file at its original id) is reassigned the next free numeric id, with a docs-sync-visible migration note added to the renamed file. R195 is re-pointed to a newly reserved id restating its original question, since id 0053 is now permanently owned by an unrelated Decision. Decision ids stay a reliable unique handle going forward, matching every existing consumer that keys on them.
    recommended: true
  - label: Make the slug the canonical handle; the numeric id becomes a non-unique display label
    consequence: The existing duplicate ids (0004, 0005) are left as-is permanently, and docs sync's duplicate-id check is relaxed everywhere from refuse-on-new-collision to report-only. Every consumer that currently keys on the numeric id (review items, decision approve <id>, cross-references) would need updating to key on slug instead, which is a larger, separate migration this Decision does not itself authorize. R195 is either re-pointed to whichever document the operator names as its true continuation, or rejected as obsolete if none applies.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-24
answer: Renumber the later duplicates to free ids
decided: 2026-09-24
---

# Decision 0067: Answer how Arcadia should migrate its existing duplicate Decision numeric ids and resolve review item R195's now-dangling reference, so docs sync's new duplicate-id and dangling-reference checks (Issue 268 and Issue 267) have somewhere to point once historical cleanup is authorized.

## Options

- **Renumber the later duplicates to free ids** (recommended): Each later duplicate (0004-remaining-protocol-increment and 0005-recheck-readiness-hybrid, keeping the earlier-created file at its original id) is reassigned the next free numeric id, with a docs-sync-visible migration note added to the renamed file. R195 is re-pointed to a newly reserved id restating its original question, since id 0053 is now permanently owned by an unrelated Decision. Decision ids stay a reliable unique handle going forward, matching every existing consumer that keys on them.
- **Make the slug the canonical handle; the numeric id becomes a non-unique display label**: The existing duplicate ids (0004, 0005) are left as-is permanently, and docs sync's duplicate-id check is relaxed everywhere from refuse-on-new-collision to report-only. Every consumer that currently keys on the numeric id (review items, decision approve <id>, cross-references) would need updating to key on slug instead, which is a larger, separate migration this Decision does not itself authorize. R195 is either re-pointed to whichever document the operator names as its true continuation, or rejected as obsolete if none applies.

## Rationale

docs sync now refuses to register a brand-new Decision whose numeric id collides with an existing one, and reports (without blocking) every already-registered historical duplicate plus every open review item whose backing document no longer exists. Two pairs are live in this repository today: id 0004 (0004-docs-sync-write-back.md and 0004-remaining-protocol-increment.md) and id 0005 (0005-plan-milestone-span.md and 0005-recheck-readiness-hybrid.md). Review item R195 (review_f533ac102d1d47479d) still names docs/decisions/0053-decide-whether-arcadia-should-now-scope-the-separately-approved-action-that-docs.md, a slug that does not exist on disk; id 0053 is now permanently owned by an unrelated Decision (0053-what-may-arcadia-conclude-and-apply-automatically-and-what-must-always-be-escala.md). Renumbering historical documents is invasive (it touches every cross-reference to the old id), so the migration choice and R195's disposition are recorded here rather than applied unilaterally by the Action that added the detection.

Proposed by Agent Ask decide-duplicate-decision-id-migration-2026-09-24.
