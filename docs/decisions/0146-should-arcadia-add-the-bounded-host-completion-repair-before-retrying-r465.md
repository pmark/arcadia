---
arcadia: v1
type: decision
id: "0146"
slug: should-arcadia-add-the-bounded-host-completion-repair-before-retrying-r465
project: arcadia
status: approved
question: Should Arcadia add the bounded host-completion repair before retrying R465, while keeping the live workspace protected?
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Bounded repair; keep workspace protected
options:
  - label: Bounded repair; keep workspace protected
    consequence: Authorize one separately governed repair Action with the stated done-condition, within the current Plan and remaining 24-hour window. Use a fresh named implementer at the configured standard/medium target with existing light start; its build packet, independent review, checks and adoption keep their gates. Failed R465 stays preserved; a later live attempt requires its own fresh protected confirmation, with no counter reset. Current failed builder has ended; coordinator stops at this gate, and a resumed/fresh Rowan heavy/high must verify actual prompt delivery before claiming work started. Production stays Off.
    recommended: true
  - label: Hold live delivery
    consequence: No machinery edits, permission changes, model retry or new runtime adoption. Preserve the failed Session, all criteria and current Plan as incomplete; Production remains Off. The failed builder has ended and coordinator stops at this gate; no successor or wakeup is armed. Revival requires an explicit bounded repair approval and a resumed/fresh Rowan heavy/high with valid authority.
    recommended: false
confidence: high
plan: make-arcadia-go-orient-one-caller-truthfully-before-authorized-work
updated: 2026-10-28
answer: Bounded repair; keep workspace protected
decided: 2026-10-28
---

# Decision 0146: Should Arcadia add the bounded host-completion repair before retrying R465, while keeping the live workspace protected?

## Options

- **Bounded repair; keep workspace protected** (recommended): Authorize one separately governed repair Action with the stated done-condition, within the current Plan and remaining 24-hour window. Use a fresh named implementer at the configured standard/medium target with existing light start; its build packet, independent review, checks and adoption keep their gates. Failed R465 stays preserved; a later live attempt requires its own fresh protected confirmation, with no counter reset. Current failed builder has ended; coordinator stops at this gate, and a resumed/fresh Rowan heavy/high must verify actual prompt delivery before claiming work started. Production stays Off.
- **Hold live delivery**: No machinery edits, permission changes, model retry or new runtime adoption. Preserve the failed Session, all criteria and current Plan as incomplete; Production remains Off. The failed builder has ended and coordinator stops at this gate; no successor or wakeup is armed. Revival requires an explicit bounded repair approval and a resumed/fresh Rowan heavy/high with valid authority.

## Rationale

Observed session_f5bd5319d14440c485 received the approved R465 packet and ran its required first probe, which reported workspace_write EPERM. The model faithfully stopped without editing; exit_9b9babb972b444e59d is missing_evidence, no Run/Artifact/changes, with sessionCapability.status wall. Independent read-only Process Critic: the unconditional workspace-write probe contradicts the existing local complete-Ask-to-host path (reconciliation.ts562-618; agentAsk.ts175-243; agent-ask-draft.test.ts58-77). Do not grant direct live-workspace writes or report the denied capability as passed. Exact configuration-layer attribution remains unverified; no extra probe was run. Proposed repair Action id repair-host-owned-source-completion-capabilities, in the existing current Go Plan before implement-go-live-delivery-checklist. Preserve the probe's three criteria, parent's four and final Action's six; only approved governed amendment may add the repair dependency/temporary pointer and restore the probe next. Done-condition: host-derived completion requirements bound to Session, packet and nonce; restricted-environment regression proves source-only scoped edits plus a validated local complete Ask with preview_blocked can reach genuine host validation and settlement while live DB writes remain denied. Required direct-write denial, missing local Ask transport/host readiness and malformed, mismatched or spoofed evidence still refuse; model cannot select weaker requirements. Independent current-head review, required CI and separately receipted reviewed adoption precede any fresh live confirmation. No permission broadening, outcome rewrite, counter reset, new default, paid fallback, credential probe or Production START. Existing human-renewed authority expires 2026-10-29T23:01:53Z; this Decision does not extend it. This request opens only a Question, not execution or a self-approved repair.

Proposed by Agent Ask decide-r465-host-completion-repair-20261028.
