---
arcadia: v1
type: decision
id: "0169"
slug: choose-how-the-next-unattended-production-run-recovers-and-gets-noticed
project: arcadia
status: approved
question: Choose how the next unattended production run recovers and gets noticed, including whether a host-written QA plan step may stop blocking a merge when it is the only failure.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. Recovery fixes plus alerts, no model
options:
  - label: A. Recovery fixes plus alerts, no model
    consequence: "Before the next START: a Session's proposal stays out of its candidate; a finding only about the host-written QA plan uses no repair rounds, stops blocking when it is the sole failure, and files an Issue, so an Action can merge with one operator check step unverified; the worker reconciles its own pointer commits; alerts for exhausted review repairs, gated candidates and no progress. During a run the Lead never writes to a candidate or review input. About five small Actions of delay."
    recommended: true
  - label: B. Alerts only
    consequence: Quicker, but adds no recovery, so recoverable faults still stop the worker.
    recommended: false
  - label: C. A plus model diagnosis
    consequence: Adds a diagnosis that has never run and muddies what the next run proves.
    recommended: false
  - label: D. A corrector with fix rights
    consequence: Might shorten holds, but would sometimes fix the wrong thing and widens authority.
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-11-02
answer: A. Recovery fixes plus alerts, no model
decided: 2026-11-02
---

# Decision 0169: Choose how the next unattended production run recovers and gets noticed, including whether a host-written QA plan step may stop blocking a merge when it is the only failure.

## Options

- **A. Recovery fixes plus alerts, no model** (recommended): Before the next START: a Session's proposal stays out of its candidate; a finding only about the host-written QA plan uses no repair rounds, stops blocking when it is the sole failure, and files an Issue, so an Action can merge with one operator check step unverified; the worker reconciles its own pointer commits; alerts for exhausted review repairs, gated candidates and no progress. During a run the Lead never writes to a candidate or review input. About five small Actions of delay.
- **B. Alerts only**: Quicker, but adds no recovery, so recoverable faults still stop the worker.
- **C. A plus model diagnosis**: Adds a diagnosis that has never run and muddies what the next run proves.
- **D. A corrector with fix rights**: Might shorten holds, but would sometimes fix the wrong thing and widens authority.

## Rationale

Runs h and i on 2026-11-02 stopped on repeated faults with no notice, and hand corrections made one candidate harder to recover. The proposal, with an independent second opinion, is at https://claude.ai/artifact/RiRHHQXrejT1SchTwvPf8k. Issues #1988, #1993, #1999.

Proposed by Agent Ask decide-worker-recovery-watchdog-20261102.
