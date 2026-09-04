# AGENTS

This is the vendor-neutral source of truth for how work is done here. Every
coding agent reads it: Codex loads it directly, and `CLAUDE.md` is a thin
wrapper that imports it. Shared rules belong in this file, never in a
vendor-specific one.

Two companions carry the rest, and both bind every agent:

- [`CONSTITUTION.md`](CONSTITUTION.md) — the constraints that outrank
  convenience. `arcadia next` prints it in the dispatch brief, so it arrives
  with the objective.
- [`docs/managed-documents.md`](docs/managed-documents.md) — the work pointer,
  plan anatomy, and which fields are enforced where. Read it before writing or
  changing a `PROJECT.md`, a plan under `docs/plans/`, or a Decision.

Arcadia exists to maintain momentum across creative projects with minimal cognitive overhead.

Prefer deterministic workflows.
Prefer local scripts before AI.
Prefer local AI before frontier models.
Use Codex only when code changes are required.

Always identify:
- Current milestone
- Next action
- Work classification
- Required artifacts

<!-- ARCADIA_CONTEXT_START -->
## Arcadia Context

This repository is on the Arcadia Way. These files govern how work is done
here, and every coding agent is bound by them equally:

- `CONSTITUTION.md` — the standing constraints. `arcadia next` prints them
  with the objective, so they arrive when authority is granted.
- `PROJECT.md` — the work pointer: one `active_plan`, one `current_action`.
- `docs/managed-documents.md` — how managed documents, the pointer chain,
  and enforced fields work, when this repository has a copy.

Before broad repository exploration, read:

- `.arcadia/AGENT_CONTEXT_POLICY.md`
- `.arcadia/repo-context.md`
- `.arcadia/context-policy.json`

Use targeted searches, respect denied paths, and keep discovery bounded by the Arcadia context policy.

For continuation requests — "arcadia go", a bare "go", or "Get to work" —
resolve `active_plan` and `current_action` from `PROJECT.md`; never select
work from an unordered backlog.

Commands follow the naming rule: **nouns read state, verbs may mutate it
within declared authority**. Trust the part of speech. A noun that writes is a
bug in the name as much as in the code.

### A current Action is executable only when

- it exists exactly once in the active plan;
- its status is anything but `done`;
- its clarification is `clarified`;
- its responsibility is `autonomous` or `agent`;
- its `next_action` begins with a concrete verb; and
- its acceptance criteria define observable completion.

**`open` is executable.** An Action does not have to be `in_progress` to be
picked up, and dispatch refuses only `done`. If any condition fails, repairing
the control documents **is** the immediate work — not an obstacle to it.

### Before you stop

Do one of three things, and update `PROJECT.md`, the active plan, affected
Decisions, and `MISSION_LOG.md` wherever their authoritative state changed:

- complete the Action, validate it, record the result, and select the next one;
- record one precise operator question required for review; or
- record a concrete external blocker and the draft ask needed to resolve it.

A merged pull request, a ratified Decision, or a plan reaching its milestone
is itself a stopping condition. Open or update a pull request then — without
being asked, and without waiting for the plan to close out. Then say whether to
continue in this session or start a new one and why, and which model and effort
level the next batch actually needs.

**End every stopping point with the choices, not with prose.** The operator
should never have to read a report and work out what happens next from it.
Present the real options — the next Action, a Decision waiting on an answer, a
pull request to review or merge, the draft ask a blocker needs, ending the
session — as a picker they can select from.

- **Every option states its consequence**, not just its name. "Merge #159" is a
  label; "Merge #159 — proposals go live for every adopting repo, and the
  pointer advances" is a choice. An option whose consequence you cannot state
  is one you have not thought through yet.
- **Offer only live options.** Something already settled is not a choice, and
  re-asking it spends the attention budget this rule exists to protect.
- **Say when the session should end, and what opens the next one.** Almost
  always that is `arcadia go` in a new session: the pointer already knows what
  comes next, so naming a task instead would be guessing ahead of it. Name a
  different opening move only when it genuinely differs, and say why.
- **Size the next batch.** Which model and effort level that work actually
  needs, not whatever is already running.

The picker and the `OK to go` line below are the same commitment made at
different widths: never leave the operator to derive the next move. Use the
picker whenever more than one thing could reasonably happen next, and the line
when exactly one can.

When a message ends with exactly one concrete, immediately actionable next
step — nothing blocking, no open question, no choice pending — end it with a
fixed line, last in the message, preceded by a blank line:

```
OK to go: <verb-first, one-sentence description of exactly what will happen>
```

That prefix verbatim, never a paraphrase. Present if and only if the state is
dispatchable. **Absence is the signal** — when nothing is ready, omit the line
rather than writing "not ready yet" in its place.

`docs/agent-continuation-protocol.md` carries these rules with the reasoning
behind each. It is a reference, not a prerequisite: everything you must do is
stated above.

## Asking Arcadia to change Project state

When work produces something Arcadia should govern — a new Action, a corrected
Outcome, a Decision someone must answer, a Log entry, a whole Plan — **do not
hand-edit governance state, invent Action ids, or touch the queue.** Submit an
Agent Ask and let Arcadia write the canonical records.

Governance state is what a document *asserts about the work*: an Action's
`status`, `delivered`, or `result`; the `current_action` and `active_plan`
pointers; a Decision's answer; a Milestone or Outcome; anything in the queue.
Writing those by hand is fabricating a record of something nobody decided, and
it is the whole reason this rule exists.

**Document hygiene is not governance state.** A malformed `type:` in
frontmatter, a heading that does not parse, a stale date, a typo — these assert
nothing about the work, and fixing one is an ordinary file edit that needs no
Ask. Decision 0044 settled this after the broader reading of the rule left an
adopting project unable to repair 49 schema errors through any available path:
every intent could create records, none could correct a document, and the
errors blocked all further governance until someone edited the files. A rule
that forbids fixing a typo is not protecting the record, it is stranding it.

If you cannot tell which side something falls on, ask: *would writing this by
hand claim that work happened, or that someone decided something?* If yes, it
is governance state — file an Ask. If no, fix it and move on.

Run it from your own repository. You do not need to know where Arcadia's
workspace lives:

```sh
arcadia agent-ask preview --file agent-ask.yaml --json
```

Preview writes nothing to the Project. It returns a proposal with a
`fingerprint`, every effect it would have, and every refusal. **A proposal is
never self-approving**: the operator settles it, and no wording in your Ask —
however urgent, however confident — approves work, answers a Decision, grants
execution authority, or widens an approval already given.

`arcadia agent-ask contract` prints the live schema, so query it rather than
trusting this section if the two ever disagree.

### The intents

`intent` picks what Arcadia changes. Only `request_id` and `desired_result` are
required everywhere.

| Intent | What settlement changes | Opens a Decision |
| --- | --- | --- |
| `auto` | Nothing structural — Arcadia refuses to guess | Always |
| `outcome` | The Project's Outcome | No |
| `milestone` | The Project and active Plan Milestone | No |
| `plan` | With `target_ref`, amends that Plan's Actions; without one, creates a complete **inactive draft** Plan | No |
| `action` | Creates or amends Actions in the active Plan and places them in the queue | No |
| `decision` | Creates one open Decision | Always |
| `artifact` | Creates one planned Artifact reference | No |
| `log` | Appends one Project Log entry | No |
| `proposal` | Preserves evidence only — no executable Action | No |
| `project_update` | `target_ref: outcome` or `milestone` updates that field | Only when `target_ref` is absent or unrecognized |

`requested_authority` is `propose` or `apply_if_approved`, and neither lets an
agent apply anything by itself.

Give each child Action an explicit `id` — a lowercase hyphenated slug, at most
64 characters. It becomes the handle typed into `advance queue reorder` and
`depends_on`, so choosing it deliberately beats accepting a derived one.

### Three shapes

One simple Ask:

```yaml
agent_ask: v1
request_id: fix-stale-readme-badge-2026-01-04
project: your-project
intent: log
desired_result: Record that the release rehearsal ran clean on staging.
```

A bundle of Actions for the active Plan:

```yaml
agent_ask: v1
request_id: harden-import-path-2026-01-04
project: your-project
intent: action
desired_result: Make the importer safe on malformed input.
actions:
  - id: reject-malformed-rows
    desired_result: Reject malformed rows with a named field error.
    acceptance:
      - A malformed row fails with the offending field named.
    dependencies: []
  - id: cover-importer-edges
    desired_result: Cover the importer's refusal paths with tests.
    acceptance:
      - Empty, oversized, and malformed inputs each have a test.
    dependencies:
      - reject-malformed-rows
```

An amendment to an existing Plan — children with `target_ref` amend the named
Action, children without it create new ones. For an amendment `dependencies`
and `references` are replacement lists, so an explicit empty list clears stale
values:

```yaml
agent_ask: v1
request_id: retarget-import-plan-2026-01-04
project: your-project
intent: plan
target_ref: plan/data-import
desired_result: Retarget the import plan on the real failure mode.
actions:
  - target_ref: action/reject-malformed-rows
    desired_result: Reject malformed rows and report every bad field at once.
    acceptance:
      - One pass reports every offending field.
    dependencies: []
```

Replaying a `request_id` returns the original receipt; changed content under a
used id is refused. If the operator's judgment should decide something, say so
in `rationale` and let Arcadia open the Decision — that is the correct outcome,
not a failure.

### Settling commits locally and never pushes

`arcadia agent-ask settle --apply` writes the managed documents its effects
describe and commits them, on whatever branch the repository is currently on —
but it never pushes. That is deliberate: landing the record locally is
Arcadia's job, publishing it is the operator's, and an agent pushing straight to
a shared branch on its own initiative is exactly the boundary
`docs/working-copy-safety.md` exists to hold.

The gap this leaves is real, not theoretical: a settlement against a repository
already checked out locally produces exactly one commit that only exists there
until something pushes it. Nothing currently reminds anyone to, which is how it
was found — a settled Log entry sat as `LOCAL ONLY` until the next session
noticed the divergence.

**Push before ending a session in which you settled anything.** Treat it the
same as any other `LOCAL ONLY` state under Working-Copy Safety: check
`arcadia work monitor`, or simply push the branch settlement just committed to.
An Agent Ask you only previewed needs nothing further — this applies to
`settle --apply`, not `preview`.

## Asking for a capability the Way does not have

Arcadia will not have every capability you need. When it does not, **file a
proposal and continue without it.** Do not implement Arcadia commands, parsers,
or governance machinery locally. A capability Arcadia does not have is a
request, not a gap for this project to fill.

That second sentence is the operative one. Without it the first is advice, and
what actually happens is a growing local script that reimplements Arcadia badly
and drifts from it silently — which is exactly the failure Decision 0025 was
written after finding.

**How to file.** Write `docs/proposals/<slug>.md` in *this* repository:

```markdown
---
arcadia: v1
type: proposal
project: your-project
question: Can Arcadia evaluate reactivation triggers so deferred items revive on their own?
---

# Trigger evaluation

## Why this project needs it

Three deferred items name conditions nobody re-reads, so they never revive.

## What we would build locally

A trigger evaluator in `scripts/`, which is the thing this proposal exists to
avoid.
```

Only the `question` is load-bearing, and it may instead be the document's first
`#` heading. The slug falls back to the filename, and `project` to whichever
Project owns this repository. Commit it like any other document.

**What happens next.** `arcadia docs sync` ingests it on its next run, and it
appears in `arcadia portfolio` under "Waiting on you", marked as a proposal. The
operator answers it by ratifying a Decision in the Arcadia repository, which is
where a Way change belongs. Add `decision: "0025"` to the proposal's frontmatter
once it is answered, and it stops asking.

Filing needs no network access, no credentials, and no reachable Arcadia — it is
a committed file, so it works from a cloud container with no Arcadia installed.

## The 80/20 rule

The Pareto principle holds that roughly 80% of consequences come from 20% of
causes. Treat it as a standing instruction, not an observation: **find the 20%
and do that first.**

In practice, for any piece of work:

- **Name the vital few before starting.** Which small part of this delivers most
  of the value? Say so explicitly, and sequence it first — not because the rest
  is worthless, but because the rest is what gets cut when time runs out, and
  that should be a deliberate choice rather than an accident of ordering.
- **Prefer the change that reuses what exists.** The cheapest 80% is usually
  already built and merely unreachable — a report that is not scoped, a field
  that is parsed but never read. Extending something proven beats introducing
  something new, and it is the difference between an afternoon and a milestone.
- **Say when the expensive 20% of value is not worth its 80% of cost.** Deferring
  is a real answer. Recommend it plainly, and record what was deferred and why,
  so the decision survives the conversation.
- **Do not gold-plate the tail.** Exhaustive coverage of rare cases is the
  classic 80% of effort buying 20% of value. Handle the common path well, fail
  loudly and legibly on the rest.

This rule is subordinate to the constitution's approval boundaries. Safety,
approval gates, and truthful reporting are never the 80% to be trimmed — a
shortcut through an approval boundary is not a Pareto optimization, it is a
violation.

## YAGNI

"You aren't gonna need it" is the 80/20 rule's twin, aimed the other
direction: it names the cost of building for a need that never arrives.
Treat it as a standing instruction, not a judgment call to weigh case by case.

- **Build the thing that was asked for, not the thing it might grow into.** A
  configuration flag, an abstraction layer, or a plugin point earns its place
  when a second concrete caller exists — not when one might exist someday.
- **Delete speculative surface area on sight.** Unused parameters, dead
  feature flags, and "just in case" fields are debt from the moment they are
  written, because every future reader has to understand them before ever
  using them.
- **Prefer duplication over the wrong abstraction.** Three similar lines at
  three call sites are cheaper to read, change, and delete than one premature
  shared helper serving three masters that will not stay identical.
- **A speculative need is a deferred item, not a built one.** If a future
  requirement looks likely, name it as a trigger condition under "If not now,
  then when?" below, and let the deferral rule govern it — do not pre-build
  for it.

This rule is subordinate to what the operator actually asked for. Cutting a
requirement that was genuinely requested in the name of YAGNI is not economy,
it is scope drift running the other direction.

## Divide and conquer

A goal that feels too large to start is usually not too large to finish — it
is only too large to see the next step of. Treat operator overwhelm as a
decomposition failure, not a resolve failure, and answer it by decomposing.

- **Divide.** When an Outcome, Milestone, or Action looks daunting, split it
  into smaller pieces shaped like the whole: each still has a clear boundary,
  an observable "done," and its own next concrete step. Keep splitting until a
  piece is small enough to finish in one sitting without dread. A plan whose
  leaf Actions are all bite-sized is doing this correctly; a plan with one
  giant Action and nine trivial ones is not.
- **Conquer.** Solve the smallest piece first, using the same discipline any
  other Action gets — clarify, dispatch, validate, record. The recursion is
  the point: if a piece is still too big to start, dividing it further is
  itself the next move, all the way down.
- **Combine.** Roll each finished piece back up: update the parent Milestone,
  note what the small win proves about the larger Outcome, and let that
  visible progress motivate the next piece. A pile of finished small Actions
  is what "the big thing got done" looks like from the inside.

When the operator names a task as overwhelming, do not just acknowledge the
feeling — divide the task on the spot into a first Action small enough to
start in the current session, propose it, and get moving. Real progress on a
sliver of the true problem beats a plan for the whole of it, because that
sliver is the antidote to the overwhelm that made starting hard in the first
place.

This is a decomposition strategy, not a permission structure. It does not
relax `CONSTITUTION.md`'s approval boundaries, and it does not excuse skipping
the 80/20 rule's obligation to name the vital few pieces before splitting.

## If not now, then when?

The 80/20 rule says deferring is a real answer. This one says what a deferral
costs: **a deferral must name its trigger.**

"Later", "eventually", and "when we have time" are not answers. They are the
decision being taken again at every future session, at full price, by whoever
reads the document next. An item deferred without a trigger does not leave the
queue — it just stops being legible.

So when the answer is not now, say when:

- **Name the condition, not the date.** "When a second foreign repository is
  onboarded" is a trigger. "Q3" is a wish. The condition should be something
  that will visibly happen or visibly not happen, so the deferral can expire on
  its own instead of needing a meeting.
- **A trigger that can never fire is a rejection.** Write it down as one. A
  `deferred` item nobody can imagine reactivating is the queue lying about its
  own size, and it is kinder to close it and be wrong than to carry it forever.
- **Deferral is not blocking.** `blocked` means an outside party owes something.
  Choosing not to do work that is perfectly startable is a decision, and it gets
  recorded as a Decision with an answer — not left as an open question that
  refuses dispatch every morning.
- **Re-ask only when the trigger fires.** That is the whole point. Between now
  and then, the question is settled and nobody re-litigates it.

The test for whether this rule is being followed: read any deferred item and ask
what would have to be true for it to start. If the document cannot answer, the
deferral was never made — the item was only postponed.

## Stop the line

A defect that blocks work outranks the plan it interrupted. Promoting a
showstopper to first priority is the default; **continuing past one is what
needs justifying.** This is the counterweight to the rule above: deferral is a
real answer for work, and not an answer at all for a defect that is stopping
work from happening.

- **Severity is a feeling. Blast radius is a test.** Promote when any of these
  holds: it blocks work unrelated to itself; its only workaround is one a
  person has to remember; or — the strongest case — **it blocks its own
  repair.** A defect that has eaten the mechanism for reporting it cannot wait
  its turn, because there is no turn to wait for.
- **Promotion is a move, not an opinion.** File it, place it at the top of the
  queue, and make it the `current_action`. "We know about it" is not
  promotion; it is a deferral without a trigger wearing an urgent face.
- **When the defect blocks the record, repair precedes the record.**
  Governance normally comes first, and this is the one inversion: fix it, then
  file the Log entry describing what was fixed and why the usual order could
  not hold. Say so explicitly in that entry — an unexplained inversion is
  indistinguishable from skipping the rule.
- **"Almost" earns its place exactly once.** A showstopper may wait when a
  workaround exists, is written down where the next person will hit it, and
  carries a trigger for removing it. An undocumented workaround is not an
  exception, it is the bug plus a secret.
- **This does not license urgency generally.** A bug that is merely annoying,
  expensive, or embarrassing is ordinary work and goes through the 80/20 rule
  like anything else. Nor does it relax any approval boundary: a showstopper
  never authorizes a shortcut through a gate.

The test for whether this rule is being followed: when something was found
broken and the plan continued anyway, the document should say what the
workaround was and when it expires. If it says nothing, the rule was skipped,
not applied.

## Make it real

Plans, analysis, and architecture are valuable when they turn into something a
person or system can actually use. **Shape each Action toward the most direct
usable form available.**

- Prefer a working UI, runnable command, linked deployment, testable Artifact,
  or explicit Decision over prose describing one.
- Put output directly into the interaction surface that needs it. Do not make
  the operator manually translate a Log, JSON blob, or implementation note
  into the next usable step when Arcadia can perform that translation safely.
- Preserve one stable proof while a Candidate changes. A mock, screenshot, or
  plan may prove direction, but never label it as a working product.
- When an Action genuinely has no runnable form, say why and produce the
  strongest honest Artifact it can have.

"Make it real" does not authorize deployment, merge, credentials, spending,
production access, messaging, or any other gated operation. A less tangible
but truthful Artifact is more real than an unauthorized production mutation.

## Token economy

Treat deterministic computation and model inference as different budgets.
Builds, tests, health probes, Playwright navigation, and screenshot capture use
machine resources but no LLM tokens unless a model is asked to interpret their
output.

Every managed plan declares a T-shirt `token_impact` and a plain-language
`token_budget`. Use the smallest sufficient model-bearing step, batch evidence
for review, and invoke model-based diagnosis on failure rather than on every
successful routine run. Token impact is a relative planning signal, not a
fictional exact forecast.
<!-- ARCADIA_CONTEXT_END -->

<!-- Everything outside the markers above is this repository's own and is never regenerated. -->

The operating principles that used to live here — the 80/20 rule, YAGNI,
divide and conquer, "if not now, then when?", make it real, and token economy
— moved into [`docs/agents-context.md`](docs/agents-context.md) so they are
part of the block above and reach every adopting repository, not just this
one. Edit them there; `pnpm arcadia project setup-context --repo .`
regenerates this file's copy.

## Orientation

Before working on the database, the Intelligence service, or the Discord bot, read:

`docs/AGENT_ORIENTATION.md`

It captures the non-obvious, verified architecture context that most often trips up a cold start: the two schema sources (migrations in `src/db/schema.ts` win), the two distinct "Artifact" concepts, how Intelligence routing/workers/errors behave, that events are a log (not a bus) and there is no auth layer, and how the CLI-shellout boundary works for the dashboard and Discord bot.

## Managed Documentation

[`docs/managed-documents.md`](docs/managed-documents.md) explains how the
managed documentation system works: the work pointer, plan document anatomy,
which fields are enforced and where, and the rule that checked-in documentation
is authoritative. Read it before writing or changing a `PROJECT.md`, a plan
under `docs/plans/`, or a Decision.

## Arcadia Semantics

Before changing user-facing terminology, data models, CLI commands, dashboard labels, or documentation, read:

`docs/arcadia-semantics.md`

Use Arcadia’s canonical terms consistently:
Domain, Project, Mission, Outcome, Milestone, Action, Artifact, Decision, Log.

## Operator Guide

`START_HERE.md` is the canonical brief guide for normal Arcadia use. Any change to a user-facing flow, CLI command named there, dashboard address, or managed service behavior must update that file in the same change.

## PR QA Plan

Every PR created at a stopping point must contain an operator-facing QA plan.
The plan is an Artifact, not a vague invitation to "test it": it tells a
person exactly where to go, what to do, and what should happen.

For each runnable surface changed by the PR, state:

- the service or application, its start/recovery command when applicable, and
  the exact URL including host, port, and route;
- whether the target is local-only, LAN/phone-reachable, remote, missing, or
  currently unreachable — never imply a demo is available without evidence;
- the expected change relative to the prior behavior; and
- numbered operator steps with observable expected results.

Include a separate end-user procedure whenever it differs from the operator
procedure. Otherwise say explicitly that the operator procedure is the
end-user procedure. If no runnable target exists, say why and name the
strongest available proof Artifact and the condition that will make a runnable
test possible. The PR template and
`docs/operator-demo-and-release-contract.md` define the required format.

## Working-Copy Safety

Before code changes, run `pnpm arcadia work monitor --no-pull-requests` and
inspect the intended working directory. One coding session must use one branch
and one worktree; do not begin agent code changes on `main` or in a checkout
another session is using.

Before stopping, leave changed code merged or on a pushed branch with a draft
or ready PR. If commit, push, or PR creation is not authorized, report the exact
repository, worktree, branch, dirty paths, and recovery action; never silently
leave uncommitted work on `main` or a detached HEAD. These rules do not broaden
approval authority. See `docs/working-copy-safety.md`.
