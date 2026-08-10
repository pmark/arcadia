# AGENTS

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

When a message ends with exactly one concrete, immediately actionable next
step — nothing blocking, no open question, no choice still pending — end it
with a fixed `OK to go: <verb-first next step>` line, last thing in the
message, and omit it entirely otherwise. This is the coding agent's half of
what `arcadia next` already resolves to (dispatchable / one operator question
/ blockers): one reliable signal, not prose that has to be read to be
trusted. Full spec, and the reasoning behind each constraint, lives in
`docs/agent-continuation-protocol.md` under a project operating on the
Arcadia Way — see Private Practice Now's copy — since it governs every
coding agent's reports, not just Arcadia's own.

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

## Orientation

Before working on the database, the Intelligence service, or the Discord bot, read:

`docs/AGENT_ORIENTATION.md`

It captures the non-obvious, verified architecture context that most often trips up a cold start: the two schema sources (migrations in `src/db/schema.ts` win), the two distinct "Artifact" concepts, how Intelligence routing/workers/errors behave, that events are a log (not a bus) and there is no auth layer, and how the CLI-shellout boundary works for the dashboard and Discord bot.

## Managed Documentation

`CLAUDE.md` explains how the managed documentation system works: the work
pointer, plan document anatomy, which fields are enforced and where, and the
rule that checked-in documentation is authoritative. Read it before writing or
changing a `PROJECT.md`, a plan under `docs/plans/`, or a Decision.

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
