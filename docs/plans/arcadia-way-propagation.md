---
arcadia: v1
type: plan
slug: arcadia-way-propagation
project: arcadia
status: active
milestone: No Arcadia project is silently stale on the Way, and no project's governance changes without review
current_action: give-arcadia-its-own-context-files
token_impact: medium
token_budget: "Drift detection and file generation are deterministic — no model call belongs in either. Reserve model use for one implementation session per Action and a single review pass; a propagation run that calls a model per repository is the failure mode this budget exists to prevent."
updated: 2026-08-16
actions:
  - id: give-arcadia-its-own-context-files
    title: Give Arcadia the .arcadia context files it tells every project to read
    status: open
    responsibility: codex
    effort: quick
    next_action: Run `arcadia project setup-context` against this repository, or hedge the shared region's wording the way its `docs/managed-documents.md` line already is.
    expected_artifact: Either `.arcadia/AGENT_CONTEXT_POLICY.md`, `.arcadia/repo-context.md`, and `.arcadia/context-policy.json` in this repository, or a shared region that does not instruct agents to read files a repository may not have
    clarification: clarified
    confidence: high
    source: Found immediately by making Arcadia adopter zero, PR #66.
    acceptance_criteria:
      - Every file the shared AGENTS.md region tells an agent to read before broad exploration exists in this repository, or the region no longer unconditionally tells them to.
      - The adopter-zero test in tests/arcadia-way-propagation.test.ts still passes.
    depends_on: []
    references:
      - AGENTS.md
      - docs/agents-context.md
      - src/projects/contextSetup.ts
  - id: report-way-drift
    title: Report which projects are stale on the Way, without writing anything
    status: open
    responsibility: codex
    effort: session
    next_action: Add a read-only command that compares each adopting repository's managed regions against the canonical text and reports per project what differs.
    expected_artifact: A noun command reporting, per adopting project, whether CONSTITUTION.md, the shared AGENTS.md region, and docs/agent-continuation-protocol.md match the canonical text, and what its adoption.json upgrade_policy is
    clarification: clarified
    confidence: high
    source: Today the only way to learn whether a project is current is to run the writer and read the diff, which makes the read available only by attempting a write.
    acceptance_criteria:
      - The command writes nothing to any repository, consistent with the naming rule it reports on.
      - It names each stale project, which managed region differs, and the project's declared upgrade_policy.
      - A project whose repository path is unset or unreachable is reported as unknown rather than assumed current.
    depends_on: []
    references:
      - src/projects/contextSetup.ts
      - docs/agents-context.md
      - .arcadia/arcadia-way/adoption.json
  - id: open-way-sync-pull-requests
    title: Propagate Way changes to every project as a pull request, never as a merge
    status: open
    responsibility: requires_review
    effort: session
    expected_artifact: A command that regenerates managed regions in each adopting repository and opens one pull request per repository, merging nothing
    clarification: question_open
    gap_type: missing-decision
    question: "Which tiers of Way change may propagate automatically, and does Arcadia's CI get push access to every project repository to do it?"
    confidence: medium
    source: Operator asked whether Way updates should reach projects automatically, 2026-08-16.
    depends_on: [report-way-drift]
    references:
      - docs/agents-context.md
      - src/projects/contextSetup.ts
questions:
  - id: propagation-authority
    question: "Which tiers of Way change may propagate automatically, and does Arcadia's CI get push access to every project repository to do it?"
    gap_type: missing-decision
decisions: []
---

# Arcadia Way propagation

## What this plan displaced

Dispatch moved here from `demo-first-delivery` on operator direction,
2026-08-16. Exactly one Action may be current across the project, so that plan's
`current_action` was removed rather than left to be reported as a competing
objective. It stays `status: active` with every Action intact, so resuming it is
a pointer change and nothing else: set `active_plan: demo-first-delivery` in
`PROJECT.md` and restore `current_action: build-demo-hero-vertical-slice` to its
frontmatter. That Action is `open`, exactly as it was left.

## Why this plan exists

Arcadia writes the Way into every project, and nothing pulls it back. A project
is current because someone ran `arcadia project setup-context` at it, and stale
because nobody did. PPN's `.arcadia/arcadia-way/adoption.json` declares
`upgrade_policy: "explicit-only"`, which is honest about the mechanism rather
than a workaround for it.

That was survivable while the Way was small and the portfolio was one or two
projects. It stops being survivable when a Way change alters what agents are
*permitted* to do. The `open`-is-executable clarification is the worked example:
before it, an agent read the rule strictly and stopped; after it, the same agent
proceeds. Two coding agents stopped on that ambiguity in different repositories
before it was found.

## What is settled

Generating updated files in a working tree is safe, reversible, and idempotent,
and the `ARCADIA_CONTEXT_*` markers already protect a project's own sections.
Applying them — commit, push, merge into a project's `main` — crosses an
approval boundary the Constitution names explicitly.

So the automatic unit is a pull request per repository, not a commit. That much
does not need a Decision.

## What is not settled

Three things, all folded into `propagation-authority`:

- **Tiers.** Mechanical text (managed regions, `.arcadia` policy files) is a
  different risk from a constitutional amendment, which `adoption.json` records
  as ratified per project by the operator. Auto-applying an amendment would make
  that ratification field assert something false.
- **Command-surface changes.** A project may wrap the CLI — PPN's
  `scripts/arcadia.mjs` hardcodes repository paths — so renaming a command
  breaks a wrapper no marker protects.
- **Credentials.** Automatic propagation means Arcadia's CI holds push access to
  every project repository. That is a real blast radius and an authority
  boundary, not an implementation detail.

`adoptContinuationProtocol` already emits `TRIAGE THIS SECTION` when a preserved
local section restates the shared contract. Any propagation design must treat
that marker as a stop: a pull request carrying one is not eligible for automatic
merge under any tier.
