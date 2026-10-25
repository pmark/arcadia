---
arcadia: v1
type: decision
id: "0140"
slug: authorize-one-post-renewal-worker-claude-usage-diagnostic
project: arcadia
status: open
question: Authorize one post-renewal worker Claude usage diagnostic?
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Authorize one worker Claude usage diagnostic 832743c04bdad25d88b4c5bcd1b41e947eb6a24325ce8c7ae88cea98d00026ec
options:
  - label: Authorize one worker Claude usage diagnostic 832743c04bdad25d88b4c5bcd1b41e947eb6a24325ce8c7ae88cea98d00026ec
    consequence: "Authorize exactly one in-process actual-worker Claude auto-source usage diagnostic under the fixed grant nonce d17ffdf8-cbf3-4a1c-97b2-07530c0d40cf and SHA256 832743c04bdad25d88b4c5bcd1b41e947eb6a24325ce8c7ae88cea98d00026ec. Read existing selected Claude credential only through the reviewed worker helper and initiate at most one reviewed usage-helper invocation and at most one fetch to the fixed initial endpoint https://api.anthropic.com/api/oauth/usage. The existing fetch follows HTTP redirects automatically and may therefore make additional HTTP requests, including to a different destination, within the same 30-second deadline. This approval covers that existing redirect behavior, with no caller-selected endpoint and no second helper invocation or retry; no refresh/exchange, inference, Codex call, shared telemetry write or paid fallback. Pin workspace martianrover, repository, release13e9f3fcf82a849e09fe8356b3ab281510905e1c, handlerHash e9ad3733b88e4997c896c66835b4e8ec292f65ce1ac7591cfe8095623a5143ba, Off policy79/epoch44/live0 and fresh owning worker50950/instancebddb5c6b-3e8b-4bdf-bfb0-eb8f82ab1478. Permit canonical recording of this selected A answer and normal non-force publication of ONLY its Decision creation/answer governance commits. After verifying that exact approved canonical answer, exclusively publish mode0600 exact grant bytes and nonce-only request; refuse any existing unknown grant/request/response/attempt. Grant expiry is 2026-10-25T21:13:04.000Z, five minutes from preparation; require at least60seconds remaining before exclusive request publication. Request deadline30seconds. One durable attempt only; timeout/interruption/failure consumes it, retain evidence, no automatic retry/new nonce/extension. Capture sanitized usage-window receipt; do not expose token bytes/hashes. Production staysOff; this is NOT packet approval, launch authorization, START, runtime recovery, claim/attempt reset or consent to a second probe."
    recommended: true
  - label: Do not authorize the diagnostic
    consequence: Keep credentials untouched and productionOff; preserve the missing actual-worker capacity evidence. No diagnostic executes.
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-10-25
---

# Decision 0140: Authorize one post-renewal worker Claude usage diagnostic?

## Options

- **Authorize one worker Claude usage diagnostic 832743c04bdad25d88b4c5bcd1b41e947eb6a24325ce8c7ae88cea98d00026ec** (recommended): Authorize exactly one in-process actual-worker Claude auto-source usage diagnostic under the fixed grant nonce d17ffdf8-cbf3-4a1c-97b2-07530c0d40cf and SHA256 832743c04bdad25d88b4c5bcd1b41e947eb6a24325ce8c7ae88cea98d00026ec. Read existing selected Claude credential only through the reviewed worker helper and initiate at most one reviewed usage-helper invocation and at most one fetch to the fixed initial endpoint https://api.anthropic.com/api/oauth/usage. The existing fetch follows HTTP redirects automatically and may therefore make additional HTTP requests, including to a different destination, within the same 30-second deadline. This approval covers that existing redirect behavior, with no caller-selected endpoint and no second helper invocation or retry; no refresh/exchange, inference, Codex call, shared telemetry write or paid fallback. Pin workspace martianrover, repository, release13e9f3fcf82a849e09fe8356b3ab281510905e1c, handlerHash e9ad3733b88e4997c896c66835b4e8ec292f65ce1ac7591cfe8095623a5143ba, Off policy79/epoch44/live0 and fresh owning worker50950/instancebddb5c6b-3e8b-4bdf-bfb0-eb8f82ab1478. Permit canonical recording of this selected A answer and normal non-force publication of ONLY its Decision creation/answer governance commits. After verifying that exact approved canonical answer, exclusively publish mode0600 exact grant bytes and nonce-only request; refuse any existing unknown grant/request/response/attempt. Grant expiry is 2026-10-25T21:13:04.000Z, five minutes from preparation; require at least60seconds remaining before exclusive request publication. Request deadline30seconds. One durable attempt only; timeout/interruption/failure consumes it, retain evidence, no automatic retry/new nonce/extension. Capture sanitized usage-window receipt; do not expose token bytes/hashes. Production staysOff; this is NOT packet approval, launch authorization, START, runtime recovery, claim/attempt reset or consent to a second probe.
- **Do not authorize the diagnostic**: Keep credentials untouched and productionOff; preserve the missing actual-worker capacity evidence. No diagnostic executes.

## Rationale

Canonical Decision0139 records the explicit human approval for one Off-state renewal and one subsequent actualworker verification with its mechanical canonicalrecords. The renewal must have succeeded and archived knownterminal0138metadata first. This records only that alreadyapproved ONE verification; no additional call, retry or START is authorized.

Proposed by Agent Ask record-approved-postrenewal-worker-usage-20261025.
