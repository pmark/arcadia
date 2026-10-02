---
arcadia: v1
type: decision
id: "0079"
slug: decide-whether-to-activate-exactly-one-bounded-docker-host-audit-of-the
project: arcadia
status: open
question: "Decide whether to activate exactly one bounded Docker host audit of the preserved PPN baseline static export, and accept the host-route substitute for Issue #847s named-profile-only check. No activation or PPN measurement has occurred."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Authorize one bounded container audit 6ba40cb873552467cdc317d85c2786524b42f0f2f296e568c57b9e9e37cf56e0
options:
  - label: Authorize one bounded container audit 6ba40cb873552467cdc317d85c2786524b42f0f2f296e568c57b9e9e37cf56e0
    consequence: "Permit one host-owned request for exactly the proposed Grant after reviewed code installation. Record #847 acceptance as either an actual passing named-profile check or this separately approved bounded host substitute with the unchanged profile negative evidence retained. One baseline matrix may run; expiry or drift refuses. This is not production activation, deployment, publication, or PPN Action completion."
    recommended: true
  - label: Keep the Docker route inactive
    consequence: No host Grant is installed or consumed; dispatch and PPN release verification remain blocked pending a refreshed scoped choice or supported named-profile capability.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-02
---

# Decision 0079: Decide whether to activate exactly one bounded Docker host audit of the preserved PPN baseline static export, and accept the host-route substitute for Issue #847s named-profile-only check. No activation or PPN measurement has occurred.

## Options

- **Authorize one bounded container audit 6ba40cb873552467cdc317d85c2786524b42f0f2f296e568c57b9e9e37cf56e0** (recommended): Permit one host-owned request for exactly the proposed Grant after reviewed code installation. Record #847 acceptance as either an actual passing named-profile check or this separately approved bounded host substitute with the unchanged profile negative evidence retained. One baseline matrix may run; expiry or drift refuses. This is not production activation, deployment, publication, or PPN Action completion.
- **Keep the Docker route inactive**: No host Grant is installed or consumed; dispatch and PPN release verification remain blocked pending a refreshed scoped choice or supported named-profile capability.

## Rationale

Packaged real synthetic proof passes static HTTP and two Lighthouse 13.4.0 reports, network and credential denials, native detached-child containment, timeout removal, unchanged source, nonce-only host broker, and drift refusals for all eight authority fields. Image Chromium 149 differs from historical Chrome 154; the authorized report must label that non-comparability and cannot complete PPN release verification. The Grant pins the baseline revision 579878edd09f8274a2f5b9a9e8ac53e4dbc54769, exact snapshot hash 17502e95d3e51f64218a880fd18c80557ef3e60ddb62d761028ac0a5d05c4b6a, immutable image sha256:fa465721bd83298dc18b63628d67fccea73b34903cf3cc4b2cb86f4ee4cf60ca, compiled executor 247ecb48eb5a723e0a22dd879b47cbc8cd96959b9b8e58781f896ae7985c5691, four declared routes, 390x844 and 1440x900 DPR1, simulated 40ms/10240Kbps/4xCPU and expiry 2026-10-02T18:45Z. It consumes once before execution, keeps network.none and no socket exposure, and never changes production, credentials, PPN source, or governed release status. Supersedes un-applied v1/v2 previews; reviewed MIME, failure-isolation and launcher corrections changed the immutable image/executor pins. The fixed child is packaged in the protected broker runtime and the running consumer publishes its loaded handler hash. Preparation only copied and hashed retained export bytes; PPN was not served or measured.

Proposed by Agent Ask activate-scoped-container-audit-847-2026-10-02-v3.
