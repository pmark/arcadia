---
arcadia: v1
type: plan
slug: clarification-pass
project: arcadia
status: complete
milestone: Clarification loop shipped
token_impact: large
token_budget: "Historical multi-phase agentic implementation was the primary token cost; migrations, CLI checks, and tests were deterministic."
updated: 2026-08-01
actions:
  - id: phase-1-plumbing
    title: Thin CLI plumbing — artifact create and work update --expected-artifact
    status: done
    responsibility: agent
    effort: session
    next_action: Merged as PR #3; no further work.
    expected_artifact: Merged PR adding artifact create and --expected-artifact
    clarification: clarified
    confidence: high
    source: docs/plans/clarification-pass.md, Phase 1 section
    depends_on: []
  - id: phase-2-fields
    title: Structured clarification fields on work_items
    status: done
    responsibility: agent
    effort: session
    next_action: Merged as PR #6; no further work.
    expected_artifact: Merged PR adding the five clarification columns
    clarification: clarified
    confidence: high
    source: docs/plans/clarification-pass.md, Phase 2 section
    depends_on: [phase-1-plumbing]
  - id: phase-3-decisions-subtasks
    title: Clarification Decisions and Action subtasks
    status: done
    responsibility: agent
    effort: session
    next_action: Merged as PR #10; no further work.
    expected_artifact: Merged PR adding review open and parent_work_item_id
    clarification: clarified
    confidence: high
    source: docs/plans/clarification-pass.md, Phase 3 section
    depends_on: [phase-2-fields]
  - id: phase-4-orchestrator
    title: The arcadia clarify orchestrator over Arcadia Intelligence
    status: done
    responsibility: agent
    effort: project
    next_action: Merged as PR #8; no further work.
    expected_artifact: Merged PR adding the clarify command
    clarification: clarified
    confidence: high
    source: docs/plans/clarification-pass.md, Phase 4 section
    depends_on: [phase-3-decisions-subtasks]
  - id: plan-gate
    title: Gate work plan on clarified Actions
    status: open
    responsibility: requires_review
    effort: short
    clarification: question_open
    gap_type: missing-decision
    question: Should only a clarified Action be plannable, given that gating changes existing planning tests?
    depends_on: [phase-4-orchestrator]
questions: []
decisions: []
---

# Next-Action Clarification Pass

## Executive Summary

Arcadia should convert under-specified Actions into concrete next actions —
or, when information is missing, into exactly one intelligent question that
requests the missing information. This is GTD's "clarify" step, made
continuous and AI-assisted, running inside Arcadia's existing data model
rather than beside it.

The target loop:

```text
Capture (raw, under-specified Action lands in requires_review)
  -> Clarify (evaluate each Action against the rubric)
     -> YES  -> write a concrete next_action + Responsibility, move to work_queue
     -> NO   -> classify the gap, author one Decision holding the question
  -> Operator answers the Decision (or approves a proposed decomposition)
  -> Re-clarify with the answer -> concrete next action
```

Today `arcadia capture` cannot clarify: every captured Action defaults to
the `requires_review` queue with the placeholder next action *"Clarify the
desired outcome or approve a Codex execution path."* A dogfood pass over a
seeded **Private Practice Now** project exercised the whole flow by hand and
surfaced the data-model gaps this plan closes. The end state is a callable
`arcadia clarify` command that does the evaluation and writes structured
results back through first-class fields.

This program is additive and compatibility-preserving per
`docs/arcadia-semantics.md`: new columns via guarded migrations, no renames
of persisted fields, and reuse of building blocks that already exist
(`createReviewItem`, `createArtifactRecord`, the Arcadia Intelligence
structured-generation service).

## Status

**This section is now derived data.** The frontmatter above is the authoritative
record; `arcadia portfolio` reads it after `docs sync`. It is kept in prose for
readers who open the file directly.

- Milestone: **complete.** Milestone 0 (operator-agnostic naming refactor),
  then all four phases: Phase 1 (CLI plumbing, PR #3), Phase 2 (structured
  clarification fields, PR #6), Phase 3 (Decisions + subtasks, PR #10), and
  Phase 4 (the `arcadia clarify` orchestrator, PR #8) are merged to `main`.
- Next Action: none for this plan. The one remaining item — whether
  `clarification_status` should gate `work plan` — is an open question, not a
  decided action, and is recorded as such in the frontmatter.
- Responsibility: Requires Review (the plan gate is an operator decision).
- Required Artifact: delivered — the full capture → clarify → decide loop.
- Decisions open: 1 (the plan gate). Effort scope and the re-clarify trigger
  are both resolved. Engine and subtask policy shipped as defaulted.
- Last Log: 2026-07-25 — all four phases merged; this plan converted to a
  managed document so `docs sync` can ingest it.
- Updated: 2026-07-25

## The clarification rubric

For each Action, answer: *Can I name one concrete, physical next action —
something the operator or an agent could start in the next work session?*

**If YES**, produce:

- `next_action` — one sentence, starts with a verb, physically doable
- `actor` — operator | coding-agent | external-party
- `source` — which Action detail or linked doc justified it
- `confidence` — high | medium | low

**If NO**, classify the gap as exactly one of:

- `missing-decision` — a choice hasn't been made. Output the decision and
  the 2–4 criteria that matter.
- `missing-external-input` — waiting on someone/something outside. Output
  who/what, plus a draft of the ask.
- `missing-definition` — the task is a problem label, not an action. Output
  a proposed decomposition into 2–5 subtasks, flagged as a proposal for
  approval, **not** auto-created.
- `missing-success-criteria` — the action is clear but "done" is not. Output
  "what does finished look like?" specialized to the Action.

Then produce **one** question — the single highest-leverage question whose
answer unblocks the Action. Not a list. One question, requesting specific
information.

`actor` maps onto Arcadia's Responsibility vocabulary:

| Rubric `actor`   | Responsibility (`work_classification`) | Queue             |
| ---------------- | -------------------------------------- | ----------------- |
| operator         | `requires_review`                      | `requires_review` |
| coding-agent     | `codex`                                | `work_queue`      |
| external-party   | `blocked`                              | `blocked`         |

> The Responsibility vocabulary is already operator-agnostic. The earlier
> `needs_mark` value has been collapsed into `requires_review` and the `mark`
> executor type renamed to `operator`, so nothing in this feature reintroduces
> a personal name.

## What already exists (and what's missing)

Investigation of the codebase shows the model is closer than the raw gaps
suggested. Several "gaps" are CLI-surface omissions over code that already
works:

- **Decisions** — `createReviewItem` (`src/db/repositories.ts`) already takes
  every field a clarification question needs: `decisionNeeded`,
  `recommendation`, `sourceInput`, `proposedAction`, `confidenceLabel`,
  `confidence`, `missingFields`, `context`. Nothing exposes it to author one.
- **Artifacts** — `createArtifactRecord` and
  `createWorkItemWithOptionalArtifact` exist; there is no `artifact create`
  subcommand and no `work update --expected-artifact` flag.
- **The clarify engine** — Arcadia Intelligence (`src/intelligence`) is a
  local structured-generation service with `OutputContract` + `ValidationResult`.
  The clarify command should call it, not add a new AI path.

The genuinely missing pieces are: structured clarification fields on an
Action, an "unclarified" state, subtasks, an effort field, a Decision-author
command, and the orchestrator that ties them together.

## Data-model gaps → design

| # | Gap | Design | Primary files |
| - | --- | ------ | ------------- |
| 1 | No way to author a Decision/question | `arcadia review open` (or `work clarify`) wrapping `createReviewItem` with a new `resolved_intent` value `ActionClarification` | `src/commands/review.ts`, `src/cli.ts` |
| 2 | No gap-type / question / confidence / source on an Action | Additive columns `clarification_status`, `gap_type`, `open_question`, `clarification_source`, `confidence` | `src/db/schema.ts`, `repositories.ts`, `domain/types.ts` + `constants.ts` |
| 3 | `next_action` is `NOT NULL` — no "unclarified" state | Do not fight the constraint; add a `clarification_status` enum (`unclarified` \| `clarified` \| `question_open`) as the source of truth; render placeholder next actions as "— (pending clarification)" when unclarified | `commands/capture.ts`, `execution/skills.ts`, rendering |
| 4 | No doc/artifact linking | `arcadia artifact create --work-item …` + `work update --expected-artifact` | `commands/artifact.ts`, `commands/work.ts`, `cli.ts` |
| 5 | No subtasks / parent-child | Additive `parent_work_item_id` (FK, `ON DELETE SET NULL`) + `work add-subtask` + indented listing | `schema.ts`, `repositories.ts`, `commands/work.ts` |
| 6 | No effort field | Additive `effort` column + `--effort` flag + `EFFORT_LEVELS` enum | `schema.ts`, `repositories.ts`, `constants.ts`, `cli.ts` |
| 7 | ~~CLI hides `needs_mark`~~ | **Resolved** by the operator-agnostic refactor — the value is gone; `actor: operator` records as `requires_review` | — |
| 8 | Capture ≠ clarify | `arcadia clarify` orchestrator over Arcadia Intelligence | new `commands/clarify.ts`, `intelligence/client`, `cli.ts` |

Migrations follow the established idempotent pattern: guarded
`ensure*Column()` functions in `applyMigrations()` doing
`ALTER TABLE … ADD COLUMN` behind a `PRAGMA table_info` check
(model: `ensureProjectGoalColumn`).

## Phased implementation

Each phase is additive, independently shippable, and grounded in existing
code. Phases 1–2 improve even the manual pass immediately; Phase 4 is the
payoff and depends on everything under it.

```text
Phase 1 (plumbing) ─┐
Phase 2 (fields) ───┼─► Phase 3 (decisions + subtasks) ─► Phase 4 (clarify engine)
                    ┘
```

### Phase 1 — Thin CLI plumbing (~1 day)

Gap #4. Add `arcadia artifact create --work-item <id> --project <id>
--title --type --status --path` wrapping `createArtifactRecord`, and add
`--expected-artifact <text>` to `work update` (thread into `updateWorkItem`,
which today handles only `queue` / `workClassification` / `nextAction` /
`status`). Gap #7 is already closed by the naming refactor.

*Tests:* create-and-link round-trip; `work update` field round-trip.

### Phase 2 — Structured clarification fields (~1 day)

Gaps #2, #3, #6. One migration adds nullable columns to `work_items`:
`clarification_status`, `gap_type`, `open_question`, `clarification_source`,
`confidence`. (`effort` and `--effort` landed earlier as Phase 1 groundwork, so
gap #6 needed nothing here.) Thread them through `updateWorkItem`, the
`WorkItemSummary` type, and `renderWorkItem`. New `work update` flags:
`--clarification-status`, `--gap-type`, `--question`, `--confidence`,
`--source`. `capture` writes `clarification_status = 'unclarified'`. This
retires the `[GAP …]`-string-mangling of `next_action` the dogfood had to use.

A NULL `clarification_status` is kept distinct from `unclarified`: NULL means
the Action predates clarification or was never evaluated, `unclarified` asserts
it is known to lack a concrete next action.

*Tests:* migration idempotency; field round-trip; capture sets `unclarified`.

### Phase 3 — Author Decisions + subtasks (~1.5 days)

Gaps #1, #5. `arcadia review open` calls `createReviewItem` with
`resolved_intent = ActionClarification`, so an exact, human/agent-authored
question becomes a real Decision surfacing in `review list`, `attention`, and
the Dashboard. Add `parent_work_item_id` + `arcadia work add-subtask`
(or `capture --parent`) with indented children in `work list` / `queue`, so
`missing-definition` decompositions have a real home.

*Tests:* Decision open→list→resolve lifecycle; parent/child listing + cascade.

### Phase 4 — The `arcadia clarify` orchestrator (~2–3 days, depends on 1–3)

Gap #8. `arcadia clarify [--project <id>] [--work <id>] [--apply]`. For each
unclarified Action it builds an `IntelligenceRequest` with an `OutputContract`
whose JSON schema is exactly the rubric above (`verdict` → either
`{next_action, actor, source, confidence}` or `{gap_type, question,
criteria|decomposition|draft-ask}`), submits it to the Arcadia Intelligence
service, validates, and writes results via the Phase 2/3 fields. Default is a
dry-run preview; `--apply` persists. This is the deterministic, callable step
between `capture` and the queue that the whole dogfood was prototyping.

*Tests:* golden-request fixtures with a stubbed intelligence job covering all
four gap types plus a YES verdict.

## Design decisions (defaults)

Two calls change the schema and the engine contract. Recommended defaults,
revisable in code:

- **Subtasks: propose-only, never auto-create.** `clarify` writes a
  `missing-definition` decomposition into the Action's Decision; child Actions
  exist only after the operator approves. Matches the approval-boundary
  preference in `OPERATOR_CONTEXT.md`.
- **Clarify engine: Arcadia Intelligence only.** Route every evaluation
  through the local structured-generation service with an `OutputContract`.
  Honors "local AI before frontier models"; deterministic, testable, offline.
  A `--engine` escape hatch can be added later if a task proves too hard for
  the local model.

## Effort & sequencing

| Phase | Gaps | Nature | Effort |
| ----- | ---- | ------ | ------ |
| 1 | #4 (#7 done) | CLI surface over existing repo code | ~1 day |
| 2 | #2, #3, #6 | Additive `work_items` columns + flags | ~1 day |
| 3 | #1, #5 | `review open` + `parent_work_item_id` | ~1.5 days |
| 4 | #8 | `clarify` orchestrator over Intelligence | ~2–3 days |

Total ~1.5–2 focused weeks, shippable incrementally.

## Testing strategy

- Migration idempotency tests (fresh DB no-op; legacy DB upgrades once).
- Round-trip tests for every new field and flag.
- Decision lifecycle tests for `review open`.
- Golden-request fixtures for `clarify`, one per verdict/gap type, against a
  stubbed Intelligence job so the suite stays deterministic and offline.
- Negative-guard assertions that clarify never auto-creates subtasks and never
  emits a personal name in output.

## Open questions

- Should `clarification_status` gate `work plan` (i.e. can only a `clarified`
  Action be planned)? Leaning yes, but it changes existing planning tests.
- ~~Does `effort` belong on every Action or only on clarified ones?~~
  **Resolved** — Phase 1 shipped `effort` on every Action, nullable, sized
  after the fact via `work update --effort` rather than guessed at intake.
- ~~Should a resolved clarification Decision automatically re-run `clarify` on
  its Action, or wait for an explicit `clarify` call?~~ **Resolved** — Phase 3
  shipped the explicit version: answering returns the Action to `unclarified`
  with the answer in `clarification_source`, and nothing re-evaluates until
  `clarify` is called.

## Future: PR-driven memory (not scoped, not scheduled)

The Obsidian Vault memory this program feeds is currently empty in practice,
because vault-writing is coupled to the operator using Arcadia for decisions, and
that habit is infrequent. Merged PRs are not infrequent — they're the actual
unit of work already happening. Idea for a later phase: make a merged PR the
memory-writing trigger, not a decision resolution.

Concretely: a `CHANGELOG.md` per repo, appended to on merge with a durable
summary of the PR (what changed, why, links to the originating Action /
Decision where one exists). `OVERVIEW.md` files at any grouping level
(project, repo group, workspace) would then be *derived rollups* over those
ledgers rather than hand-maintained documents — same relationship the
Dashboard snapshot already has to raw `work_items`/`artifacts` rows.

This is additive to, not a dependency of, Phases 1–4 above: the clarify
engine populates the vault with *why an Action exists*; a PR-driven ledger
would populate it with *what shipped*. Worth revisiting once Phase 4 lands
and the clarify loop has real usage data to react to — not before.

## Future: continuous agent operation (not scoped, not scheduled)

The end-state the operator described: tell Arcadia a desired outcome; Arcadia
extracts intent, routes it to the right Project(s), works with coding agents
to design and plan the work, asks for clarification or review when
appropriate, then drives the agents and reports back over Discord.

The clarification pass is the spine of that loop, but it is not the whole
loop. Honest status of each step against the code as of 2026-07-24:

| Step | Status |
| ---- | ------ |
| State a desired outcome | **Exists** — `capture`, `ask` |
| Extract intent | **Exists** — Phase 3 registries + `intent/resolver.ts`, Arcadia Intelligence for structured generation |
| Choose the right Project(s) | **Missing** — `capture` takes a manual `--project` flag only (`commands/capture.ts`); nothing infers a Project from intent |
| Design and plan work with agents | **Exists, gated** — `work plan` builds packets behind an approval Decision |
| Ask for clarification / review | **In progress** — Phases 1–4 of this plan; Phase 1 shipped |
| Drive the agents continuously | **Partial** — see below |
| Report back over Discord | **Exists, pull-shaped** — the bot has `status`, `runs`, `requiresReview`, `request` commands; the operator asks, Arcadia does not yet initiate |

### What "drive the agents continuously" needs

Two pieces of this are already stronger than expected:

- **Token/budget awareness.** `codingAgents/availability.ts` models
  `available | unknown | usage_limited | budget_limited` from real
  rate-limit percentages, and `selectAgentProfile` already refuses a
  saturated profile and falls back to another of the same purpose.
- **Durable execution.** The `worker` daemon claims Runs by PID, heartbeats,
  and recovers orphans.

Three pieces do not exist:

1. **Nothing fills the queue.** The worker only calls
   `claimNextPendingRun` — it drains. The only two enqueue sites are
   `work run --allow-codex-planning` and `review approve --execute`, each
   one operator action producing one Run. The loop is therefore: approve one
   thing, one Run executes, worker idles. Saturation fails at the fill step,
   not the execute step.
2. **No standing approval.** "Approved work" today is one Decision per Run,
   operator in the loop each time. Continuous operation needs approval
   attached to a *class* of work rather than an instance — e.g. "any
   clarified Action in Project X with high confidence and effort ≤ short may
   dispatch to `claude_build` without a per-instance Decision." Note that
   `clarification_status`, `confidence`, and `effort` — the Phase 2 columns —
   are exactly the inputs such a policy would gate on. The substrate is being
   built already; only the policy layer is missing.
3. **No cross-project dispatch or concurrency.** `selectDailyAdvantage` is
   `LIMIT 1`, returning a single item for a human to consider. Nothing ranks
   candidate Actions across all Projects and dispatches several, and
   `runWorkerIteration` claims one Run per iteration — so keeping Codex *and*
   Claude busy simultaneously needs per-profile dispatch that does not exist.

### Why this is where the risk posture gets written down

Arcadia's stated preference is to err stable and reliable, taking measured
rather than opportunistic risk. Standing approval is the first place that
preference stops being a disposition and becomes an enforceable policy: it is
literally a rule about which work may proceed without a human. It should be
designed as such — explicit, inspectable, per-Project, and revocable — rather
than emerging as a convenience flag.

Sequencing: Phase 4 first regardless. A dispatcher with nothing well-specified
to dispatch, and a standing-approval policy with no `confidence`/`effort`
fields to gate on, are both premature. Project routing (row 3 above) is an
independent gap and could be picked up sooner if capture-to-the-wrong-place
becomes the friction that hurts most.
