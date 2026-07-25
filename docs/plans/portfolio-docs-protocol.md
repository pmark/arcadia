---
arcadia: v1
type: plan
slug: portfolio-docs-protocol
project: arcadia
status: active
milestone: docs sync ingests a real project's markdown
updated: 2026-07-25
actions:
  - id: build-parser
    title: Build the frontmatter parser and vocabulary validator
    status: done
    responsibility: codex
    effort: session
    next_action: Delivered in src/docs/parse.ts; no further work.
    expected_artifact: Frontmatter parser reporting per-field validation errors
    clarification: clarified
    confidence: high
    source: dogfooding pass against Arcadia's own repository
    depends_on: []
  - id: build-upsert
    title: Build the upsert layer (project/plan/decision -> DB rows)
    status: done
    responsibility: codex
    effort: session
    next_action: Delivered in src/docs/sync.ts, keyed by doc_ref; no further work.
    expected_artifact: Idempotent doc_ref-keyed upsert
    clarification: clarified
    confidence: high
    source: dogfooding pass against Arcadia's own repository
    depends_on: [build-parser]
  - id: wire-docs-sync-command
    title: Wire arcadia docs sync [--project] [--apply] into the CLI
    status: done
    responsibility: codex
    effort: short
    next_action: Delivered alongside arcadia portfolio; no further work.
    expected_artifact: docs sync and portfolio commands
    clarification: clarified
    confidence: high
    source: dogfooding pass against Arcadia's own repository
    depends_on: [build-upsert]
  - id: ingest-mission-logs
    title: Ingest MISSION_LOG.md entries as mission_logs rows
    status: open
    responsibility: codex
    effort: short
    clarification: unclarified
    depends_on: [build-upsert]
  - id: persist-dependencies
    title: Persist action depends_on ordering rather than only validating it
    status: open
    responsibility: codex
    effort: short
    clarification: unclarified
    depends_on: [build-upsert]
  - id: narrative-summarization
    title: Queue an Intelligence summarization job for narrative docs
    status: open
    responsibility: codex
    effort: short
    clarification: unclarified
    depends_on: [wire-docs-sync-command]
questions:
  - id: plan-milestone-span
    question: If one plan's work spans multiple milestones, should the protocol split the plan, or allow a plan to reference more than one milestone?
    gap_type: missing-decision
  - id: docs-sync-write-back
    question: Should docs sync ever write back to a repo (e.g. append Arcadia run results to MISSION_LOG.md), or must it stay strictly one-way?
    gap_type: missing-decision
decisions: []
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
the frontmatter above is a real `type: plan` record, and its four actions are
what remains to make `arcadia docs sync` real. Everything else in this
document is the schema, not yet implemented.

## Status

**This section is derived data.** The frontmatter above is authoritative;
`arcadia portfolio` reads it after `docs sync`.

- Milestone: `docs sync` ingests a real project's markdown — **reached.**
  Arcadia's own repository is the first project ingested by this protocol.
- Next Action: run `docs sync --apply` against a second, non-Arcadia project,
  to test the schema against documentation nobody wrote with it in mind.
- Responsibility: Requires Review (choosing that project is an operator call).
- Required Artifact: delivered — `docs sync`, `portfolio`, and Arcadia's own
  conforming documents.
- Decisions open: 2 — see `questions` in the frontmatter above.
- Last Log: 2026-07-25 — built the parser, validator, crawler, `doc_ref`-keyed
  upsert, `docs sync`, and `arcadia portfolio`; converted Arcadia's own
  `PROJECT.md`, `MISSION_LOG.md`, and both plans into managed documents; made
  `project create` seed conforming stubs.
- Updated: 2026-07-25

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
6. **Last write wins by `updated`.** Every managed doc carries an `updated:`
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
| `responsibility` | `autonomous` `codex` `requires_review` `blocked` |
| `effort` | `quick` (≤15m) `short` (≤1h) `session` (1–3h) `project` (multi-session) |
| `clarification` | `unclarified` `clarified` `question_open` |
| `gap_type` | `missing-decision` `missing-external-input` `missing-definition` `missing-success-criteria` |
| `confidence` | `high` `medium` `low` |
| decision `status` | `open` `approved` `rejected` `deferred` |
| plan `status` | `draft` `active` `complete` `superseded` |
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
updated: 2026-07-25
---
```

Body sections (all optional, `##` headings): **Mission**, **Current State**,
**Links**. Maps to `projects` + the current active milestone.

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
updated: 2026-07-25
actions:
  - id: phase-2-fields            # stable within this plan
    title: Structured clarification fields
    status: done
    responsibility: codex
    effort: session
    next_action: Merge the Phase 2 PR.
    expected_artifact: Merged PR adding the five columns
    clarification: clarified
    confidence: high
    source: docs/plans/clarification-pass.md, phase table
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
decisions: ["0007"]               # decision record ids this plan references
---
```

Rules:

- An action with `clarification: clarified` MUST have a verb-first, concrete
  `next_action`. An action with `question_open` MUST have `question` +
  `gap_type` and MUST NOT have a `next_action`. `unclarified` means "not yet
  evaluated" and carries neither.
- Exactly one `question` per item — the single highest-leverage one.
- `responsibility` routes the queue: `requires_review` → operator,
  `codex` → coding agent, `blocked` → waiting on outside.

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
`blockers`). The `## YYYY-MM-DD — title` heading is the entry key.

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

**Vocabularies — use these exact values and no others:**
- project status: `active` `paused` `incubating` `completed`
- plan status: `draft` `active` `complete` `superseded`
- action status: `open` `in_progress` `done` `blocked`
- responsibility: `autonomous` `codex` `requires_review` `blocked`
  (`codex` = a coding agent can do it; `requires_review` = the operator must
  act or decide; `blocked` = waiting on an outside party)
- effort: `quick` (≤15 min) `short` (≤1 h) `session` (1–3 h) `project`
  (multi-session) — set it only when the conversation actually implied a
  size; otherwise omit it. Never guess.
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
