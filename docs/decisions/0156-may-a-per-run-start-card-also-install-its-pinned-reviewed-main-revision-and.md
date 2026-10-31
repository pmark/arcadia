---
arcadia: v1
type: decision
id: "0156"
slug: may-a-per-run-start-card-also-install-its-pinned-reviewed-main-revision-and
project: arcadia
status: open
question: May a per-run START card also install its pinned, reviewed main revision and restart the worker before starting production?
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "Yes: START installs its pinned reviewed main (recommended)"
options:
  - label: "Yes: START installs its pinned reviewed main (recommended)"
    consequence: "Widens one press to include a broker install and a worker restart. Each run gets its own one-shot card that pins the reviewed main sha and its own script and descriptor hashes, refuses if origin main has moved past that sha, and installs only that sha. It retains every gate the current START card checks: required Decisions approved, host-only execution with no API key, production Off at the pinned policy revision and epoch, zero live admissions and no live Sessions, the pinned queue revision and ordered Actions, capacity gate and fresh capacity read, required files on main, scope previewed twice and verified after activation, expiry, and the consumed one-shot allowance. The only gate replaced is the installed-revision pin, which becomes a reviewed-revision pin, checked by production runtime-check after install. The card fast-forwards the clean main checkout to the pinned sha only, never beyond it, then runs go-broker ensure: it skips only when the installed, ready broker is exactly the pinned sha, otherwise reinstalls (including after docs-only moves), and refuses during a rehearsal freeze. The worker is restarted only after ensure succeeds; its new process and heartbeat are observed and bound. A failed install or restart can leave the worker on its old release or not running, with production Off. If a later step fails, production stays Off but the runtime stays upgraded: there is no automatic rollback to the previous release. The one-shot allowance is consumed at the first mutation, including the install, and failures are never reset. No credential use, renewal, paid fallback or gate override."
    recommended: true
  - label: "No: adoption stays its own card"
    consequence: "No widening. The START card refuses a stale runtime using the PR #1934 check, and a separate pinned adoption card, reviewed and pressed on its own, is needed whenever main has moved since the last install. One extra press per run in that case."
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-31
---

# Decision 0156: May a per-run START card also install its pinned, reviewed main revision and restart the worker before starting production?

## Options

- **Yes: START installs its pinned reviewed main (recommended)** (recommended): Widens one press to include a broker install and a worker restart. Each run gets its own one-shot card that pins the reviewed main sha and its own script and descriptor hashes, refuses if origin main has moved past that sha, and installs only that sha. It retains every gate the current START card checks: required Decisions approved, host-only execution with no API key, production Off at the pinned policy revision and epoch, zero live admissions and no live Sessions, the pinned queue revision and ordered Actions, capacity gate and fresh capacity read, required files on main, scope previewed twice and verified after activation, expiry, and the consumed one-shot allowance. The only gate replaced is the installed-revision pin, which becomes a reviewed-revision pin, checked by production runtime-check after install. The card fast-forwards the clean main checkout to the pinned sha only, never beyond it, then runs go-broker ensure: it skips only when the installed, ready broker is exactly the pinned sha, otherwise reinstalls (including after docs-only moves), and refuses during a rehearsal freeze. The worker is restarted only after ensure succeeds; its new process and heartbeat are observed and bound. A failed install or restart can leave the worker on its old release or not running, with production Off. If a later step fails, production stays Off but the runtime stays upgraded: there is no automatic rollback to the previous release. The one-shot allowance is consumed at the first mutation, including the install, and failures are never reset. No credential use, renewal, paid fallback or gate override.
- **No: adoption stays its own card**: No widening. The START card refuses a stale runtime using the PR #1934 check, and a separate pinned adoption card, reviewed and pressed on its own, is needed whenever main has moved since the last install. One extra press per run in that case.

## Rationale

Today a run needs a separate runtime-adoption card whenever main has moved since the last install, and then a START card (Issue #1929 F1). PR #1934 added a live check that the installed runtime matches main; on 2026-10-31 it reports STALE (installed 24c4ee0, main 1ac59bd). Combining the two changes what one press authorizes (broker install and worker restart), so the operator decides. A companion Decision asks separately about Plan activation. Answering this gates implementation only; no install, restart or START follows from the answer itself.

Proposed by Agent Ask decision-start-installs-pinned-runtime-20261031.
