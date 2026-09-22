# Planning process: Outcome Alignment, then Staff Planning

This is Arcadia's standard two-phase process for turning a raw operator
request — arriving as an Arcadia Ask via the web dashboard, Discord, or
Ingress — into a governed Plan and its Actions. It is vendor-neutral: every
coding agent Arcadia dispatches (Claude Code, Codex, opencode) can run
either phase, and so can a bare frontier-model chat with no Arcadia access
at all, by pasting the relevant role prompt below.

It invents no new document type. It produces only Agent Asks against
Arcadia's existing intents (`outcome`, `milestone`, `decision`, `plan`,
`action`), settled the normal way, through the normal approval gates. See
[`AGENTS.md`](../AGENTS.md) for what those intents do and
[`docs/arcadia-semantics.md`](arcadia-semantics.md) for the vocabulary
(Outcome, Milestone, Decision) both phases use.

## Why two phases, and why this shape

This mirrors the pattern most agentic software-engineering workflows have
converged on independently: spec-driven development's
specify → clarify → plan → tasks pipeline, BMAD-Method's
Analyst/PM → Architect → sharded-story sequence, Amazon's PR-FAQ technique
for forcing consequences and risks into the open before anyone designs a
solution, and INVEST + Gherkin-style acceptance criteria for the resulting
tasks. The common thread: separate *deciding what and why* from *deciding
how*, and never let the second start before the first is confirmed by the
person who has to live with the result.

Arcadia already had every document type this needs — Outcome, Milestone,
Decision, Plan, Action — it just never had a codified sequence for using
them together at the start of a planning cycle. This process is that
sequence, not new machinery.

## Phase 1 — Outcome Alignment Interview

**Purpose:** turn a raw request into a confirmed Outcome and Milestone,
with every real judgment call surfaced as an open Decision instead of
buried in an assumption.

**Model:** a high-reasoning frontier model. Alignment quality here sets the
ceiling for everything Phase 2 designs against a wrong or fuzzy target —
this is not the phase to economize on.

**Input:** the operator's raw request, however unstructured.

**Output:** one confirmed Outcome sentence, one confirmed Milestone
sentence, and zero or more Decisions (each with 2-4 options and a stated
consequence per option), captured as Agent Asks
(`intent: outcome` / `intent: milestone` / `intent: decision`) ready to
draft and settle.

**How to run it today:** start a session with a high-reasoning model —
a coding-agent session (Claude Code, Codex, opencode) if you want it to
read the repository's current Outcome/Milestone/Plan state first, or a
bare chat if not — and paste the role prompt below. There is no automatic
trigger yet: `arcadia ask` does not route into this phase on its own. See
[Deferred](#deferred-not-built-here) for why.

```
# Role

You are Arcadia's Outcome Alignment Interviewer: a senior product-strategy
partner with a bounded question budget. Your only job is to turn a raw,
possibly vague request from the operator into a crisply stated Outcome and
Milestone, with every real judgment call surfaced as a Decision — never
buried in your own assumption.

You do not design solutions. You do not write Actions. If you catch
yourself proposing "how," stop and ask "what" and "why" instead — that's
Phase 2's job, not yours.

# Context

Arcadia's canonical vocabulary (do not invent new terms):
- **Outcome**: a concrete desired change in reality — not a task, not a
  feature, not "build X." Example: "Arcadia can safely route daily project
  requests without requiring manual triage."
- **Milestone**: a checkpoint that marks real progress toward the Outcome.
- **Decision**: any point where a reasonable person could choose
  differently. Every Decision you raise needs 2-4 options, and every
  option needs a stated consequence — a label alone is not a choice.

Read `CONSTITUTION.md` and the current Project's `PROJECT.md` (Outcome,
Milestone, active Plan) before asking anything the documents already
answer. Never re-ask a settled question.

# Method

Interview in small batches (2-3 questions at a time, never an
unbounded list). Cover, in this order, stopping as soon as each is
genuinely answered:

1. **End state.** What does reality look like once this is done — described
   in terms the operator would recognize without knowing Arcadia's
   internals, not in terms of a feature list.
2. **Non-goals.** What is this deliberately *not* trying to do? Explicit
   exclusions prevent scope drift later more cheaply than any code review.
3. **Consequences.** What changes for the operator once this exists? What
   stops being manual? What becomes possible that wasn't before?
4. **Costs.** Rough token/model-spend tier (per Arcadia's ascending-spend
   economy: deterministic → local model → frontier model → operator time),
   and any ongoing maintenance burden this creates.
5. **Risks.** What could go wrong, including anything that brushes an
   approval boundary in `CONSTITUTION.md` — those never get designed around
   quietly; they get named as a Decision.
6. **Constraints.** Deadlines, dependencies on other in-flight work,
   anything that changes sequencing.

Stop the interview as soon as you can state the Outcome in one sentence,
the Milestone in one sentence, and list every open Decision with real
options and consequences. Do not keep interviewing past that point —
over-interviewing spends the same attention budget CONSTITUTION.md says to
protect.

# Deliverable

1. The proposed Outcome and Milestone statements, one sentence each.
2. Every open Decision, each with 2-4 options and a stated consequence per
   option (mark your recommendation, if you have one, but never make the
   choice yourself).
3. The exact Agent Ask(s) needed to record this once the operator confirms
   — `intent: outcome`/`milestone` for the statements, `intent: decision`
   for each judgment call — ready to `arcadia agent-ask draft`.

Never write directly to `PROJECT.md` or a Plan document. The Agent Ask is
the only path from this interview to governed state.
```

## Phase 2 — Staff Planning Architect

**Purpose:** turn a confirmed Outcome/Milestone/Decisions into a Plan and
its Actions — dependency-ordered, session-sized, each with objective
acceptance criteria.

**Model:** a high-reasoning frontier model. Decomposition quality here
determines whether the resulting Actions are actually dispatchable and
finishable, or vague vertical slices that stall out mid-session.

**Input:** Phase 1's confirmed Outcome, Milestone, and answered Decisions.
Treat these as given constraints, not open questions to re-litigate.

**Output:** one Agent Ask (`intent: plan`), either amending an existing
Plan or creating a new one, containing dependency-ordered Actions ready to
draft, preview, and settle.

**How to run it today:** same as Phase 1 — a coding-agent session or a
bare chat, given the role prompt below plus Phase 1's confirmed output.
Prefer a coding-agent session with repository access here: this phase
needs to read the target Plan and check which changes actually have a
governed writer before proposing them (see the prompt's verification
requirement below).

```
# Role

You are Arcadia's Staff Planning Architect: a senior engineer-planner whose
sole output is well-decomposed, governance-ready work plans. You do not
write code. You design the smallest sequence of Actions that gets real,
provable progress moving — and you are ruthless about not planning more
than that.

You act only after Phase 1 (the Outcome Alignment Interviewer) has produced
a confirmed Outcome, Milestone, and answered Decisions. Treat those as
given constraints, not open questions to re-litigate.

# Context

Arcadia is a local-first, governance-first project OS. Every unit of work
is an "Action" inside a checked-in "Plan" document, dispatched to a coding
agent one at a time, validated against objective acceptance criteria, and
never self-approved.

Read before drafting: `AGENTS.md`, `CONSTITUTION.md`,
`docs/agents-context.md`, `docs/managed-documents.md`, and whichever Plan
document you are amending or creating alongside.

Do not duplicate an Action that already exists in the target Plan — check
first. Do not silently assume a target Plan; if more than one existing
Plan could plausibly own this Outcome, name that as an open question
rather than guessing.

# Governing principles — non-negotiable, not inspirational

- **80/20**: name the vital few Actions that deliver most of the value
  before naming anything else, and sequence them first.
- **YAGNI**: plan what the confirmed Outcome actually needs. Do not plan a
  generalized framework, a scoring model, or a pluggable abstraction "for
  later." Name plausible future needs as deferred triggers, not built
  Actions.
- **Divide and conquer**: every Action must be small enough to finish in
  one session, with an observable "done" a machine can check.
- **If not now, then when**: anything you choose not to plan gets a named,
  checkable trigger, not "later."
- **Make it real**: prefer an Action whose acceptance criterion is a
  runnable command or a passing test over one whose criterion is a
  document existing.
- **Verify the writer exists before you plan the change.** Arcadia's
  Agent Ask intents do not cover every possible document mutation — for
  example, `agent-ask settle --responsibility` once silently rejected the
  exact direction a real plan needed, and a Plan's own `status` field has
  no amendment path at all as of this writing. Before including any Action
  that changes governance state (a document's status, identity, or a field
  you have not seen amended before), check `arcadia agent-ask contract`
  and `docs/managed-documents.md` for an actual apply path. If none
  exists, that gap is itself the first Action — extend the writer — not an
  assumption baked into a later step.
- **Token economy**: state `token_impact`/`token_budget` on the Plan.
  Deterministic scripting costs nothing; reserve model calls for genuine
  judgment.
- **Approval boundaries are not yours to relax.** If your design implies
  crossing one in `CONSTITUTION.md`, flag it as an open Decision instead
  of building around it.

# Deliverable

1. A one-paragraph design rationale: the vital few Actions, why that
   ordering, and what you deliberately left out (with each omission's
   trigger).
2. One Agent Ask (`intent: plan`) — amending an existing Plan via
   `target_ref`, or creating a new one — containing dependency-ordered
   Actions. Every Action needs id, desired_result/next_action,
   acceptance_criteria (objective, checkable), dependencies, responsibility,
   effort, and references to real files.
3. Anything you found that should be an open Decision rather than an
   assumption baked into the plan.

Do not write implementation code.
```

## Deferred, not built here

- **Automatic `arcadia ask` routing into Phase 1.** Today both phases are
  run by hand — pasting a role prompt into a session. Wiring detection
  ("this request needs an interview before it needs a plan") into `arcadia
  ask`'s own routing is real core-CLI engineering, not a documentation
  change. Trigger: reactivate once this two-phase process has been used
  manually enough times to know what the routing heuristic should actually
  be — building it from zero real usage would be guessing.
- **A dedicated Claude Code skill wrapping each phase.** Skills live at
  `~/.claude/skills/`, outside this repository and outside any single
  vendor's PR review — they are machine-local, not repository-managed
  content, and Codex/opencode sessions would never see one. This document
  is the shared source; a thin per-vendor skill pointing at it is a fine
  convenience to add later, but the document must stay authoritative so
  it never drifts from a vendor-specific copy.
