---
arcadia: v1
type: decision
id: "0213"
slug: record-the-operator-s-standing-spend-policy-no-paid-spend-is-authorized-for-any
project: arcadia
status: approved
question: "Record the operator's standing spend policy: no paid spend is authorized for any agent, script, service or launcher, indefinitely. Spend means money billed beyond a fixed subscription: API keys, Claude extra usage or usage credits, purchased Codex credits, pay-as-you-go gateways such as OpenCode Zen or Hugging Face, and paid cloud model routes. Drawing on subscription allocations (Claude, Codex, OpenCode Go) is usage, not spend."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. Standing no-spend policy, superseding 0126
options:
  - label: A. Standing no-spend policy, superseding 0126
    consequence: No paid usage of any kind is authorized, with no expiry. Decision 0126's paid PR TLDR route is withdrawn; PR TLDRs use local or subscription routes or are unavailable. Launchers, admission and Intelligence refuse paid routes, as reviewed PRs implement. Any future spend needs a new Decision naming amount, route and expiry. Some cloud-only conveniences stop working.
    recommended: true
  - label: B. Standing no-spend policy, keeping 0126 as the sole exception
    consequence: Same as A, except the explicitly requested PR TLDR may still use the paid Fast Text Cloud route under 0126's bounds. One standing paid route remains, so enforcement must carve it out and audits must account for it.
    recommended: false
  - label: C. Record nothing new
    consequence: Relies on the Constitution's existing hard stop on spending. Decision 0126 stays in force, and code and guidance have no single standing record of 'none, indefinitely' to cite. Enforcement changes would each need their own justification.
    recommended: false
confidence: high
plan: record-run-unattended-test-pins-20261107-part-2
updated: 2026-11-09
answer: A. Standing no-spend policy, superseding 0126
decided: 2026-11-09
---

# Decision 0213: Record the operator's standing spend policy: no paid spend is authorized for any agent, script, service or launcher, indefinitely. Spend means money billed beyond a fixed subscription: API keys, Claude extra usage or usage credits, purchased Codex credits, pay-as-you-go gateways such as OpenCode Zen or Hugging Face, and paid cloud model routes. Drawing on subscription allocations (Claude, Codex, OpenCode Go) is usage, not spend.

## Options

- **A. Standing no-spend policy, superseding 0126** (recommended): No paid usage of any kind is authorized, with no expiry. Decision 0126's paid PR TLDR route is withdrawn; PR TLDRs use local or subscription routes or are unavailable. Launchers, admission and Intelligence refuse paid routes, as reviewed PRs implement. Any future spend needs a new Decision naming amount, route and expiry. Some cloud-only conveniences stop working.
- **B. Standing no-spend policy, keeping 0126 as the sole exception**: Same as A, except the explicitly requested PR TLDR may still use the paid Fast Text Cloud route under 0126's bounds. One standing paid route remains, so enforcement must carve it out and audits must account for it.
- **C. Record nothing new**: Relies on the Constitution's existing hard stop on spending. Decision 0126 stays in force, and code and guidance have no single standing record of 'none, indefinitely' to cite. Enforcement changes would each need their own justification.

## Rationale

Operator, 2026-11-09, verbatim: 'let's improve reliability in order to ensure no unauthorized spending happens (and none is or will be authorized indefinitely), and false alarms are rare or eliminated.' Decision 0126 (2026-10-13) still authorizes a paid Fast Text Cloud route for PR TLDRs, and no checked-in record states the indefinite no-spend policy that enforcement code and guidance can cite. Evidence: docs/reports/spend-safety-investigation-2026-11-09.md (Mira). Preview only; Mira does not settle this.

Proposed by Agent Ask record-standing-no-spend-policy-2026-11-09.
