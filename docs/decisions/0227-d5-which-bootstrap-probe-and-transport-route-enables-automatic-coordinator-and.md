---
arcadia: v1
type: decision
id: "0227"
slug: d5-which-bootstrap-probe-and-transport-route-enables-automatic-coordinator-and
project: arcadia
status: open
question: "D5: Which bootstrap, probe and transport route enables automatic coordinator and keeper launch?"
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A
options:
  - label: A
    consequence: Approve P1 and P2 separately, each with exact provider and model (Claude Haiku 5.5, low effort), one short prompt, an arcadia spend check receipt and a stop condition (claude stop, or kill the pane within 10 minutes). Approve a reviewed remote first-registration and correction route bound to verified Session identity. Choose whether the automatic keeper uses the tmux relay or the built background launcher; if the latter, record the narrow amendment to 0190. Tests the unproven host assumption before any timer is wired, and avoids an unrestricted register-anyone verb. Includes no credential probe and no provider fallback. Grants no START.
    recommended: true
  - label: B
    consequence: Keep all launches behind the unclosed prerequisites. Safe, but automatic continuity stays unproved, and no paste workaround is recorded as success. Grants no START.
    recommended: false
confidence: high
plan: burn-down-three-verified-test-only-bug-issues-in-unattended-serial-production
updated: 2026-11-12
---

# Decision 0227: D5: Which bootstrap, probe and transport route enables automatic coordinator and keeper launch?

## Options

- **A** (recommended): Approve P1 and P2 separately, each with exact provider and model (Claude Haiku 5.5, low effort), one short prompt, an arcadia spend check receipt and a stop condition (claude stop, or kill the pane within 10 minutes). Approve a reviewed remote first-registration and correction route bound to verified Session identity. Choose whether the automatic keeper uses the tmux relay or the built background launcher; if the latter, record the narrow amendment to 0190. Tests the unproven host assumption before any timer is wired, and avoids an unrestricted register-anyone verb. Includes no credential probe and no provider fallback. Grants no START.
- **B**: Keep all launches behind the unclosed prerequisites. Safe, but automatic continuity stays unproved, and no paste workaround is recorded as success. Grants no START.

## Rationale

Decisions 0191 and 0190 are conditional. Probes P1 and P2 were never run and gates 6, 9, 10 and 11 remain open. The built background keeper launcher (src/commands/keeper.ts) is a different route from the specified tmux relay. Sources: agentask_93d0170cd186a88db7 and agentask_b99a3e8db0ae4c862f (Codex base). This decision grants no START and preserves Constitution gates: each probe is approved separately with exact provider, model, spend receipt and stop condition; no credential probe or provider fallback is included.

Proposed by Agent Ask decision-d5-launch-enablement-bootstrap-probes-20261112.
