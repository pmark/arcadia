---
arcadia: v1
type: decision
id: "0125"
slug: decide-whether-the-historical-2026-10-12-luna-scout-config-hash-change-may
project: arcadia
status: approved
question: Decide whether the historical 2026-10-12 Luna scout config-hash change may remain unattributed while a new narrowly bounded fixture-only experiment is prepared after offline guards and approval-handoff repairs pass; production stays Off.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Permit one fresh bounded fixture attempt after the guarded preflight and handoff repairs pass
options:
  - label: Permit one fresh bounded fixture attempt after the guarded preflight and handoff repairs pass
    consequence: Explicitly accept that the historical protected-config change remains unattributed, retain its unresolved evidence, and create a new scoped exception to the old experiment hold for one disposable no-remote fixture only, within the existing window ending 2026-10-18. Before launch, pin fixture paths, immutable source/runtime, Luna low effort, one90-second builder attempt with no fallback/retry/paid credits, independently verifiable secret-free config-content witnesses, and current approved exact-scope handoff. Production remains Off; no live Project/pointer/queue writes, no automatic scheduler/service restart, no GitHub/Discord from the fixture, no config deletion/rollback. Every non-permitted or unattributed new protected-state change immediately stops the attempt. This choice does not claim trust-only attribution of the old run and does not authorize remote repository creation, merge, deployment or the broader Studio pilot. Actual launch still waits on those named repairs and pinned assignment.
    recommended: true
  - label: Keep the experiment hold and continue only offline repairs
    consequence: No new fixture workspace or provider attempt. Preserve the evidence and improve the deterministic replay, handoff and visibility through isolated source PRs. Revive the live scout when actual historical pre-content is recovered or a later operator Decision explicitly accepts a new scope.
    recommended: false
confidence: high
plan: every-operator-decision-in-a-production-run-is-a-pinned-decision-card-on-a
updated: 2026-10-13
answer: Permit one fresh bounded fixture attempt after the guarded preflight and handoff repairs pass
decided: 2026-10-13
---

# Decision 0125: Decide whether the historical 2026-10-12 Luna scout config-hash change may remain unattributed while a new narrowly bounded fixture-only experiment is prepared after offline guards and approval-handoff repairs pass; production stays Off.

## Options

- **Permit one fresh bounded fixture attempt after the guarded preflight and handoff repairs pass** (recommended): Explicitly accept that the historical protected-config change remains unattributed, retain its unresolved evidence, and create a new scoped exception to the old experiment hold for one disposable no-remote fixture only, within the existing window ending 2026-10-18. Before launch, pin fixture paths, immutable source/runtime, Luna low effort, one90-second builder attempt with no fallback/retry/paid credits, independently verifiable secret-free config-content witnesses, and current approved exact-scope handoff. Production remains Off; no live Project/pointer/queue writes, no automatic scheduler/service restart, no GitHub/Discord from the fixture, no config deletion/rollback. Every non-permitted or unattributed new protected-state change immediately stops the attempt. This choice does not claim trust-only attribution of the old run and does not authorize remote repository creation, merge, deployment or the broader Studio pilot. Actual launch still waits on those named repairs and pinned assignment.
- **Keep the experiment hold and continue only offline repairs**: No new fixture workspace or provider attempt. Preserve the evidence and improve the deterministic replay, handoff and visibility through isolated source PRs. Revive the live scout when actual historical pre-content is recovered or a later operator Decision explicitly accepts a new scope.

## Rationale

The operator authorized offline preflight/replay on 2026-10-13, not a waiver of Decisions0082/0099. Researcher verified all48 retained evidence hashes. Only codexConfig changed in the old leak check; a fixture trust section was found, but reconstructing the baseline hash failed and pre-content was not retained. Exact trust-only attribution cannot be proven from these receipts. The old hold must remain unless new attribution evidence or an explicit operator Decision resolves the execution boundary. Raw evidence is retained privately in configured-workspace artifacts; no fresh baseline resolves the historical delta. This proposal grants no new experiment, provider call, production activation, host config edit or rollback.

Proposed by Agent Ask decide-scout-historical-isolation-hold-20261013.
