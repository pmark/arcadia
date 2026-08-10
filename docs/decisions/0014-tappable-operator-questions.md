---
arcadia: v1
type: decision
id: "0014"
slug: tappable-operator-questions
project: arcadia
status: open
question: Operator questions asked inside a coding-agent session disappear when the session ends or the prompt is dismissed. Should Arcadia model a question with selectable answers and their consequences as durable governed data, and if so, should it learn about questions by watching sessions or by reading documents?
gap_type: missing-decision
recommendation: Extend the `questions:` schema that plan documents already parse with an `options:` list carrying a `label` and a `consequence` per option, and render it wherever the operator already is. Do not monitor sessions or detect formatted text in agent output — that reproduces the ephemerality it is meant to fix, contradicts Decision 0012's boundary, and reintroduces the weak intent extraction documents exist to avoid. The coding-agent harness handles the live prompt; Arcadia handles the durable one.
confidence: high
updated: 2026-08-09
---

# Decision 0014: Tappable operator questions

## Context

On 2026-08-09 the operator was asked four questions through the coding agent's
interactive prompt, liked the interaction, and reported the defect that
matters: **"they go away if I don't answer them immediately."** The operator
then proposed that Arcadia monitor sessions and detect a specially formatted
block of questions and multiple-choice answers in agent output.

The goal is right. The mechanism is the expensive path, and it does not fix
the stated problem.

### The problem is durability, not rendering

A question detected in live session output is exactly as ephemeral as the
prompt that produced it. When the session ends, the scrollback is gone and the
question with it. Watching harder does not make a question survive; **writing
it down does.** The operator's complaint is a storage complaint wearing a
rendering complaint's clothes.

### Three quarters of this already exists

Plan documents already carry questions as first-class, parsed, validated data:

```yaml
questions:
  - id: open-question
    question: Something the plan cannot answer itself.
    gap_type: missing-decision
```

`src/docs/parse.ts:491-513` parses this into `PlanQuestionDoc`
(`id`, `question`, `gapType`, `decision`), and `resolveActionReadiness` already
treats an Action with `clarification: question_open` as undispatchable until
the question is answered. Arcadia already stops work on an unanswered question.

What is missing is not the question. It is **the answers, and what each one
costs.** Today a question is free text with no enumerated options, so there is
nothing to tap and no way to record which option was chosen.

`arcadia ask` and `arcadia feedback record` already capture an operator
decision plus a note, and `docket` already renders governed state read-only.
This is the same finding as Decisions 0011 and 0013: **one missing field and
one render layer, not a new subsystem.**

### Why not watch sessions

Four independent reasons, any one of which would be sufficient:

1. **It does not solve the problem.** A detected question is still gone when
   the session ends. See above.
2. **It contradicts Decision 0012.** That Decision's boundary is explicit —
   *"Arcadia records the before and the after and never observes the during."*
   Session monitoring is the during. Building it would undercut a primitive
   the operator is about to ratify.
3. **It is the weak extraction the operator already rejected.** The operator's
   stated reason for not routing self-improvement requests through the ask
   facility was that *"intent extraction is deterministic but weak."* Scraping
   a format out of prose reintroduces exactly that failure mode, one layer
   down.
4. **The harness already does it better.** Claude Code's interactive prompt is
   a good live experience and costs Arcadia nothing to maintain. Duplicating
   it produces a worse copy of a solved problem.

**The split that follows: the harness owns the live prompt, Arcadia owns the
durable one.** They are different jobs and only the second one is unbuilt.

## Decision (proposed)

### 1. Extend the existing question schema

```yaml
questions:
  - id: reconcile-session-primitive
    question: Do Decisions 0011 and 0012 merge, or does one supersede?
    gap_type: missing-decision
    options:
      - label: 0012 supersedes 0011
        consequence: One clean primitive; 0011's four answered operator
          questions are lost unless carried over explicitly.
      - label: Merge into one Decision
        consequence: Nothing lost, queue design stays attached to the
          primitive; costs an editing pass and re-ratification.
    answer: null          # the chosen option's label, once given
    answered_at: null
```

`options` is optional — a question without it behaves exactly as today, so
this is additive and no existing document breaks. `consequence` is **required
on every option**, because an option without a stated cost is not a choice, it
is a guess. This is the field that makes the interaction worth having.

### 2. Deterministic parse, no model

`options`, `answer`, and `answered_at` are frontmatter fields validated in
`parse.ts` beside the existing `questions` fields. Reading and answering a
question involves no model call at any point. `token_impact: none`.

### 3. Render where the operator already is

The same parsed structure renders in `docket`/`briefing` output, in the
dashboard, and — once the Discord bot's message plumbing from PR #43 exists —
as a Discord message whose reply records the answer. One source of truth, many
surfaces, no surface holding state of its own.

### 4. Answering is recording, not acting

Writing `answer` sets the question's state and unblocks whatever
`clarification: question_open` was gating. It does not itself dispatch, merge,
or execute. The next action stays with the operator or a separately authorized
dispatch step, consistent with Decisions 0013 and the QA sign-off boundary.

### 5. An answered question stays answered

`answer` and `answered_at` persist in the document and travel with it through
Git. A question answered on a phone in the morning is still answered when a
coding agent reads the plan that afternoon. **This is the entire point.**

## What this explicitly does not do

- **No session monitoring, output scraping, or format detection.**
- **No replacement for the harness's live prompt.** That interaction is good
  and stays where it is.
- **No new storage.** Questions live in the plan documents that already hold
  them.
- **No auto-answering, and no inferring an answer from operator prose.**

## Worked example: the four questions open right now

These are real and currently unrecorded, which is the defect this Decision
describes. Recording them here is the proposal demonstrating itself.

1. **`reconcile-session-primitive`** — Do Decisions 0011 and 0012 merge, does
   0012 supersede 0011, or does 0012 define the primitive with 0011 rewritten
   as its first consumer?
2. **`pr-body-completeness`** — Is the undisclosed-changed-path check a
   briefing report, an overridable pre-merge warning, or a hard rule in
   `AGENTS.md` binding every coding agent?
3. **`briefing-delivery`** — On demand in the terminal, on demand plus a
   Discord push, or scheduled alongside the digests from PR #43?
4. **`question-ux-mechanism`** — This Decision. Documents, session detection,
   or both.

## Open questions for the operator

1. **Single-select only, or also multi-select?** Multi-select is a small
   schema change (`answer` becomes a list) and a meaningfully larger rendering
   and validation surface across three display targets.
2. **May a coding agent add options to a question the operator already
   answered?** Operator response, 2026-08-09: *"I'm really not sure. I want
   what is most reliable and follows the principle of least surprise."*

   **Recommendation: no — an agent files a new question referencing the
   answered one.** Least surprise has one firm reading here: *an agent must
   never mutate an answer the operator recorded.* That rules out reopening in
   place, which would let settled work re-block dispatch without the operator
   acting — a question they closed silently gating work again is precisely a
   surprise.

   Between the two remaining options, refusing outright is safe but loses
   information; a new question referencing the old one is safe **and** keeps
   it. The deciding argument is consistency with patterns this portfolio
   already runs: Decisions are superseded rather than edited (PPN's ADR 0022
   amends 0020), PPN's editor-experience plan is explicitly append-only with a
   moving pointer, and PR #44's QA verdicts bind to a revision instead of
   being overwritten. **Append-only with supersession is already the house
   pattern, and matching an existing pattern is what least surprise means.**

   The cost is question sprawl — several near-duplicate questions accumulating
   on one topic. That is visible and auditable, which is the right failure
   mode compared to a silently altered answer.
3. **Does an answered question become a Decision record automatically?** PR
   #44 does exactly this for QA sign-offs, so there is precedent — but it
   would turn every routine option-pick into a governed Decision document.

## Consequences if approved

- Questions survive session end, dismissal, and machine restart, which is the
  defect that prompted this.
- The operator can answer from a phone, and the answer is authoritative for
  every later session in every surface.
- Every option carries its cost, so choosing is informed rather than a guess —
  the actual value of the interaction, independent of how it is rendered.
- Arcadia gains no new subsystem, no session observation, and no dependence on
  extracting intent from prose.

## Revisit triggers

- Operators routinely answer outside the enumerated options, meaning the
  options are the wrong shape and free text is doing the real work.
- The live-prompt and durable-question paths are consistently used together
  and drift, suggesting the harness should write its live questions into the
  document rather than the two staying independent.
