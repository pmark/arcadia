---
arcadia: v1
type: decision
id: "0047"
slug: record-whether-fixed-codex-and-claude-go-launchers-may-submit-bounded-requests-f
project: arcadia
status: approved
question: Record whether fixed Codex and Claude go launchers may submit bounded requests for the existing host worker to perform canonical go preview and identical apply, under the operator's existing continuation authority. Git mutation remains host-only; launchers carry only a nonce and fixed provider, and cannot supply commands, repository paths, validation assertions, or authority flags.
gap_type: missing-decision
recommendation: Ratify bounded host requests
options:
  - label: Ratify bounded host requests
    consequence: Agents can request the same canonical go transition from a registered source. The host remains responsible for Git mutation and existing authority checks; no other production or acceptance gate changes.
    recommended: true
  - label: Keep go operator-only
    consequence: Provider go request launchers remain unavailable to coding agents; continuation requires the operator to invoke go from the host.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-12
answer: Ratify bounded host requests
decided: 2026-09-12
---

# Decision 0047: Record whether fixed Codex and Claude go launchers may submit bounded requests for the existing host worker to perform canonical go preview and identical apply, under the operator's existing continuation authority. Git mutation remains host-only; launchers carry only a nonce and fixed provider, and cannot supply commands, repository paths, validation assertions, or authority flags.

## Options

- **Ratify bounded host requests** (recommended): Agents can request the same canonical go transition from a registered source. The host remains responsible for Git mutation and existing authority checks; no other production or acceptance gate changes.
- **Keep go operator-only**: Provider go request launchers remain unavailable to coding agents; continuation requires the operator to invoke go from the host.

## Rationale

The operator explicitly requested restoration of the arcadia go agent entry point. PR 226 review identified that exposing a host-controller executable directly to Claude widened capability. The revised code makes both provider launchers request-only and retains canonical guards. This Ask records the authority distinction without claiming that review, acceptance, merge, deployment, or autonomous continuous-production authority has been granted.

Proposed by Agent Ask ratify-agent-go-host-requests-pr226-2026-09-12. This Decision remains open until the operator answers it.
