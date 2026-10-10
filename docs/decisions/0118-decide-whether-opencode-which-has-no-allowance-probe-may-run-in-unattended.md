---
arcadia: v1
type: decision
id: "0118"
slug: decide-whether-opencode-which-has-no-allowance-probe-may-run-in-unattended
project: arcadia
status: open
question: Decide whether OpenCode, which has no allowance probe, may run in unattended production under an operator-set daily token ceiling.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Admit OpenCode under an operator-set daily token ceiling
options:
  - label: Admit OpenCode under an operator-set daily token ceiling
    consequence: OpenCode can run unattended Sessions until its counted tokens for the day reach the ceiling the operator sets; then it is skipped with allowance(opencode daily ceiling). Needs per-Session token counting for OpenCode first, and spend stays bounded only by that ceiling.
    recommended: true
  - label: Exclude OpenCode from unattended production until it has an allowance probe
    consequence: No unmetered spend. One fewer provider for 24/7 work.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-10
---

# Decision 0118: Decide whether OpenCode, which has no allowance probe, may run in unattended production under an operator-set daily token ceiling.

## Options

- **Admit OpenCode under an operator-set daily token ceiling** (recommended): OpenCode can run unattended Sessions until its counted tokens for the day reach the ceiling the operator sets; then it is skipped with allowance(opencode daily ceiling). Needs per-Session token counting for OpenCode first, and spend stays bounded only by that ceiling.
- **Exclude OpenCode from unattended production until it has an allowance probe**: No unmetered spend. One fewer provider for 24/7 work.

## Rationale

In the 2026-10-09 /production design session the operator chose this option in chat; this Decision records it for the operator's own answer. This is spend: OpenCode runs on API-key billing with no rolling window, so Arcadia cannot read remaining allowance. Admitting it requires per-Session token counting from OpenCode's own usage output and an operator-set ceiling; no ceiling is ever set by an agent (Decisions 0110/0111 govern who may change reserves).

Proposed by Agent Ask decide-opencode-unattended-daily-token-ceiling-2026-10-09.
