---
arcadia: v1
type: decision
id: "0137"
slug: authorize-one-fixed-worker-claude-usage-diagnostic
project: arcadia
status: approved
question: Authorize one fixed worker Claude usage diagnostic?
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Authorize one worker Claude usage diagnostic dcd9f50f95ad816cf7b17d65feef658f1607d0ce7fc22b61307dd1f4d16b9b02
options:
  - label: Authorize one worker Claude usage diagnostic dcd9f50f95ad816cf7b17d65feef658f1607d0ce7fc22b61307dd1f4d16b9b02
    consequence: "Authorize exactly one in-process actual-worker Claude auto-source usage diagnostic under the fixed grant nonce f203d23f-34d4-432f-b916-6e3c253ecb7b and SHA256 dcd9f50f95ad816cf7b17d65feef658f1607d0ce7fc22b61307dd1f4d16b9b02. Read existing selected Claude credential only through the reviewed worker helper and initiate at most one reviewed usage-helper invocation and at most one fetch to the fixed initial endpoint https://api.anthropic.com/api/oauth/usage. The existing fetch follows HTTP redirects automatically and may therefore make additional HTTP requests, including to a different destination, within the same 30-second deadline. This approval covers that existing redirect behavior, with no caller-selected endpoint and no second helper invocation or retry; no refresh/exchange, inference, Codex call, shared telemetry write or paid fallback. Pin workspace martianrover, repository, release13e9f3fcf82a849e09fe8356b3ab281510905e1c, handlerHash e9ad3733b88e4997c896c66835b4e8ec292f65ce1ac7591cfe8095623a5143ba, Off policy79/epoch44/live0 and fresh owning worker50950/instancebddb5c6b-3e8b-4bdf-bfb0-eb8f82ab1478. Permit canonical recording of this selected A answer and normal non-force publication of ONLY its Decision creation/answer governance commits. After verifying that exact approved canonical answer, exclusively publish mode0600 exact grant bytes and nonce-only request; refuse any existing unknown grant/request/response/attempt. Grant expiry is2026-10-25T20:20UTC (1:20PM PDT), request deadline30seconds. If approved before20:15UTC, wait until20:15 before publishing; recheck all preconditions after waiting and leave at least60seconds before expiry. One durable attempt only; timeout/interruption/failure consumes it, retain evidence, no automatic retry/new nonce/extension. Capture sanitized usage-window receipt; do not expose token bytes/hashes. Production staysOff; this is NOT packet approval, launch authorization, START, runtime recovery, claim/attempt reset or consent to a second probe."
    recommended: true
  - label: Do not authorize the diagnostic
    consequence: Keep credentials untouched and productionOff; preserve the missing actual-worker capacity evidence. No diagnostic executes.
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-10-25
answer: Do not authorize the diagnostic
decided: 2026-10-25
---

# Decision 0137: Authorize one fixed worker Claude usage diagnostic?

## Options

- **Authorize one worker Claude usage diagnostic dcd9f50f95ad816cf7b17d65feef658f1607d0ce7fc22b61307dd1f4d16b9b02** (recommended): Authorize exactly one in-process actual-worker Claude auto-source usage diagnostic under the fixed grant nonce f203d23f-34d4-432f-b916-6e3c253ecb7b and SHA256 dcd9f50f95ad816cf7b17d65feef658f1607d0ce7fc22b61307dd1f4d16b9b02. Read existing selected Claude credential only through the reviewed worker helper and initiate at most one reviewed usage-helper invocation and at most one fetch to the fixed initial endpoint https://api.anthropic.com/api/oauth/usage. The existing fetch follows HTTP redirects automatically and may therefore make additional HTTP requests, including to a different destination, within the same 30-second deadline. This approval covers that existing redirect behavior, with no caller-selected endpoint and no second helper invocation or retry; no refresh/exchange, inference, Codex call, shared telemetry write or paid fallback. Pin workspace martianrover, repository, release13e9f3fcf82a849e09fe8356b3ab281510905e1c, handlerHash e9ad3733b88e4997c896c66835b4e8ec292f65ce1ac7591cfe8095623a5143ba, Off policy79/epoch44/live0 and fresh owning worker50950/instancebddb5c6b-3e8b-4bdf-bfb0-eb8f82ab1478. Permit canonical recording of this selected A answer and normal non-force publication of ONLY its Decision creation/answer governance commits. After verifying that exact approved canonical answer, exclusively publish mode0600 exact grant bytes and nonce-only request; refuse any existing unknown grant/request/response/attempt. Grant expiry is2026-10-25T20:20UTC (1:20PM PDT), request deadline30seconds. If approved before20:15UTC, wait until20:15 before publishing; recheck all preconditions after waiting and leave at least60seconds before expiry. One durable attempt only; timeout/interruption/failure consumes it, retain evidence, no automatic retry/new nonce/extension. Capture sanitized usage-window receipt; do not expose token bytes/hashes. Production staysOff; this is NOT packet approval, launch authorization, START, runtime recovery, claim/attempt reset or consent to a second probe.
- **Do not authorize the diagnostic**: Keep credentials untouched and productionOff; preserve the missing actual-worker capacity evidence. No diagnostic executes.

## Rationale

The operator approved guarded runtime adoption, which succeeded at19:46UTC. Actual worker50950 has reviewed compiled release13e9 and matching handler binding; production remainsOff79/epoch44/zero. Source and runtime approval do not authorize credential access. This is the separate bounded credential/capacity approval needed before START. Exact serialized grant and full Journey are linked in references. This request creates an OPEN Decision only; no diagnostic, token read, Session or START is approved by registration or settlement. Supersedes unapproved proposal authorize-fixed-worker-usage-20261025 only to disclose existing HTTP redirect behavior accurately; the grant bytes, nonce, digest, expiry and effects are otherwise unchanged. Do not use the old settlement card. Final wording clarifies that missing or expired credentials may prevent any fetch. Unapproved r2 is superseded too; only this r3 request is current.

Proposed by Agent Ask authorize-fixed-worker-usage-r3-20261025.
