---
arcadia: v1
type: decision
id: "0105"
slug: decide-the-first-real-distribution-boundary-for-arcadia-assets-after-the-local
project: arcadia
status: open
question: Decide the first real distribution boundary for Arcadia Assets after the local Asset Service and deterministic mirror contract are proved.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Local-only until a concrete consumer exists
options:
  - label: Local-only until a concrete consumer exists
    consequence: Assets remain durable and playable through Arcadia’s loopback-only local service; no cloud credential, external storage, public URL, blog, or podcast feed is added. Revisit when a real remote listener, app, or site is selected.
    recommended: true
  - label: Private cloud mirror
    consequence: Authorize a selected private object-storage mirror after credentials and provider are explicitly chosen; assets gain a verified off-host copy but remain non-public, and a site/feed stays separate work.
    recommended: false
  - label: Public site and podcast delivery
    consequence: Authorize selecting a hosting and publication path for public episode pages and/or an RSS feed; this expands scope to public release, operational hosting, and release controls.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
---

# Decision 0105: Decide the first real distribution boundary for Arcadia Assets after the local Asset Service and deterministic mirror contract are proved.

## Options

- **Local-only until a concrete consumer exists** (recommended): Assets remain durable and playable through Arcadia’s loopback-only local service; no cloud credential, external storage, public URL, blog, or podcast feed is added. Revisit when a real remote listener, app, or site is selected.
- **Private cloud mirror**: Authorize a selected private object-storage mirror after credentials and provider are explicitly chosen; assets gain a verified off-host copy but remain non-public, and a site/feed stays separate work.
- **Public site and podcast delivery**: Authorize selecting a hosting and publication path for public episode pages and/or an RSS feed; this expands scope to public release, operational hosting, and release controls.

## Rationale

Selecting a real cloud-storage target, introducing credentials, or making an Asset publicly reachable changes the system boundary and may be difficult to reverse. The Artifact System Plan deliberately proves loopback-only local serving and fake mirroring first; this Decision determines what, if anything, comes next.

Proposed by Agent Ask decide-first-asset-distribution-boundary-2026-10-06-r2.
