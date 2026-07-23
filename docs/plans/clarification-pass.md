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
`confidence`, `effort`. Thread them through `updateWorkItem`, the
`WorkItemSummary` type, and `renderWorkItem`. New `work update` flags:
`--gap-type`, `--question`, `--confidence`, `--source`, `--effort`. `capture`
writes `clarification_status = 'unclarified'`. This retires the
`[GAP …]`-string-mangling of `next_action` the dogfood had to use.

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
- Does `effort` belong on every Action or only on clarified ones? Proposed:
  every Action, nullable.
- Should a resolved clarification Decision automatically re-run `clarify` on
  its Action, or wait for an explicit `clarify` call? Proposed: explicit, to
  keep the loop observable.
