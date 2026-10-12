# PR 1307 — current governed criteria repairs

These are approval-ready proposals, not applied changes. This Artifact supersedes its earlier r3 source projection. It is bound to the candidate's conflict-free merge of main `917a0db7f9b6e92e640c2968165384712238dd8c` into PR head `f7c6160caa78ef2faf98633c3b9c066e7b66c23d`.

The requested changes affect exactly ten Actions in three Plans: five missing historical criteria lists in `clarification-pass`, three in `portfolio-docs-protocol`, and one numeric token condition in each of the split probe parent and successor. The parent `probe-environment-inside-session` remains done; successor `attach-the-session-probe-result-to-the-reconcile-receipt` remains open and current. The parent changes only criterion index 1; the successor changes only criterion index 0. The existing 5,000 input-token fixture budget, 1,800 recorded usage, passing-probe bound and reconcile-receipt requirement are retained.

Every other Action control field, Plan field except its update timestamp, Project pointer, dependency, reference and split link is identical to the current merged source. Source attribution may record the amendment. Every official preview has `applied: false` and identical queue-before and queue-after values. Approved settlement also archives its disposable Ask input through the normal writer. These previews grant no approval; fresh fingerprints are required before apply if source or queue bytes change.

The prior `precise-criteria-build-probe-budget-20261012-r3` proposal (`agentask_576f2e3e049c001c1c`) is superseded for consideration by the new r4 proposal, as explicitly recorded in its rationale. R3 was neither approved nor applied; this Artifact does not reject or settle it. Its old single-parent replacement would restore the receipt condition moved by the governed split and leave the successor invalid. The earlier broad active-Plan amendment and common-planning pipeline proposal remain pending and outside this narrow build repair.

## Current static proof

A disposable filesystem projection overlays exactly the three official Plan preview outputs on the current merged control documents. Validation reports zero errors and zero rejected documents. Dispatch resolves `attach-the-session-probe-result-to-the-reconcile-receipt` with zero blockers. A structural comparison confirms that all control fields except acceptance criteria/source attribution/update timestamp are identical and exactly ten Actions change criteria. The live source still has ten validation errors; no preview output has been written into it.

Proof receipt: `/tmp/pr1307-current-projection-proof.json`.
Static snapshot: `/tmp/pr1307-current-projection-ZT8ysG`.
The snapshot is disposable evidence, never a configured workspace or competing authority.

## Exact official preview outputs

### precise-criteria-clarification-pass-20261012

Proposal: `agentask_53c64332a81bb3c231`
Unapplied settlement preview: `asksettle_5f0e0a800a23439782`
Preview fingerprint: `9ee8aba3f356cb2a25cbdfe387ee0fab811987181875abf6e6092773102c0b8c`
Target: `docs/plans/clarification-pass.md`
Current source SHA256: `104384013acfdda4ea1b3159c18afe23b3fde3fc6bda162a09079e38d04d9524`

```yaml
---
arcadia: v1
type: plan
slug: clarification-pass
project: arcadia
status: complete
milestone: Clarification loop shipped
token_impact: large
token_budget: "Historical multi-phase agentic implementation was the primary token cost; migrations, CLI checks, and tests were deterministic."
updated: 2026-10-12
actions:
  - id: phase-1-plumbing
    title: Thin CLI plumbing — artifact create and work update --expected-artifact
    acceptance_criteria:
      - CLI help lists artifact create and work update --expected-artifact; a CLI fixture creates an Artifact linked to its Action and persists the supplied expected-artifact value.
    status: done
    responsibility: agent
    effort: session
    next_action: Merged as PR
    expected_artifact: Merged PR adding artifact create and --expected-artifact
    clarification: clarified
    confidence: high
    source: Agent Ask precise-criteria-clarification-pass-20261012
    depends_on: []
  - id: phase-2-fields
    title: Structured clarification fields on work_items
    acceptance_criteria:
      - A fresh database and an upgraded database each expose clarification_status, gap_type, open_question, clarification_source and confidence on work_items; repeating migration leaves exactly one column of each name.
    status: done
    responsibility: agent
    effort: session
    next_action: Merged as PR
    expected_artifact: Merged PR adding the five clarification columns
    clarification: clarified
    confidence: high
    source: Agent Ask precise-criteria-clarification-pass-20261012
    depends_on: [phase-1-plumbing]
  - id: phase-3-decisions-subtasks
    title: Clarification Decisions and Action subtasks
    acceptance_criteria:
      - CLI fixtures open a clarification Decision and add a child Action whose parent_work_item_id equals the named parent; listing the Actions shows that parent-child relationship.
    status: done
    responsibility: agent
    effort: session
    next_action: Merged as PR
    expected_artifact: Merged PR adding review open and parent_work_item_id
    clarification: clarified
    confidence: high
    source: Agent Ask precise-criteria-clarification-pass-20261012
    depends_on: [phase-2-fields]
  - id: phase-4-orchestrator
    title: The arcadia clarify orchestrator over Arcadia Intelligence
    acceptance_criteria:
      - A clarify fixture maps a concrete next action to clarified and an unresolved requirement to question_open with exactly one question and gap_type, preserving the original captured input.
    status: done
    responsibility: agent
    effort: project
    next_action: Merged as PR
    expected_artifact: Merged PR adding the clarify command
    clarification: clarified
    confidence: high
    source: Agent Ask precise-criteria-clarification-pass-20261012
    depends_on: [phase-3-decisions-subtasks]
  - id: plan-gate
    title: Gate work plan on clarified Actions
    acceptance_criteria:
      - An explicit Decision records whether work plan requires clarified Actions and names the compatibility consequences; until that Decision is answered this Action remains question_open and is not dispatched.
    status: open
    responsibility: requires_review
    effort: short
    clarification: question_open
    source: Agent Ask precise-criteria-clarification-pass-20261012
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
```

### precise-criteria-portfolio-docs-protocol-20261012

Proposal: `agentask_46c417530b96c8c284`
Unapplied settlement preview: `asksettle_a5150abfe2784674a7`
Preview fingerprint: `ef158d58f65f872ecdad3c7ec76aa4b18feae08d358f84098cebd9ba82f2f35a`
Target: `docs/plans/portfolio-docs-protocol.md`
Current source SHA256: `ecf54761af0a28e7fe44258a3903f4d7d828d13cd226c6d70551b0ae8a94c1ba`

```yaml
---
arcadia: v1
type: plan
slug: portfolio-docs-protocol
project: arcadia
status: active
milestone: docs sync ingests a real project's markdown
token_impact: xlarge
token_budget: "The historical protocol program required several agentic implementation sessions; parsing, sync, dependency resolution, and validation are deterministic, and deferred narrative summarization is the only routine model-bearing path."
recommended_model: gpt-5.6-terra
recommended_reasoning_effort: high
updated: 2026-10-12
actions:
  - id: build-parser
    title: Build the frontmatter parser and vocabulary validator
    acceptance_criteria:
      - Parsing a managed frontmatter fixture returns its declared Project, Plan or Decision fields; an invalid vocabulary value reports the exact file and field without throwing away errors in other files.
    status: done
    responsibility: agent
    effort: session
    next_action: Delivered in src/docs/parse.ts; no further work.
    expected_artifact: Frontmatter parser reporting per-field validation errors
    clarification: clarified
    confidence: high
    source: Agent Ask precise-criteria-portfolio-docs-protocol-20261012
    depends_on: []
  - id: build-upsert
    title: Build the upsert layer (project/plan/decision -> DB rows)
    acceptance_criteria:
      - Applying the same managed-document fixture twice leaves one row per doc_ref and no duplicate dependency links; a changed title updates the existing row rather than creating another.
    status: done
    responsibility: agent
    effort: session
    next_action: Delivered in src/docs/sync.ts, keyed by doc_ref; no further work.
    expected_artifact: Idempotent doc_ref-keyed upsert
    clarification: clarified
    confidence: high
    source: Agent Ask precise-criteria-portfolio-docs-protocol-20261012
    depends_on: [build-parser]
  - id: wire-docs-sync-command
    title: Wire arcadia docs sync [--project] [--apply] into the CLI
    acceptance_criteria:
      - CLI help lists docs sync with --project and --apply; a fixture dry run writes no Project rows, the same --apply run persists the declared records, and portfolio reports the synced Project.
    status: done
    responsibility: agent
    effort: short
    next_action: Delivered alongside arcadia portfolio; no further work.
    expected_artifact: docs sync and portfolio commands
    clarification: clarified
    confidence: high
    source: Agent Ask precise-criteria-portfolio-docs-protocol-20261012
    depends_on: [build-upsert]
  - id: contract-work-pointer
    title: Add the authoritative work pointer and dispatch resolution
    status: done
    responsibility: agent
    effort: session
    next_action: Delivered as active_plan, current_action, acceptance_criteria, and arcadia next.
    expected_artifact: arcadia next resolving or refusing a dispatch with named remedies
    acceptance_criteria:
      - PROJECT.md carries active_plan and the active plan carries current_action.
      - arcadia next resolves exactly one action, or lists blockers naming file, field, and remedy.
      - A clarified current action without acceptance criteria fails validation.
      - A second plan designating a current_action is reported as a competing objective.
    clarification: clarified
    confidence: high
    source: Arcadia Coding-Agent Continuation Contract
    depends_on: [wire-docs-sync-command]
  - id: second-project-validation
    title: Validate the protocol against a non-Arcadia repository
    status: done
    responsibility: agent
    effort: session
    clarification: clarified
    confidence: high
    next_action: Completed and validated on 2026-07-25; select the next protocol increment explicitly.
    expected_artifact: Foreign-repository validation report with sync, next, execution-profile, and deterministic-refusal evidence.
    acceptance_criteria:
      - Decision 0002 records Private Practice Now as the first foreign repository.
      - Both repositories' applicable instructions and bounded context are read and the current milestone, Action, responsibility, and required artifacts are recorded.
      - docs sync is previewed before apply and the minimum managed-document changes for Private Practice Now are identified.
      - arcadia next, execution-profile resolution, and deterministic refusal behavior are demonstrated without changing Private Practice Now implementation code.
      - Findings, incompatibilities, recommended patches, and continuation state are recorded in this plan and the mission Log.
      - Focused validation passes and no deployment, publish, commit, push, credential, production, or destructive operation occurs.
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: cross_system
        required:
          - Read-only inspection of Private Practice Now documentation and worktree state
          - Local Arcadia workspace and managed-document updates only
        staging: forbidden
      phases:
        planning:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    decisions: ["0002"]
    references:
      - docs/plans/portfolio-docs-protocol.md
      - docs/COMMANDS.md
    depends_on: [contract-work-pointer]
  - id: repair-clarification-response-ux
    title: Make clarification Decisions directly answerable in Mission Control and Discord
    status: done
    responsibility: agent
    effort: session
    clarification: clarified
    confidence: high
    next_action: Delivered and validated on 2026-07-25; monitor real operator use before broadening the response protocol.
    expected_artifact: A conversational clarification-response flow with durable answers, immediate acknowledgment, automatic re-clarification, and explicit execution boundaries.
    acceptance_criteria:
      - A free-text Discord reply to a clarification notification records the answer against that exact Decision.
      - Mission Control exposes an answer field and does not present clarification as approval.
      - AI advice can populate an editable draft but never submits an answer or grants authority.
      - The operator receives an immediate durable acknowledgment while clarification continues.
      - The resulting concrete next Action or one focused follow-up question is surfaced without a second command.
      - Approval Decisions retain deterministic approve, reject, and defer behavior; free-form text cannot authorize execution.
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: cross_system
        required:
          - Shared CLI Decision-response semantics
          - Mission Control review flow
          - Discord review notifications and replies
        staging: forbidden
      phases:
        planning:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    references:
      - START_HERE.md
      - docs/COMMANDS.md
      - apps/dashboard/README.md
      - apps/discord-bot/README.md
    depends_on: []
  - id: ingest-mission-logs
    title: Ingest MISSION_LOG.md entries as mission_logs rows
    status: done
    responsibility: agent
    effort: short
    clarification: clarified
    confidence: high
    source: Decision 0003, which selected this increment over the other two
    next_action: Delivered as doc_ref-keyed Log ingestion in src/docs/sync.ts; no further work.
    expected_artifact: Idempotent mission-Log ingestion with focused parser, sync, and duplicate-prevention tests.
    decisions: ["0003"]
    acceptance_criteria:
      - Each dated MISSION_LOG.md entry becomes one mission_logs row, keyed so re-running creates no duplicates.
      - docs sync stops reporting log files as skipped.
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: project
        required:
          - Managed-document parser and sync changes
          - SQLite mission_logs persistence
          - Focused idempotency validation
        staging: forbidden
      phases:
        planning:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    depends_on: [build-upsert]
  - id: persist-dependencies
    title: Persist action depends_on ordering rather than only validating it
    status: done
    responsibility: agent
    effort: short
    clarification: clarified
    confidence: high
    source: Decision 0003, selected against the operator's stated criterion of advancing agent-managed planned work.
    next_action: Delivered on 2026-07-26 as work_item_dependencies plus a dispatch refusal; no further work.
    expected_artifact: Persisted depends_on edges with a dispatch refusal naming the unfinished prerequisite, its file, field, and remedy.
    acceptance_criteria:
      - depends_on edges survive a docs sync round trip.
      - An Action cannot be dispatched while an Action it depends on is unfinished.
    decisions: ["0004"]
    references:
      - src/docs/sync.ts
      - src/docs/dispatch.ts
      - src/db/schema.ts
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: project
        required:
          - SQLite dependency-edge persistence
          - Managed-document sync changes
          - Dispatch refusal behavior
        staging: forbidden
      phases:
        planning:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    depends_on: [build-upsert]
  - id: narrative-summarization
    title: Queue an Intelligence summarization job for narrative docs
    status: open
    responsibility: agent
    effort: short
    acceptance_criteria:
      - A narrative doc produces an Artifact holding its summary.
      - The summary is never written back into the source document.
    clarification: unclarified
    decisions: ["0004"]
    depends_on: [wire-docs-sync-command]
questions:
  - id: plan-milestone-span
    question: If one plan's work spans multiple milestones, should the protocol split the plan, or allow a plan to reference more than one milestone?
    gap_type: missing-decision
    decision: "0005"
  - id: docs-sync-write-back
    question: Should docs sync ever write back to a repo (e.g. append Arcadia run results to MISSION_LOG.md), or must it stay strictly one-way?
    gap_type: missing-decision
    decision: "0004"
decisions: ["0003", "0004", "0005"]
---

# Portfolio Docs Protocol

## Executive Summary

Docs as the distributed database of intent across every project Arcadia
manages. Frontier-model chatbots write these files from working
conversations; Arcadia crawls, validates, and ingests them; the operator
manages the portfolio at executive level from Arcadia's views.

**Division of truth:** docs own *intent* — plans, decisions, goals, open
questions. Arcadia's database owns *execution state* — runs, queues, clarify
transitions. Sync is one-way (docs → Arcadia), idempotent, and never edits a
doc.

This plan is itself the first file that conforms to the protocol it defines —
the frontmatter above is a real `type: plan` record, carrying the work pointer
that `arcadia next` resolves.

## Status

**This section is derived data.** The frontmatter above is authoritative;
`arcadia portfolio` reads it after `docs sync`.

- Milestone: `docs sync` ingests a real project's markdown — **reached.**
  Arcadia's own repository is the first project ingested by this protocol.
- Current Action: none. This plan no longer declares one; Decision 0004 deferred
  its remaining narrative-summarization Action; `active_plan` now points to
  `narrative-digests`.
- Responsibility: none pending in this plan.
- Required Artifact: delivered — `docs sync`, `portfolio`, `next`, mission-Log
  ingestion, persisted `depends_on` ordering, and Arcadia's own conforming
  documents carrying a resolvable work pointer.
- Decisions open: the two plan-level questions above. 0004 is deferred with
  triggers, not open.
- Deferred until its trigger fires: `narrative-summarization` (a second foreign
  repository, or a summary someone actually wants). Dependency persistence was
  delivered independently on 2026-07-26 and retained through the branch merge.
- Last Log: 2026-07-31 — implemented mission-Log ingestion under Decision 0003;
  dependency persistence remains delivered from the parallel local history.
- Updated: 2026-07-31

## Foreign-repository validation — Private Practice Now

Decision 0002 selected `/Users/pmark/Dev/PrivatePracticeNow/platform` as the
first foreign repository. Its applicable `AGENTS.md`, `.arcadia` context policy,
`PROJECT.md`, continuation protocol, active plan, and mission Log were read
before discovery. The resolved state was milestone **Define the shared
production inquiry service boundary now that the bootstrap publishing model is
proven**, Action `define-shared-inquiry-service`, Responsibility **Agent**, and
required Artifact **a build-ready implementation plan covering durable capture,
site authorization, abuse controls, queued delivery, idempotency, monitoring,
retention, and minimum-data handling**.

The first Private Practice Now sync preview reported 15 creates, 14 intentional
skips, and zero errors. It recognized the managed Project, plan, 3 Actions, 11
Decisions, narrative docs, and mission Log. Narrative and Log ingestion are
not implemented; they were skipped with explicit reasons. The current plan
initially omitted a plan-level `milestone` and the current Action omitted an
execution profile. The minimum managed-document patch was therefore the
`arcadia.execution/v1` `systems_change` declaration on the current Action and
the plan-level milestone field. A second preview reported one milestone update
and 14 unchanged records; apply completed with zero errors. `arcadia next` then
resolved the same milestone and Action.

Incompatibilities and recommended patches:

- ~~Mission Logs and narrative documents are detected but not persisted.~~
  Mission Logs now persist (see below). Narrative documents remain detected and
  skipped; `narrative-summarization` is still the last gap before a foreign
  repository is fully represented.
- `depends_on` is validated, enforced at dispatch, and persisted in
  `work_item_dependencies`; the persistence half was delivered on the parallel
  local history before this plan became active again.
- A newly initialized workspace can have a newer DB Project row than a checked-in
  document, producing a deterministic stale-document skip. Preserve this
  refusal and expose the timestamp remedy in operator guidance.
- Newly authored foreign current Actions need the execution profile and plan
  milestone fields for complete continuation and profile resolution.
- Private Practice Now initially described its required Artifact only in
  `PROJECT.md`; `arcadia next` therefore returned `expectedArtifact: null`.
  Mirror the required Artifact onto the current managed Action so adapters can
  present a complete continuation packet without parsing narrative sections.

The validation Action is complete. The next pointer now names
`ingest-mission-logs` but remains `question_open` so Arcadia asks the operator
which of the three already-designed protocol increments to select rather than
inferring priority.

## Mission-Log ingestion

Decision 0003 selected this increment. The parser already produced a structured
entry per `## YYYY-MM-DD — title` heading and `mission_logs` already existed as a
table, so the work was the missing upsert rather than a new subsystem.

Entries are keyed `log/<slug>#<date>--<title-slug>` and carry that ref in a new
`doc_ref` column on `mission_logs`, added through the existing
`ensureDocRefColumns` migration rather than a new one.

**The key was built wrong first, and dogfooding caught it.** Keying on the date
alone looks safer — it survives a retitle, which is the thing doc_refs exist to
do — and the first implementation did that. Running it against Arcadia's own
repository refused five of nine entries: `MISSION_LOG.md` has five entries dated
2026-07-25. Several entries under one date is the common path in a real Log, not
an edge case, and the protocol had already said the whole `## YYYY-MM-DD — title`
heading was the entry key. The narrowing was the mistake, not the data.

So the rarer cost is the one paid: retitling an old entry forks a row, and
entries sharing a date do not collide. Ordinal-within-date was the third
candidate and is worse than both — entries are prepended newest-first, so a new
same-day entry would shift every ordinal below it and silently rewrite rows
nobody edited. Two entries sharing a whole heading remain a per-file validation
error, reported once per contested heading rather than once per repetition.

Two smaller decisions worth recording because both could have been fudged:

- **An entry with no `**Next:**` bullet records that it has none.** The column
  is `NOT NULL`, and deriving a plausible next action from the entry's prose
  would put a sentence nobody wrote into the operator's own history.
- **Re-ingestion rewrites only the four narrative fields and the path.**
  `project_id`, `milestone_id`, and `artifact_impact` are execution state that
  Arcadia's flows attach to a Log after the fact, and the division of truth puts
  execution state on Arcadia's side of the line. A re-sync must not erase it.

Narrative documents are still reported as skipped, which is now the only
intentional skip `docs sync` emits for a conforming repository. A full apply
against Arcadia's own repository reports 42 creates, 0 skips, and 0 errors, and
a second apply reports everything unchanged.

One unrelated defect surfaced during that run and was left alone rather than
folded into this Action: `syncProject` counts `name` as drift, but
`updateProject` has no `name` branch, so a Project whose database row disagrees
with its `PROJECT.md` name reports an `update` on every sync forever and never
converges. It needs its own Action.

## Clarification-response UX findings

Operator dogfooding found that the clarification protocol was durable but not
usable as a conversation. A direct Discord reply reached generic Ask unless it
looked like `approve`, `reject`, `defer`, an option letter, or explicit
feedback. Mission Control exposed the same clarification Decision through
approval-style buttons and had no way to provide the requested information.
AI advice could explain the Decision but could not hand an editable draft to
the response form. Even after adding an answer field, waiting synchronously for
the local clarification model left the interface appearing stuck.

The shared reply resolver now treats non-control free text as an answer only
when the exact Decision is an `ActionClarification`. Discord notifications
explicitly ask for a direct natural-language reply and acknowledge the durable
answer before re-running clarification. Mission Control presents **Your
answer**, removes the misleading approval action, refreshes the open-Decision
list immediately, and continues clarification without blocking the form. AI
advice can fill an editable draft but cannot submit it. Both surfaces report
that answering supplies information and does not approve execution.

Remaining incompatibilities and recommended patches:

- Direct Discord correlation depends on replying to the Arcadia notification
  message. Preserve this deterministic target; add a visible Decision-id
  fallback composer only if real use shows reply threading is unreliable.
- Automatic re-clarification depends on the local Intelligence service. The
  durable answer remains safe when that service is unavailable, but the
  operator must see the degraded-state message and the Action must remain ready
  to continue.
- Clarification and approval still share the generic `review_items` record.
  Keep intent-specific rendering and resolver tests whenever a new Decision
  type is added; do not infer authority from arbitrary free text.
- The current clarification model can legitimately ask a follow-up after an
  answer. Improve prompts or add structured sufficiency evidence only after
  collecting real follow-up quality data; do not hide a genuine unresolved gap.
- A context-free dogfood capture could be approved into a pending Run with no
  steps, and Arcadia has no canceled Run status or cancellation command. The
  accidental Run was rejected and marked failed with an explicit no-execution
  audit note. Add a first-class cancel transition and refuse execution approval
  when a Run has neither a Project nor executable steps.

## Project continuation UX findings — Private Practice Now

The first foreign-repository validation exposed a separate readiness gap: the
portfolio Daily Advantage query intentionally selects only `open` Actions, but
PPN's docs-authoritative current Action is already `in_progress`, clarified,
and dispatchable. The old Project view therefore showed a stale summary without
the information needed to understand why work was not starting.

The Project view now resolves `arcadia next --project` on demand and presents
the checked-in Milestone, current Action, source plan, responsibility, expected
Artifact, acceptance criteria, and resolved execution profile. A guarded
**Get to work** control prepares a planning Decision for that exact Action. It
does not queue a Run, invoke Codex, modify the foreign repository, or weaken
execution requirements. When continuation is unsafe, the panel lists every
document blocker with its file, field, message, and remedy. Operator questions
and project Decisions remain answerable inline through the existing
intent-specific Review resolver.

In the live PPN check, the guarded preparation reached execution-profile
resolution and refused deterministically: no configured planning provider met
`c3_systems/e3_deep` while honoring the Action's `local_only` locality. The UI
now preserves that exact refusal and rejected-mapping explanation, so “Ready to
prepare” cannot be mistaken for permission to weaken the profile or use
credentials that are not configured.

Recommended follow-ups:

- Keep repository document resolution authoritative; never infer a current
  Action from database recency or backlog order when the docs pointer refuses.
- Add an explicit docs-sync timestamp/result to this panel once narrative and
  mission-Log ingestion can report more than intentional skips.
- Add a first-class project-scoped Review filter if inline Decisions become too
  dense for a large project; preserve the same answer-versus-approval contract.

### What dogfooding changed

Using the protocol on Arcadia itself found three things the spec did not
anticipate:

1. **Dry run and apply could disagree.** `PROJECT.md` and a plan can name the
   same milestone. The preview reported two creates where `--apply` did one
   create and one adopt, because nothing written during a dry run is visible to
   the next lookup. Fixed by tracking milestones planned within a run, which is
   what makes "the preview is the real thing with writes withheld" true rather
   than merely intended.
2. **A malformed document disappeared silently.** A question containing an
   unquoted colon is invalid YAML, and the crawler treated the unparseable file
   as "not ours" — no error, no row, no explanation. Generated frontmatter
   breaks this way constantly. A file claiming `arcadia: v1` is now always
   treated as managed so the parse error surfaces.
3. **`project create` seeded documents the protocol rejects.** New Projects now
   get conforming frontmatter, with scalars quoted when a name contains a colon.
4. **The protocol had no way to say what to work on next.** Documents recorded
   plans and actions but nothing designated an objective, so a dispatched agent
   would have had to infer priority from commits or backlog order. Adding the
   work pointer was the first thing the continuation contract required, and
   Arcadia's own documents could not satisfy it until this change.

## Design principles

1. **Frontmatter is the database; the body is narrative.** Every
   machine-critical field lives in YAML frontmatter using Arcadia's exact
   vocabularies. Deterministic ingestion reads only frontmatter. The body is
   for humans, and for Arcadia Intelligence to summarize — never to parse.
2. **Discovery by marker, not path.** Any file whose frontmatter contains
   `arcadia: v1` is a managed doc, wherever it sits under the project's
   `repo_path`. The paths below are the human convention; the marker is the
   machine truth.
3. **Stable slugs make ingestion idempotent.** Every entity carries a
   kebab-case slug that never changes once assigned. Re-ingesting a file
   upserts by `(project, type, slug)` — it never duplicates.
4. **Refuse, don't corrupt.** A file with an enum value outside the
   vocabulary is rejected whole, with an error naming the allowed values.
   Same posture as `clarify` verdicts.
5. **Clarify at write time.** A doc may not contain a vague next action.
   Either `next_action` is verb-first and physically doable, or the item
   carries `question` + `gap_type` instead. The clarification rubric runs in
   the chatbot conversation, not after the fact.
6. **Exactly one action is current.** `PROJECT.md` names an `active_plan`; that
   plan names a `current_action`. Together they are the authoritative work
   pointer — the single documented answer to "what should be worked on now".
   Without it, a dispatched agent falls back to inferring priority from commits
   or backlog order, which is precisely what the continuation contract forbids.
7. **Last write wins by `updated`.** Every managed doc carries an `updated:`
   date. Ingestion overwrites a DB row only when the doc is newer; regressions
   are warned, not applied.

## File set and naming

```text
<repo root>/
  PROJECT.md                      # one per repo -- the Project record
  MISSION_LOG.md                  # append-only work log, newest entry first
  docs/
    plans/<slug>.md               # one initiative per file
    decisions/NNNN-<slug>.md      # one decision per file, NNNN zero-padded, global per project
    architecture.md               # narrative docs: summarized, never parsed
    <topic>.md                    # (type: architecture | strategy | reference)
```

## Vocabularies

These are Arcadia's shipped enums (`src/domain/constants.ts`). They are the
only legal values. Anything else fails ingestion.

| Field | Values |
| --- | --- |
| project `status` | `active` `paused` `incubating` `completed` |
| milestone `status` | `active` `paused` `completed` |
| action `status` | `open` `in_progress` `done` `blocked` |
| `responsibility` | `autonomous` `agent` `requires_review` `blocked` |
| `effort` | `quick` (≤15m) `short` (≤1h) `session` (1–3h) `project` (multi-session) |
| `clarification` | `unclarified` `clarified` `question_open` |
| `gap_type` | `missing-decision` `missing-external-input` `missing-definition` `missing-success-criteria` |
| `confidence` | `high` `medium` `low` |
| decision `status` | `open` `approved` `rejected` `deferred` |
| plan `status` | `draft` `active` `complete` `superseded` |
| plan `token_impact` | `none` `small` `medium` `large` `xlarge` |
| artifact `status` | `planned` `drafted` `ready` `published` |

Dates are ISO `YYYY-MM-DD`. Slugs are kebab-case, stable forever.

## Schema: PROJECT.md

```yaml
---
arcadia: v1
type: project
slug: private-practice-now
name: Private Practice Now
status: active
goal: One sentence -- why this project exists.
outcome: What finished looks like, concretely.        # optional
milestone: Marketing site v1 live                     # current milestone title
active_plan: nightly-sync-rework                      # the plan governing current work
updated: 2026-07-25
---
```

Body sections (all optional, `##` headings): **Mission**, **Current State**,
**Links**. Maps to `projects` + the current active milestone.

`active_plan` is half the work pointer. `arcadia next` refuses to resolve an
objective without it rather than picking a plan on the operator's behalf.

## Schema: docs/plans/&lt;slug&gt;.md

One initiative per file. The frontmatter `actions` list is the authoritative
work breakdown; the body narrates design and rationale but never restates
field values (restated values rot) -- exactly the discipline this file itself
follows.

```yaml
---
arcadia: v1
type: plan
slug: clarification-pass
project: arcadia                  # PROJECT.md slug
status: active                    # draft | active | complete | superseded
milestone: Clarification loop shipped
current_action: plan-gate         # exactly one action id in this plan
token_impact: medium              # relative LLM-token exposure, not exact usage
token_budget: "Model calls are bounded to implementation and review; validation is deterministic."
updated: 2026-07-25
actions:
  - id: phase-2-fields            # stable within this plan
    title: Structured clarification fields
    status: done
    responsibility: agent
    effort: session
    next_action: Merge the Phase 2 PR.
    expected_artifact: Merged PR adding the five columns
    clarification: clarified
    confidence: high
    source: docs/plans/clarification-pass.md, phase table
    acceptance_criteria:            # required on the current action
      - The five columns exist and a re-run adds no duplicates.
      - Round-trip tests cover every new field and flag.
    milestone: Clarification loop shipped   # optional; defaults to the plan's
    decisions: ["0001"]             # decisions this action requires
    references:                     # paths the action depends on
      - docs/COMMANDS.md
    depends_on: []
  - id: plan-gate
    title: Gate work plan on clarified Actions
    status: open
    responsibility: requires_review
    effort: short
    clarification: question_open
    gap_type: missing-decision
    question: Should only a clarified Action be plannable, given it changes existing planning tests?
    depends_on: [phase-2-fields]
questions:                        # plan-level questions not tied to one action
  - id: rollout-order
    question: Do we cut over per-tenant or all at once?
    gap_type: missing-decision
    decision: "0007"              # optional; the decision that answers it
decisions: ["0007"]               # decision record ids this plan references
---
```

Rules:

- Every plan declares `token_impact` and `token_budget`. The impact is relative
  LLM-token exposure (`none`, `small`, `medium`, `large`, `xlarge`), while the
  budget names which work invokes a model and how repetition is bounded.
  Deterministic builds, tests, health checks, browser navigation, and screenshot
  capture use no LLM tokens unless a model interprets their output.

- An action with `clarification: clarified` MUST have a verb-first, concrete
  `next_action`. An action with `question_open` MUST have `question` +
  `gap_type` and MUST NOT have a `next_action`. `unclarified` means "not yet
  evaluated" and carries neither.
- Exactly one `question` per item — the single highest-leverage one.
- `responsibility` routes the queue: `requires_review` → operator,
  `agent` → coding agent, `blocked` → waiting on outside.
- `current_action` must name an action id in this plan. A dangling pointer
  fails validation: leaving an agent with no objective is worse than leaving it
  with no pointer.
- **Every Plan Action** must carry a non-empty `acceptance_criteria` list,
  regardless of status, clarification or pointer. Each condition names an
  observable result and a verification method or evidence, with explicit limits
  where relevant. Parsing and settlement reject missing or malformed criteria;
  historical backfills specify evaluation conditions without claiming new proof.
- Only the plan named by `active_plan` may declare `current_action`. A second
  plan declaring one is a competing objective and is reported as a blocker.
- An action may name its own `milestone:` when a plan spans more than one
  (Decision 0005); absent that it inherits the plan's. Splitting the plan
  instead would sever `depends_on` across the boundary, because a dependency may
  only name an action in the same plan.
- A plan-level question may name the `decision:` that answers it. Ingestion then
  mirrors that decision's resolution onto the question. Without it, a question
  answered elsewhere stays open in the queue forever, since ingestion never
  deletes and a question's *absence* cannot mean "resolved" — a document may
  legitimately trail reality.
- A plan's status decides its milestone's: `complete` or `superseded` ends the
  milestone, anything else keeps it active. Nothing else can know when a
  milestone is over, because plans are what create them.

Body sections: **Executive Summary**, **Design**, **Log** (dated bullets,
newest first). Maps to a milestone plus `work_items` (with dependency links
becoming subtask/ordering structure), and `review_items` for open questions.

## Schema: docs/decisions/NNNN-&lt;slug&gt;.md

ADR-shaped. One decision per file, numbered globally per project.

```yaml
---
arcadia: v1
type: decision
id: "0007"
slug: sync-retry-strategy
project: private-practice-now
plan: nightly-sync-rework         # optional
action: retry-behavior            # optional action id within that plan
status: open                      # open | approved | rejected | deferred
question: Should the nightly sync retry on partial failure, or fail the whole run?
gap_type: missing-decision
recommendation: Per-batch retry; failing the whole run loses good batches.
confidence: medium
decided: null                     # YYYY-MM-DD once resolved
answer: null                      # the operator's answer, verbatim
updated: 2026-07-25
---
```

Body sections: **Context**, **Options** (each with the 2–4 criteria that
matter), **Consequences**. Maps to `review_items` with
`resolved_intent: ActionClarification` when tied to an action.

## Schema: MISSION_LOG.md

Frontmatter: `arcadia: v1`, `type: log`, `project`, `updated`. Body is
append-only entries, newest first:

```markdown
## 2026-07-25 — Shipped the clarify orchestrator

- **Did:** Implemented arcadia clarify over Arcadia Intelligence; PR #8.
- **Result:** Full capture → clarify → decide loop works end to end.
- **Next:** Merge PRs #6–#8 in order, then run the loop on real work.
- **Blockers:** none
```

Maps to `mission_logs` (`work_performed`, `result`, `next_action`,
`blockers`). The whole `## YYYY-MM-DD — title` heading is the entry key —
`log/<slug>#<date>--<title-slug>` — so several entries may share a date. Two
entries sharing a whole heading are refused, because the key cannot tell them
apart.

## Narrative docs

`type: architecture | strategy | reference`, plus `project`, `slug`,
`updated`. No further schema. Arcadia ingests these for Intelligence-generated
summaries only; nothing in the body is parsed deterministically.

## Ingestion contract (Arcadia side, to be built)

- `arcadia docs sync [--project <id>] [--apply]` — crawls each project's
  `repo_path` for `arcadia: v1` files. **Dry-run by default**, same as
  `clarify`: print every create/update/skip, write nothing without `--apply`.
- Upsert by `(project, type, slug|id)`. Never delete: an entity absent from
  docs is left alone in the DB (docs may legitimately trail reality).
- Apply a doc only when its `updated` is newer than the DB row's; warn on
  regressions.
- Reject any file with an out-of-vocabulary enum or a `clarified` action
  lacking a `next_action`; report per-file, continue the crawl.
- Narrative docs queue an Intelligence summarization job (`local-preferred`,
  unpaid) whose output is stored as an Artifact, never written into the doc.

## The Documentarian Prompt

Paste everything between the rules into a frontier-model chatbot session
(as a system prompt, project instruction, or first message). It is
self-contained.

---

You are the documentarian for a portfolio of software projects managed by a
system called Arcadia. At the end of a working conversation — or when asked —
you produce Markdown documentation files that Arcadia ingests as structured
data. Follow these rules exactly.

**Output format.** Emit complete files, never fragments or diffs. Precede
each file with its repo-relative path on its own line. End with a one-line
manifest listing every file you produced. Prefer updating an existing file
(same path, same slugs, bump `updated:`) over creating a new one; if existing
files were shown to you, reuse their slugs and ids exactly.

**File types and paths.**
- `PROJECT.md` (repo root): the project record. One per repo.
- `docs/plans/<slug>.md`: one initiative per file. The work breakdown lives
  in frontmatter under `actions:`.
- `docs/decisions/NNNN-<slug>.md`: one decision per file, `NNNN` zero-padded
  and sequential within the project.
- `MISSION_LOG.md` (repo root): append-only log, newest entry first, entries
  headed `## YYYY-MM-DD — title` with **Did / Result / Next / Blockers**
  bullets.
- Other docs (`docs/architecture.md` etc.): narrative, no structured schema.

**Frontmatter.** Every file begins with YAML frontmatter containing
`arcadia: v1`, a `type` (`project` | `plan` | `decision` | `log` |
`architecture` | `strategy` | `reference`), a stable kebab-case `slug`, the
`project` slug (except in PROJECT.md itself), and `updated: YYYY-MM-DD`.
Frontmatter is the authoritative data; never restate its values in the body.

**Quote any scalar containing a colon, `#`, or a leading `-`.** An unquoted
value like `question: Should we do X: the fast way?` is invalid YAML and makes
the whole document unusable. This is the single most common way generated
frontmatter breaks.

**The work pointer.** `PROJECT.md` sets `active_plan` to the slug of the plan
governing current work. That plan sets `current_action` to exactly one of its
own action ids. Across the entire project, only that one plan may declare a
`current_action` — never designate a second. If you cannot tell which action
should be current, do not guess: write the candidates into a decision file with
`status: open` and leave `current_action` pointing at the action that is
blocked on it.

**Acceptance criteria.** Every Plan Action must carry `acceptance_criteria`,
a non-empty list of precise, checkable conditions, including completed and
question-open Actions. State the observable result, verification method or
evidence, and thresholds with units where relevant. "Works correctly" is not a
criterion; "running the migration twice leaves exactly one column named x" is.
Unresolved requirements stay explicit questions, not invented answers. An Action may
also list `decisions: ["0007"]` for decisions that must be answered before it
starts, and `references:` for paths a worker needs to read.

**Vocabularies — use these exact values and no others:**
- project status: `active` `paused` `incubating` `completed`
- plan status: `draft` `active` `complete` `superseded`
- action status: `open` `in_progress` `done` `blocked`
- responsibility: `autonomous` `agent` `requires_review` `blocked`
  (`agent` = a coding agent can do it; `requires_review` = the operator must
  act or decide; `blocked` = waiting on an outside party)
- effort: `quick` (≤15 min) `short` (≤1 h) `session` (1–3 h) `project`
  (multi-session) — set it only when the conversation actually implied a
  size; otherwise omit it. Never guess.
- plan token_impact: `none` `small` `medium` `large` `xlarge` — relative LLM
  exposure, paired with a required plain-language `token_budget`; never turn
  this T-shirt signal into a fabricated exact token or dollar forecast.
- clarification: `unclarified` `clarified` `question_open`
- gap_type: `missing-decision` `missing-external-input` `missing-definition`
  `missing-success-criteria`
- confidence: `high` `medium` `low`
- decision status: `open` `approved` `rejected` `deferred`

**The clarification rule — the most important rule.** For every action in a
plan, apply this test: *can you name one concrete, physical next action —
something the operator or a coding agent could start in their next work
session?*
- If YES: set `clarification: clarified`, write `next_action` as one
  sentence starting with a verb, set `responsibility`, `confidence`, and
  `source` (which part of the conversation or which document justified it).
- If NO: set `clarification: question_open`, classify the gap as exactly one
  `gap_type`, and write exactly ONE `question` — the single highest-leverage
  question whose answer unblocks the item. Not a list. Do NOT write a
  `next_action`; do not write a vague placeholder like "figure out X".
- For `missing-decision`, put the 2–4 criteria that matter in the decision
  record's Options section. For `missing-external-input`, include a draft of
  the ask. For `missing-definition`, propose 2–5 subtasks in the body as a
  *proposal* — clearly labeled as not yet approved. For
  `missing-success-criteria`, phrase the question as "what does finished look
  like?", specialized to the item.

**Decisions.** When the conversation surfaced a choice that was actually
made, record it as a decision file with `status: approved`, the `answer`,
and `decided` date. When a choice was identified but not made, record it
with `status: open`. Every open decision must appear in exactly one file.
An `approved` decision must record an `answer`; one that does not is rejected,
because it reads as resolved in every rollup while recording nothing anyone can
act on.

**Style.**
- Dates ISO (`YYYY-MM-DD`). Slugs kebab-case, stable — never rename one.
- Refer to the human as "the operator"; never use a personal name.
- Keep narrative bodies under ~150 lines; link rather than duplicate.
- Never invent status, effort, confidence, or dates the conversation did not
  support. When something material is genuinely unknown, ask one question
  before generating, or mark it `question_open` — do not fill the gap with a
  plausible guess.

---

## Open questions

See the `questions` list in this file's own frontmatter for the two open
protocol-level decisions (plan/milestone span, whether `docs sync` may ever
write back). A third, lower-stakes one, not worth a frontmatter entry:

- Decision numbering across multiple chatbot sessions can collide. The
  documentarian reuses existing numbers when shown them; ingestion treats the
  slug as the key and the number as display. Good enough until it isn't.
```

### precise-criteria-split-probe-budget-20261012-r4

Proposal: `agentask_f3a00af863a2ef0c1a`
Unapplied settlement preview: `asksettle_33d81ddf38154050a1`
Preview fingerprint: `e485e2703d544f621d46e029a296a5dc16f720d01f37d3a840c35cdb99e65fc5`
Target: `docs/plans/every-production-session-is-bounded-by-a-platform-token-ceiling-and-an-in.md`
Current source SHA256: `93b1b925c00bcd3032b523fe126f9061de8f5aede7e30d7c5cf3387acd9ae1fe`

```yaml
---
arcadia: v1
type: plan
slug: every-production-session-is-bounded-by-a-platform-token-ceiling-and-an-in
project: arcadia
status: active
milestone: Every production Session is bounded by a platform token ceiling and an in-Session environment probe, and every stop it raises clears from /todo in at most two clicks, proven by replays of recorded sessions and one validated ledger row per session.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-12
actions:
  - id: replay-environment-wall-session
    title: "Implement a fast-rehearsal scenario built from the 2026-10-12 00:40Z Session receipts (no diff, workspace write denied, sandbox test refusals) that must end refused or stopped before a fixed token bound, and make a missing report.json fail loudly."
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-replay-environment-wall-session-2026-10-12; no further action.
    expected_artifact: Evidence satisfying Agent Ask replay-environment-wall-session
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Recorded failures are free failing tests; the first run cost 11.1M tokens and a missing report.json silently wasted ten minutes (living notes frictions 11, 17)."
    acceptance_criteria:
      - The scenario exists in the fast-rehearsal set, is deterministic and runs in under 30 seconds, and on a tree without the environment-wall stop it fails.
      - scripts/fast-rehearsal.mjs prints the report path and exits non-zero when report.json is missing or unparsable.
      - The scenario asserts exactly one named environment blocker, no second launch and a recorded per-attempt token record.
      - Focused tests for the scenario builder pass and pnpm fast-rehearsal passes.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: record-session-ledger
    title: Implement docs/reports/session-ledger.jsonl with a typed schema, a deterministic validator wired into CI, and backfilled rows for A12, A3, A5 and A6 so every session records cost, review findings, touches and frictions in one compact row.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-record-session-ledger-2026-10-12; no further action.
    expected_artifact: Evidence satisfying Agent Ask record-session-ledger
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Spend and defect data today is estimated prose; one validated row per session makes the next hardening choice evidence-based and cheap to read."
    acceptance_criteria:
      - The schema requires session_id, role, model, effort, action_id, pr, tokens_in_uncached, tokens_in_cached, tokens_out, wall_min, attempts, review_rounds, blocking_findings, operator_touches, host_touches, frictions and outcome with a stop_reason.
      - The validator rejects a row with a missing or mistyped field and the CI job runs it on every pull request that touches the ledger.
      - The ledger has four backfilled rows for A12, A3, A5 and A6 taken from the living notes, and the living notes link to the ledger.
      - Focused validator tests pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: enforce-session-token-ceiling
    title: Implement a per-Session input-token ceiling in the production policy that ends the attempt and writes a budget_exhausted stop receipt with cached and uncached tokens recorded separately.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-enforce-session-token-ceiling-2026-10-12; no further action.
    expected_artifact: Evidence satisfying Agent Ask enforce-session-token-ceiling
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Platform caps, not prompt discipline, must bound spend for every failure mode including ones nobody has seen; the capacity gate is off and a heavy-tier Action ran unmetered."
    acceptance_criteria:
      - The replay scenario stops at the ceiling and the stop receipt names budget_exhausted with the ceiling value and both token counts.
      - An attempt that hits the ceiling is not relaunched automatically and raises exactly one named blocker.
      - The ceiling has a per-tier default and cannot be disabled or raised from a prompt, brief or Action text.
      - Focused tests for the ceiling and the production tick pass and pnpm fast-rehearsal passes.
    depends_on: [replay-environment-wall-session]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: probe-environment-inside-session
    title: Implement a deterministic probe script that runs as the Session first step and ends the attempt with environment_wall when the Session sandbox cannot write the workspace database, run host validation or produce a preservation receipt.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask split-probe-environment-inside-session-2026-10-12; no further action.
    expected_artifact: Evidence satisfying Agent Ask probe-environment-inside-session
    clarification: clarified
    confidence: high
    source: Agent Ask precise-criteria-split-probe-budget-20261012-r4
    why: "Session sandbox writable roots cannot be read offline, so only a probe inside the Session is truthful; the ceiling keeps it cheap."
    acceptance_criteria:
      - The host-worker side probe is no longer counted as evidence of Session capability.
      - A passing probe records its configured numeric input-token budget and cached and uncached usage whose sum is no greater than that budget; the session-probe-wall fixture records 1,800 input tokens within a 5,000 token budget, and a failing probe raises exactly one environment_wall blocker naming its remedy.
      - Focused tests and pnpm fast-rehearsal pass.
    depends_on: [enforce-session-token-ceiling]
    split_into: [attach-the-session-probe-result-to-the-reconcile-receipt]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: one-click-clear-every-blocker-kind
    title: Implement a blocker-kind remedy registry and /todo controls so every platform-raised stop clears in at most two clicks with no typing.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement a blocker-kind remedy registry and /todo controls so every platform-raised stop clears in at most two clicks with no typing.
    expected_artifact: Evidence satisfying Agent Ask one-click-clear-every-blocker-kind
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Every new blocker kind was born without a remote clear (frictions 12, 14); a build-failing enumeration prevents the pattern."
    acceptance_criteria:
      - An enumeration test fails when any emitted blocker kind has no registered remedy; environment_wall, budget_exhausted, scope_successor_held and scope_pointer_mismatch are registered.
      - Each registered clear is a button on /todo or /actions that resolves in at most two interactions and runs through the existing operator-script machinery without copy or paste.
      - reset-repair-budget is reachable from /todo for an environment_wall and budget_exhausted stop.
      - Focused todo and dashboard tests pass and the dashboard graph has no containerAuditTransport import.
    depends_on: [enforce-session-token-ceiling, probe-environment-inside-session, attach-the-session-probe-result-to-the-reconcile-receipt]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: fix-docs-sync-lock-and-activation-order
    title: Implement activation so the activated Plan Actions are positioned inside the apply transaction and docs sync retries a transient database lock.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask split-fix-docs-sync-lock-and-activation-order-2026-10-12; no further action.
    expected_artifact: Evidence satisfying Agent Ask fix-docs-sync-lock-and-activation-order
    clarification: clarified
    confidence: high
    source: Agent Ask split-fix-docs-sync-lock-and-activation-order-2026-10-12
    why: "Activation left four unpositioned Actions and a stale pointer that needed a manual arrange and an extra pull request (frictions 3, 14)."
    acceptance_criteria:
      - Other Projects relative queue order is unchanged by an activation.
      - Focused settlement and queue tests pass.
    depends_on: []
    split_into: [stage-pointer-with-queue-reorder-and-reproduce-live-lock]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: revise-agent-roles-and-session-briefs
    title: Record the revised agent roles and a compact session brief template in the governed guidance so Lead sessions start from a generated brief and every role leaves one ledger row.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-revise-agent-roles-and-session-briefs-2026-10-12; no further action.
    expected_artifact: Evidence satisfying Agent Ask revise-agent-roles-and-session-briefs
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Reviewers produced the best defect yield and Lead sessions grew large; roles and briefs should be recorded where agents retrieve them."
    acceptance_criteria:
      - docs/agent-guidance records Lead as one Action per session, Driver on standard tier returning only diff, test command and exit code, Reviewer as one fresh role replacing Critic, a deterministic Replayer script role, and the live Observer deferred with its revisit trigger.
      - "A brief template names file:line ranges, focused test files, the adversarial strings for any guard or validator Action, and forbids repeating sandbox text in hand-backs."
      - The model and effort per role are stated with the cost reasoning and the guidance index routes to the new section.
      - The documentation budget check and docs link check pass.
    depends_on: [record-session-ledger]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: attach-the-session-probe-result-to-the-reconcile-receipt
    title: Attach the Session probe JSON and its budget to the reconcile receipt as a field, for both failing and passing probes, and verify the checks against a real provider sandbox.
    status: open
    responsibility: agent
    effort: session
    next_action: Attach the Session probe JSON and its budget to the reconcile receipt as a field, for both failing and passing probes, and verify the checks against a real provider sandbox.
    expected_artifact: Evidence satisfying Agent Ask attach-the-session-probe-result-to-the-reconcile-receipt
    clarification: clarified
    confidence: high
    source: Agent Ask precise-criteria-split-probe-budget-20261012-r4
    acceptance_criteria:
      - Running tests/fast-rehearsal/session-probe-wall.test.ts with its 5,000 input-token fixture budget (cached plus uncached) refuses the fake provider's read-only workspace database with environment_wall and attaches the probe JSON to the reconcile receipt.
    depends_on: []
    decisions: []
    references: ["docs/reports/production-simulation-living-notes.md", "https://github.com/pmark/arcadia/issues/1284"]
  - id: stage-pointer-with-queue-reorder-and-reproduce-live-lock
    title: Stage the matching current_action change in the same governed settlement as a queue reorder and reproduce the live post-activation database lock in a test.
    status: open
    responsibility: agent
    effort: session
    next_action: Stage the matching current_action change in the same governed settlement as a queue reorder and reproduce the live post-activation database lock in a test.
    expected_artifact: Evidence satisfying Agent Ask stage-pointer-with-queue-reorder-and-reproduce-live-lock
    clarification: clarified
    confidence: high
    source: Agent Ask split-fix-docs-sync-lock-and-activation-order-2026-10-12
    acceptance_criteria:
      - A test reproduces the post-activation SQLite lock and afterwards advance queue reports orderValid true with unpositionedCount 0.
      - A queue reorder stages the matching pointer change in the same settlement so current_action does not stay on a moved Action.
    depends_on: []
    decisions: []
    references: ["docs/reports/production-simulation-living-notes.md", "https://github.com/pmark/arcadia/issues/1284"]
questions: []
decisions: []
current_action: attach-the-session-probe-result-to-the-reconcile-receipt
recommended_model: gpt-5.6-terra
recommended_reasoning_effort: medium
---

# Every production Session is bounded by a platform token ceiling and an in-Session environment probe, and every stop it raises clears from /todo in at most two clicks, proven by replays of recorded sessions and one validated ledger row per session.

Created as an inactive draft from accepted Agent Ask plan-autonomous-production-hardening-2026-10-12; creation changed no pointer. Current activation is recorded in frontmatter.
```
