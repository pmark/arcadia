---
arcadia: v1
type: decision
id: "0288"
slug: standing-production-rules-no-operator-press-is-the-first-live-test-of-a-path
project: arcadia
status: approved
question: "Standing production rules: no operator press is the first live test of a path, and a proven run shape repeats three times before production widens."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "A. Both rules: unstubbed dress rehearsal before any press request, and three clean runs of one shape before widening"
options:
  - label: "A. Both rules: unstubbed dress rehearsal before any press request, and three clean runs of one shape before widening"
    consequence: "Rule 1: no agent asks the operator to press a card, or to widen to a new path, until a full dress rehearsal in a disposable clone ran every stage unstubbed except the final provider launch (derive or mint, replay with the press path's exact invocation, preflight, the press's run-mode checks, each pinned Action's declared test commands under the worker's real environment) and its receipt is linked in the pre-mortem; Signal refuses to relay a press request without it. Rule 2: 'one shape' = same press path, same kind of work (e.g. test-only or small src Actions), concurrency 1. Three clean runs of a shape (scope complete, zero escalations, no operator touch beyond the press) come before production adds a new path, kind of work, concurrency or Plan type; exceptions only by your word in chat. Consequence: fewer surprise refusals and waits; new capabilities (Relay, Workspace UI lanes in production, Plan-to-Plan advance, Track 2's different work) arrive more slowly; builders may still build them unmerged or merged under existing rules."
    recommended: true
  - label: B. Rule 1 only (dress rehearsal before every press request)
    consequence: "Your press stops being the test, but production may still widen as soon as a single run succeeds. Consequence: fewer wasted presses; stumbles from new firsts continue at today's pace."
    recommended: false
  - label: C. No standing rules; judge case by case
    consequence: "Today's practice. Consequence: the pattern Mira measured (3-5 defects per first, found by your press) continues."
    recommended: false
confidence: high
plan: draft-an-inactive-plan-of-four-worker-mergeable-actions-for-the-engine-s-first
updated: 2026-11-24
answer: "A. Both rules: unstubbed dress rehearsal before any press request, and three clean runs of one shape before widening"
decided: 2026-11-24
---

# Decision 0288: Standing production rules: no operator press is the first live test of a path, and a proven run shape repeats three times before production widens.

## Options

- **A. Both rules: unstubbed dress rehearsal before any press request, and three clean runs of one shape before widening** (recommended): Rule 1: no agent asks the operator to press a card, or to widen to a new path, until a full dress rehearsal in a disposable clone ran every stage unstubbed except the final provider launch (derive or mint, replay with the press path's exact invocation, preflight, the press's run-mode checks, each pinned Action's declared test commands under the worker's real environment) and its receipt is linked in the pre-mortem; Signal refuses to relay a press request without it. Rule 2: 'one shape' = same press path, same kind of work (e.g. test-only or small src Actions), concurrency 1. Three clean runs of a shape (scope complete, zero escalations, no operator touch beyond the press) come before production adds a new path, kind of work, concurrency or Plan type; exceptions only by your word in chat. Consequence: fewer surprise refusals and waits; new capabilities (Relay, Workspace UI lanes in production, Plan-to-Plan advance, Track 2's different work) arrive more slowly; builders may still build them unmerged or merged under existing rules.
- **B. Rule 1 only (dress rehearsal before every press request)**: Your press stops being the test, but production may still widen as soon as a single run succeeds. Consequence: fewer wasted presses; stumbles from new firsts continue at today's pace.
- **C. No standing rules; judge case by case**: Today's practice. Consequence: the pattern Mira measured (3-5 defects per first, found by your press) continues.

## Rationale

Operator, 2026-11-24 PST, in Signal 19's session (local_4ffd80da-08ca-4027-b1bc-8592a0208401), verbatim: 'Draft the standing rules on the retry decision for my approval.' Context: Mira (release investigator, Fable, read-only) forecast after four refused standing-grant presses (Nov 22-23) and a per-card run that stalled on an environment-dependent test (Nov 24): each first live use of a new path surfaced 3-5 defects, the rate is not falling, and 'your press stops being the test' plus 'repeat before widening' were the two changes most likely to shorten the path (clean supervised run 1-4 days; first zero-touch night 1-3 weeks; reliable week 6-12 weeks; inferred). Evidence: workspaces/serial-wait-log-20261122.md; Issues #2989, #2999, #3001, #3005, #3013, #3015-#3017. This record grants no new authority; it narrows when agents may ask for a press or widen scope. Nothing here is in force before the operator answers and merges its record PR.

Proposed by Agent Ask signal19-rehearse-and-repeat-before-widening-20261124.
