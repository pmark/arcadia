---
arcadia: v1
type: plan
slug: burn-down-the-bug-backlog
project: arcadia
status: draft
milestone: Zero open bug-labeled Issues
token_impact: small
token_budget: "Deterministic tests and one bounded session per fix; status is read from plans and the sweep, never inferred by a model."
recommended_model: claude-sonnet-5
updated: 2026-10-05
actions:
  - id: fix-services-freeze-override-bypass
    title: Let ARCADIA_FREEZE_OVERRIDE bypass non-freeze structured CLI errors during recovery (#953)
    status: open
    responsibility: agent
    effort: quick
    next_action: In scripts/services.sh, let ARCADIA_FREEZE_OVERRIDE bypass a non-freeze structured CLI error so an operator recovery restart is not blocked by a corrupt config.
    expected_artifact: Evidence satisfying Agent Ask fix-services-freeze-override-bypass
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - With ARCADIA_FREEZE_OVERRIDE set, scripts/services.sh restart|stop proceeds past a non-freeze structured CLI error code (for example VALIDATION_ERROR) and reports that it bypassed it.
      - Without the override, the same non-freeze error still refuses with its named remedy.
      - A deterministic test covers both the override and non-override paths.
      - pnpm test passes.
    depends_on: []
    decisions: []
    references: ["scripts/services.sh", "https://github.com/pmark/arcadia/issues/953"]
  - id: decide-session-title-discovery
    title: Decide how a launched session discovers its own id so session titles can be set (#775)
    status: open
    responsibility: requires_review
    effort: short
    expected_artifact: A Decision answering how a session obtains its own id, or a bounded provider-tooling Action.
    clarification: question_open
    gap_type: missing-decision
    question: Should Arcadia resolve the launching session's id host-side and inject it, or is a provider-native self-lookup the supported route?
    confidence: medium
    acceptance_criteria:
      - A Decision answers whether the session id is injected by the launcher or discovered by the session, and #775 is recorded against it.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/775"]
  - id: decide-browser-audit-profile
    title: Decide the artifact route that satisfies #847's named-profile browser audit (Decision 0079)
    status: open
    responsibility: requires_review
    effort: short
    expected_artifact: A recorded answer to Decision 0079 and the #847 acceptance.
    clarification: question_open
    gap_type: missing-decision
    question: Does #847 close on an actual passing named-profile audit, or on the bounded host substitute Decision 0079 names?
    confidence: medium
    acceptance_criteria:
      - Decision 0079 is answered and #847's acceptance is recorded against it.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/847", "docs/decisions/0079-decide-whether-to-activate-exactly-one-bounded-docker-host-audit-of-the.md"]
  - id: close-bug-backlog-at-zero
    title: Drive every open bug-labeled Issue to a verified close and keep the sweep enforcing it.
    status: open
    responsibility: agent
    effort: short
    next_action: Merge the six governed fixes, answer the two decisions, then confirm the sweep leaves zero open bug-labeled Issues.
    expected_artifact: Zero open bug-labeled Issues, each closed with an Action reference and evidence.
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - Every bug-labeled Issue is closed, and each closure cites a done governed Action, a Decision, or an evidenced duplicate or superseded reason.
      - gh issue list --label bug --state open returns zero.
      - The periodic sweep logs each closure; no bug is closed for age, silence, or low confidence.
    depends_on:
      - fix-services-freeze-override-bypass
      - decide-session-title-discovery
      - decide-browser-audit-profile
      - plan/bootstrap-managed-production-to-build-flight-deck#treat-blocked-status-as-undispatchable
      - plan/bootstrap-managed-production-to-build-flight-deck#fix-tidy-torn-tail-byte-offset
      - plan/bootstrap-managed-production-to-build-flight-deck#narrow-db-write-transactions-across-fs-calls
      - plan/bootstrap-managed-production-to-build-flight-deck#keep-inactive-plan-acceptance-fingerprint-stable
      - plan/bootstrap-managed-production-to-build-flight-deck#silence-sandbox-certificate-copy-errors
      - plan/bootstrap-managed-production-to-build-flight-deck#preserve-global-agent-defaults-in-go-install
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/548", "https://github.com/pmark/arcadia/issues/749", "https://github.com/pmark/arcadia/issues/757", "https://github.com/pmark/arcadia/issues/775", "https://github.com/pmark/arcadia/issues/823", "https://github.com/pmark/arcadia/issues/847", "https://github.com/pmark/arcadia/issues/890", "https://github.com/pmark/arcadia/issues/927", "https://github.com/pmark/arcadia/issues/953"]
---

# Burn down the bug backlog

## Objective

Reach **zero open `bug`-labeled Issues** in `pmark/arcadia`, with every closure
evidenced — a `done` governed Action, a Decision, or a proven duplicate or
superseded reason. No bug is closed for age, silence, or low confidence.

## Why a separate plan

The six governed fixes below currently ride inside the active Plan
`bootstrap-managed-production-to-build-flight-deck`, whose 50+ Actions are
dominated by the unattended-production proof. Bugs there compete with the proof
and have no single burndown milestone. This plan gives the backlog one owner,
one milestone, and a measurable end state, and leaves the production plan to
production.

On activation, the six fixes should move here from the production plan through
the shared plan-amendment runner; this draft references them cross-plan instead
of duplicating their ids, so nothing is ambiguous while the plan is `draft`.

## Bug ledger

| Issue | Governor | Status |
| --- | --- | --- |
| #548 running dispatch must treat `status: blocked` as not dispatchable | `bootstrap...#treat-blocked-status-as-undispatchable` | open |
| #749 tidy journal byte-offset truncation | `bootstrap...#fix-tidy-torn-tail-byte-offset` | open |
| #757 write transactions hold the DB lock across filesystem calls | `bootstrap...#narrow-db-write-transactions-across-fs-calls` | open |
| #775 session title needs a discoverable session id | this plan: `decide-session-title-discovery` | question open |
| #823 inactive Plan acceptance expires on queue movement | `bootstrap...#keep-inactive-plan-acceptance-fingerprint-stable` | open |
| #847 unattended profile blocks local browser audits | this plan: `decide-browser-audit-profile` (Decision 0079) | question open |
| #890 sandbox certificate-copy noise on every invocation | `bootstrap...#silence-sandbox-certificate-copy-errors` | open |
| #927 Go installer changes global agent defaults | `bootstrap...#preserve-global-agent-defaults-in-go-install` | open |
| #953 services.sh freeze override cannot bypass non-freeze errors | this plan: `fix-services-freeze-override-bypass` | open |

## Enforcement

- `close-bug-backlog-at-zero` is the umbrella Action: it cannot satisfy until
  every referenced fix is `done`.
- The periodic `sweep_mirrors.py` closes a `bug` Issue once the governed Action
  that references it is `done` (Decision 0055), and closes mirrors of completed
  Actions (Decision 0081). It never dismisses an unresolved defect.
- `close-completed-board-mirrors` makes the mirror case native once it ships.

## Out of scope

New capability requests and non-bug hygiene Issues are not bugs; they stay with
their own plans or the curation trackers (#957, #958, #961-#965).
