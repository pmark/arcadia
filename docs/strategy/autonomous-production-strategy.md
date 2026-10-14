# Autonomous production strategy: operator decisions as cards, Plan-to-Plan handoff as a deterministic loop

Status: draft strategy, 2026-10-12. Operator idea validated and sharpened by an
independent Opus review of the simulated production runs
(`docs/reports/production-simulation-living-notes.md`, tracking Issue #1284).
This document grants no authority; every authority change it implies is a
Decision the operator answers.

## The idea, and the better unit

Operator idea: a coding agent automates a whole Plan, hands off the next Plan,
captures issues and learnings along the way, and Arcadia gradually does the
whole process through mostly deterministic means. The direction is right. The
unit is not. A Lead model is the most expensive and least repeatable part of
the loop, and last night's evidence says most Lead turns were mechanical:
settle previews, queue arranges, merge gating, draft checks, pointer repair.

**The operator approves policies, not instances, and Arcadia extracts every
repeated Lead move into a deterministic step.** Progress is measured by
operator clicks per Plan and by the share of Lead turns a script could have
made, not by how long a model can run.

## Decision-making: one card, three surfaces

Every operator touch becomes one `arcadia-decision-card-v1` record: id, kind,
a one-sentence what, options each with its consequence, evidence (links and the
preview fingerprint), a verb, the pins (state hash, head sha, fingerprint), an
expiry, a `policy_match` (null or a policy id) and a receipt path.

| Surface | Verb | What the card is |
|---|---|---|
| Pull request merge | `merge` | the PR body carries the card; a classifier names which authority boundary the diff touches |
| /actions button running an operator script | `run` | the script descriptor is the card; the button posts the pinned fingerprint only |
| /todo formal Decision | `answer` | the Decision record is the card |

Because each card is pinned and leaves a receipt, a deterministic evaluator can
test `policy_match`: a match executes and logs a receipt, no match surfaces the
card. That replaces the Lead class by class, without a new authority store.

Delegation policies extend the existing standing grant (Decision 0072: scoped by
Project, Plan, Action list, providers, concurrency and expiry). They are
proposed by agents, approved or revoked only by the operator, expire, and can
never cover credentials, Grants, spend or Constitution changes.

## What decides what

| Decision | Today | Target |
|---|---|---|
| Non-authority PR merge | Lead (Decision 0060/0080) | automatic |
| Authority-adjacent PR merge | operator | `merge` card + Discord ping |
| Docs/records-only PR | operator, often | automatic under a delegation policy |
| Plan activation / next-Plan handoff | governed PR + merge | `answer` card, or automatic under a policy |
| `complete` / `split` settlement | governed PR | automatic when every criterion is met with evidence; `split` is a card |
| Queue arrange within a Plan | governed PR | automatic (Decision 0122: order is intra-Plan) |
| Spend, token ceiling, capacity gate | operator | `answer` card; platform caps enforce it per run |
| Production START / STOP, scope | operator | START is a `run` button; STOP is automatic on a trigger plus a button |
| `environment_wall` / `budget_exhausted` | CLI only | `run` button running an operator script |
| `scope_*` blocker | operator | `answer` card |
| Credentials, integration, Grants | operator | `answer` card only; never delegable |
| Delegation policy approve / revoke | none | `answer` card; revocation is a one-click `run` button |

## Plan-to-Plan handoff

Deterministic loop: select the next Plan, preflight, activate, run Actions
(merge-then-next, Decision 0097), write the Plan close-out record, turn
frictions into proposals, check stop conditions, repeat. The baton is
`docs/plans/<plan>/close-out.json`: Actions with outcome and PRs, open
remainders, ledger aggregates, open blockers, frictions with their test ids and
a successor recommendation with its preflight hash.

Unattended continuation requires all of: zero open blockers in the close-out,
every split remainder placed, spend under the cap, the successor Plan approved
by the operator before this run began (an agent never authors and activates a
Plan in one stretch), and an unexpired auto-activate policy. Stop triggers: two
consecutive Actions needing more than two blocking review rounds, any
authority-adjacent diff, a red main, spend at 80% of the cap, a repeat
`environment_wall`, a newly raised Decision, a close-out anomaly. Rollback is
the activation receipt plus a STOP button that returns the Plan to draft
through the same settle writer.

## Learnings become optimisation

Every session already adds a ledger row (`docs/reports/session-ledger/`).
Add operator touches by card kind, deterministic Lead turns, review rounds,
blocking defects by class, time to green and tokens; each Plan gets a close-out
aggregate. A friction row is not closed until it cites a test or rule id, and
the Replayer turns receipts into a fixture that fails before the fix. A Lead
command sequence repeated three times in the ledger becomes a script proposal.
Convergence metrics: operator touches per Plan trending to two or fewer, time
from activation to first launch, blocking defects per review round, tokens per
Action, and the deterministic share of Lead turns.

## Milestone ladder

- **L0 (today):** supervised simulated runs; every settlement is a governed PR.
- **L1, cards:** every operator touch in one Plan is a decision card with zero
  host touches and zero copy/paste.
- **L2, policies:** at least three delegation policies approved; one Plan
  completes with at most three operator touches, all authority-related.
- **L3, handoff:** two consecutive Plans run with deterministic select,
  preflight, activate and close-out; model calls only for code and review; one
  rollback rehearsed.
- **L4, stretch:** a multi-Plan run of 24 hours or more where orchestration is a
  script and models are only Driver and Reviewer, inside caps, with every stop
  correctly triggered.

## Risks and what stays human

1. Policy creep: keep policies narrow, expiring, evaluator-tested.
2. Agent-authored Plans auto-activating: require the operator's approval of each
   Plan before it can be selected.
3. The model Reviewer is the safety net: track defects per round and stop on
   anomalies.

Not automated yet: authority-adjacent merges, answering Decisions, spend or cap
changes, credentials and Grants, Plan authorship through activation in one run,
the live Observer (needs its own Decision), and Codex Sessions spending without
an attended first run (Decision 0123).

## First Plan

`docs/plans/` carries the draft Plan that starts L1: the decision-card contract,
card generation from existing sources, /todo and /actions rendering, delegation
policy records and evaluator, the Plan close-out record, the next-Plan selector,
the blocker reset script, and the friction-to-test guard.
