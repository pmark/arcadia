---
arcadia: v1
type: decision
id: "0078"
slug: choose-a-bounded-host-owned-loopback-headless-audit-route-for-issue-847-before
project: arcadia
status: open
question: "Choose a bounded host-owned loopback/headless audit route for Issue #847 before any network or credential permission change. The installed arcadia-unattended profile has been measured: loopback EPERM, Chrome SIGABRT, external socket and synthetic credential reads denied. The PPN measurement remains unperformed."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Prepare a host-owned audit route
options:
  - label: Prepare a host-owned audit route
    consequence: "Implement an inactive, source-bound static-site audit executor with a dedicated Seatbelt boundary: one disposable loopback origin, isolated headless browser profile, denied external/private destinations and credentials, bounded execution and durable receipts. Prove its positive and negative cases on fixtures before seeking a separate scoped activation grant; no PPN files or pointers change."
    recommended: true
  - label: Wait for native named-profile capability
    consequence: Leave permissions unchanged and browser-measurement dispatch blocked until a supported executor proves loopback serving, headless rendering, external denial and credential denial under the actual named profile. PPN release verification remains open.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-01
---

# Decision 0078: Choose a bounded host-owned loopback/headless audit route for Issue #847 before any network or credential permission change. The installed arcadia-unattended profile has been measured: loopback EPERM, Chrome SIGABRT, external socket and synthetic credential reads denied. The PPN measurement remains unperformed.

## Options

- **Prepare a host-owned audit route** (recommended): Implement an inactive, source-bound static-site audit executor with a dedicated Seatbelt boundary: one disposable loopback origin, isolated headless browser profile, denied external/private destinations and credentials, bounded execution and durable receipts. Prove its positive and negative cases on fixtures before seeking a separate scoped activation grant; no PPN files or pointers change.
- **Wait for native named-profile capability**: Leave permissions unchanged and browser-measurement dispatch blocked until a supported executor proves loopback serving, headless rendering, external denial and credential denial under the actual named profile. PPN release verification remains open.

## Rationale

The operator must choose the local-service security boundary. Broad networking, private-network access, arbitrary Unix sockets, credential expansion, deployment, publication and production remain excluded. Accepting this proposal creates a Decision; it does not install or activate a route.

Proposed by Agent Ask propose-bounded-host-browser-audit-847-2026-10-01.
