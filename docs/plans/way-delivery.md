---
arcadia: v1
type: plan
slug: way-delivery
project: arcadia
status: draft
milestone: Every adopting project receives Way changes and can ask for Way capabilities without anyone writing Arcadia twice
token_impact: medium
token_budget: "Regeneration, drift comparison, and pull-request mechanics are deterministic and belong in code, not a model. Reserve model use for one implementation session per Action and a single review pass. A propagation run that calls a model per repository is the failure mode this budget exists to prevent."
recommended_model: claude-sonnet-5
updated: 2026-08-17
actions:
  - id: open-way-sync-pull-requests
    title: Propagate Way changes to every project as a pull request, never as a merge
    status: open
    responsibility: requires_review
    effort: session
    next_action: Implement tiered propagation — regenerate each adopting repository's mechanical tier, open one pull request per repository, and auto-merge only the mechanical tier within the guardrails Decision 0024 sets.
    expected_artifact: A command that regenerates managed regions in each adopting repository and opens one pull request per repository, auto-merging only the mechanical tier
    clarification: clarified
    confidence: medium
    source: Operator asked whether Way updates should reach projects automatically, 2026-08-16; answered by Decision 0024 on 2026-08-17. Rehomed here from arcadia-way-propagation on 2026-08-17, which had reached its milestone while this Action was still blocked.
    acceptance_criteria:
      - A mechanical-tier change propagates to every adopting repository as one pull request per repository and merges without review.
      - A governing-tier change opens a pull request and never merges automatically, including when a run would touch both tiers.
      - A run that would produce byte-identical files opens nothing.
      - Nothing outside the managed marker region is ever written, and no push targets a default branch directly.
      - A repository whose `adoption.json` declines automatic upgrades is skipped and reported.
    decisions: ["0024"]
    depends_on: []
    references:
      - docs/agents-context.md
      - src/projects/contextSetup.ts
      - docs/decisions/0024-way-propagation-tiers-and-push-authority.md
  - id: accept-upstream-proposals
    title: Let a project ask for a Way capability instead of building one
    status: open
    responsibility: codex
    effort: session
    next_action: "Ingest `type: proposal` documents as pending operator requests, surface unresolved ones in `arcadia portfolio` under 'Waiting on you', and add the request path to the shared AGENTS.md region."
    expected_artifact: A proposal filed in an adopting repository that reaches the operator through docs sync and portfolio without any new channel, plus the AGENTS.md rule that tells agents to file rather than implement
    clarification: clarified
    confidence: high
    source: Decision 0025. PPN's 781-line scripts/arcadia.mjs is what a missing escalation path produces.
    acceptance_criteria:
      - "A `type: proposal` document committed in an adopting repository is ingested by `docs sync` as a pending request rather than an unhandled narrative record."
      - Unresolved proposals appear in `arcadia portfolio` under 'Waiting on you' with their project and question.
      - A proposal records the Decision that answered it, and stops appearing once answered.
      - The shared AGENTS.md region states that an agent files a proposal and continues without the capability, and never implements Arcadia machinery locally.
      - Filing requires no network access, credentials, or reachable Arcadia, so it works from a cloud container.
    decisions: ["0025"]
    depends_on: []
    references:
      - src/docs/sync.ts
      - src/docs/discover.ts
      - src/commands/portfolio.ts
      - docs/decisions/0025-upstream-way-change-requests.md
  - id: evaluate-document-triggers
    title: Evaluate the deferrals Arcadia's own documents already declare
    status: open
    responsibility: codex
    effort: session
    next_action: "Add an `arcadia triggers` noun that reads a repository's declared deferral conditions and reports which have fired, evaluating them repo-locally with no workspace, the way `resolveDispatch` does."
    expected_artifact: A read-only `arcadia triggers` command reporting fired, waiting, and watch states for every deferral declared in a repository's governed documents
    clarification: clarified
    confidence: high
    source: Decision 0028, promoting PPN's implementation. Nine Arcadia documents declare deferrals with reviving conditions and nothing can evaluate one of them.
    acceptance_criteria:
      - Every deferral this repository declares is either evaluated or explicitly reported as unevaluable, with no deferral silently ignored.
      - A fired condition is reported as fired, and the continuation protocol's rule that a firing trigger outranks `current_action` has something to read.
      - The command is a noun - it reports and never writes.
      - It runs with no workspace and no database, so it works in a fresh clone or a container.
    decisions: ["0028"]
    depends_on: []
    references:
      - docs/decisions/0028-ppn-capability-reconciliation.md
      - src/docs/dispatch.ts
  - id: adopt-operator-task-ledger
    title: Record work only the operator can do, separately from decisions awaiting review
    status: open
    responsibility: codex
    effort: session
    next_action: "Adopt PPN's operator task ledger - append-only entries citing an action or decision, stating why an agent cannot act, with agent evidence separated from operator-only closure."
    expected_artifact: An operator task ledger with raise, read, close, and decline paths, where closure is operator-only and an agent may attach evidence without closing
    clarification: clarified
    confidence: medium
    source: Decision 0028, promoting PPN's ADR 0025 implementation ratified there 2026-08-14.
    acceptance_criteria:
      - An agent can raise an entry and attach evidence, and cannot close one.
      - Every entry cites an action, decision, or blocker already in project control and states why an agent cannot do it.
      - Entries are distinguishable from Decisions awaiting review, which `attention` already covers, and from Back Burner items awaiting a surfacing condition.
      - Open entries surface to the operator without being hunted for.
    decisions: ["0028"]
    depends_on: []
    references:
      - docs/decisions/0028-ppn-capability-reconciliation.md
      - src/commands/attention.ts
questions: []
decisions: ["0024", "0025", "0028"]
---

# Way delivery

## Why this plan exists

`arcadia-way-propagation` reached its milestone — staleness is visible rather
than silent, and `arcadia way` reports it. But two things it never covered are
now the whole problem:

**Nothing delivers.** `arcadia way` reports that a project is stale; no command
makes it current. Way changes still reach projects by hand, which works at
three repositories and is exactly what breaks as adoption grows.

**Nothing receives.** A project that needs a Way capability has no way to ask
for one. Private Practice Now's `scripts/arcadia.mjs` — 781 lines including a
second implementation of the managed-document parser — is what that absence
produces. It was not misbehaviour; it was the only move available.

Those are the two directions of one pipe, which is why they belong in one plan
rather than being scattered.

## What this plan does not cover

Distributing Arcadia's **code** to projects, so a container can orient itself
without an Arcadia checkout. That is the packaging question deferred on
`arcadia-way-propagation` behind its own trigger, and it is a distribution
decision rather than a delivery mechanism. This plan makes policy and requests
flow; it does not make `src/docs/*` installable.

The consequence is worth stating plainly: after this plan, PPN's shim can be
*trimmed* — its docket, and eventually its triggers and demo, become requests
rather than local code — but it cannot be *deleted*, because the project still
has no way to import Arcadia.

## Why it is `draft`

Arcadia's `active_plan` is `demo-first-delivery`, and this plan does not
displace it. Nothing here dispatches until the operator moves the pointer.
