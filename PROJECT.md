---
arcadia: v1
type: project
slug: arcadia
name: Arcadia
status: active
goal: Turn stated outcomes into clarified, routed, executable work without the operator holding the whole portfolio in their head.
outcome: The operator states a desired outcome; Arcadia clarifies it, routes it to the right Project, drives coding agents, and reports back — asking for a decision only when one is genuinely needed.
milestone: Every managed software Project can reveal what it is, what is changing, how it got here, and what proves that story through one free living-system navigator
active_plan: living-system-v1
current_action: dogfood-living-system-v1
updated: 2026-08-25
---

# Arcadia

## Mission

Arcadia is the operator's execution system. It captures raw intent, runs GTD's
clarify step over it with local AI, routes each Action to whoever should do it
(the operator, a coding agent, or an outside party), and surfaces exactly one
question when it cannot proceed without an answer.

The system errs stable and reliable over opportunistic. Approval boundaries are
explicit, automation is observable, and every batch operation previews before it
writes.

The north star is direct Arcadia-led development. The operator states intent
and supplies the scarce human inputs—product judgment, feedback, credentials,
and consequential approvals—while Arcadia maintains the portfolio, selects and
orchestrates configured coding agents, gathers deterministic proof, invokes
independent QA, and advances each governed Action as far as authority and
evidence permit. Questions and approvals arrive through Arcadia Now or another
configured notification surface with evidence, consequences, and ideally one
safe state-advancing Decision. The staged contract and reactivation triggers
are preserved in `docs/arcadia-development-orchestration-vision.md`.

## Current State

The clarification loop is complete end to end: `capture` marks new Actions
unclarified, `clarify` evaluates them against the rubric via local Intelligence,
a verdict either names a concrete next action or opens exactly one Decision, and
subtasks exist for decompositions.

Documentation is a first-class input — see
`docs/plans/portfolio-docs-protocol.md`. Conversations with coding agents
produce markdown; `docs sync` turns that markdown into Projects, Milestones,
Actions, Decisions and mission Logs, so the portfolio can be managed at
executive level from `arcadia portfolio`. Vendor-neutral execution profiles let
Arcadia select the least costly compliant coding-agent configuration without
putting provider model names in those plans. That milestone is reached, and its
two remaining increments are deferred against named triggers by Decision 0004.

`docs/plans/dispatch-contract-enforcement.md` closed the gap between what a
coding agent was told and what it is judged on: acceptance criteria are now
compared against a finished Run's Artifact at acceptance, approval rechecks
readiness when the plan document has moved, `arcadia next --ready` computes
the whole ready set instead of only refusing a bad pointer, and the dispatch
journal's tally surfaces in the dashboard snapshot. That plan is complete.

The operator asked for a narrative account of this session and got one, told
by hand. Then asked for it automatically — for Arcadia's own project and every
Project Arcadia manages, not as a one-off. See
`docs/plans/narrative-digests.md`. That plan is now complete: the composer
narrates one Project's bounded window through the unpaid local-preferred
route, the export projects it into Obsidian as an explicitly AI-narrated
Record, and the Discord bot's digest scheduler composes, exports, and posts
every active Project's digest plus one collective portfolio roll-up on the
daily, weekly, and monthly cadences without being asked.

Cadence windows are calendar-aligned, local, and always the period that has
already finished — the plan's `digest-window-boundaries` question, answered in
`src/digests/schedule.ts`. The once-per-subject-per-period guard is the stored
`(scope, period, window)` row itself rather than a separate schedule ledger,
so a missed tick self-catches-up and a composed-but-undelivered digest comes
back for retry instead of being lost. One Project's failure costs that
Project's digest and nothing else.

With that milestone reached, the pointer moved to `demo-first-delivery`,
already drafted from operator direction on 2026-08-01 under approved Decision
0007. The configured operator QA queue is complete. While advancing Private
Practice Now, the operator then explicitly prioritized the missing independent
pull-request QA responsibility as a must-have. Decision 0018 inserted and
completed `establish-minimal-pr-qa`: `arcadia qa pr` now freezes a GitHub head
revision, gathers deterministic evidence, runs one independent read-only
structured review, and persists its QA report Artifact and Decision. Its first
real Candidate, Arcadia PR #54, correctly returned Needs follow-up rather than
Pass for contradictory CI evidence. The post-delivery process audit then
exposed two cheap repeat costs: model calls made before deterministic readiness
and a repository-local workspace race in CI. Decision 0019 inserted and
completed `streamline-minimal-pr-qa`: deterministic readiness now refuses
unready Candidates without reviewer tokens, mutable evidence is rechecked
immediately before judgment, and the workspace-precedence regression is
isolated from dogfood state. The pointer has returned to
`build-demo-hero-vertical-slice`. This remains evidence-driven sequencing, not
priority inferred from queue order.

The pointer then moved once more, on operator direction, to
`docs/plans/arcadia-way-propagation.md`: nothing pulled the Arcadia Way back
from an adopting project once written, so a project could go stale without
anyone knowing. That plan is now complete. Adopter zero found and fixed two
real generator defects along the way (the built CLI's `readAdoptedFile` root
resolution, and `CLAUDE.md` being silently overwritten), then delivered
`arcadia way` — a read-only command reporting per project whether its adopted
`CONSTITUTION.md`, `AGENTS.md` region, and continuation protocol still match
Arcadia's canonical text. Run against Arcadia itself, it immediately found a
third defect: the continuation protocol was being doubled on adoption, because
Arcadia's own repository is both the canonical source and, for itself, the
adopted target — after the first `setup-context` run, every later run nested
another pair of markers around the previous run's own output. Fixed by
unwrapping one layer of markers from the canonical body before rewrapping it,
verified across three consecutive real runs producing a byte-identical file.
`open-way-sync-pull-requests` (automatic cross-repository propagation) stays
open and blocked on an unanswered operator question; it does not gate this
milestone, which only requires staleness to be visible rather than silent. The
pointer has returned to `build-demo-hero-vertical-slice`.

`build-demo-hero-vertical-slice` is now `done`. It was held `open` on purpose
while [PR #77](https://github.com/pmark/arcadia/pull/77) awaited review, and
then stayed open for three days after that PR merged, because nothing closes an
Action on merge — the condition was recorded in the Mission Log rather than
anywhere a command reads. Every Project Detail page now opens with one
state-resolved demo hero above the control record, backed by a checked-in
Stable/Candidate contract and a live reachability probe. Verified against the
running instance: PPN resolves `ready_for_operator_demo`, showing Juniper as
Stable and River Copy Studio as Candidate with one primary action. The pointer
moves to `make-test-action-state-aware`, chosen over `automate-proof-artifacts`
because closing this Action surfaced the exact gap it names — the Candidate's
`http://127.0.0.1:4321` is a dead end from the phone the operator demos on, now
labelled honestly and not yet fixed.

The Agent Queue is documented in `docs/plans/agent-advance-queue.md`. It is a
projection, not a second work pointer: managed documents still decide what is
dispatchable, and provider limits still gate packet selection. Provider-budget
admission is deferred until Claude Code and Codex both expose comparable fresh
daily and weekly capacity windows.

On 2026-08-20 the operator set a more direct north-star priority: they want to
state a project idea once, have Arcadia classify and plan it into governed work,
and then have Arcadia manage the build with a coding agent. Decision 0029
activates `docs/plans/idea-to-managed-build.md`. The first 80/20 slice is a
single project-preparation command that preserves the full idea, creates a
dispatchable planning Action and control-document pointer, and produces the
exact planning Decision without invoking a model. The next slice removes the
manual gap after plan acceptance by promoting its smallest implementation goal
into the current governed build Action.

`prepare-project-idea` is now `done`. `arcadia project prepare` takes the name,
free-form idea, optional repository path, and optional planning profile. It
creates an Active Project, preserves the idea in both the Project Outcome and
the planning Action's raw input, writes and binds the bootstrap pointer chain,
adopts the repository context, resolves dispatch readiness, and creates the
immutable planning packet and approval Decision through the existing path. Its
final line is the exact approval trigger, and tests prove there is no Run or
model invocation. The pointer moves to `promote-accepted-plan`, the remaining
manual seam between accepted planning and coding-agent implementation.

The operator then set a 2026-08-21 demonstration target and supplied the exact
golden-path story: "Create a MartianRover Field Notes blog site" should create
a populated proposed Project, notify Discord with a Project-detail deep link,
accept an operator-supplied empty GitHub repository URL, and use an approved
Codex or Claude Code Run plus the Create Astro Site skill to return a live
Cloudflare Workers staging URL. Decision 0030 makes `demo-astro-staging-loop` the
current Action ahead of the general accepted-plan promotion seam. The 80/20
boundary is explicit: prove Astro/Field Notes end to end; generalize to Next.js
and Node.js only when a second concrete stack is selected.

That demo implementation is now complete and covered by a synthetic full-loop
worker test: proposal, GitHub metadata, approval, scoped Codex packet, build,
Cloudflare command/result handling, persisted staging URL, completed Action,
Dashboard projection, and Discord deep link/Artifact. The full test suite and
both application builds pass. A real `workers.dev` rehearsal was not performed
because the operator's empty GitHub repository and external Cloudflare staging
authority are demonstration inputs, not repository fixtures. The pointer now
returns to `promote-accepted-plan`.

The operator then prioritized reusable Obsidian architecture maps and required
the work to follow Arcadia's normal continuation contract. Decision 0031
initially inserted five clarified Actions into `demo-first-delivery`, beginning with the
deterministic repository manifest contract and ending with real Arcadia vault
proof. The project-idea plan is paused, not superseded: when the mind-map slice
is complete, the single pointer returns to
`idea-to-managed-build/promote-accepted-plan`. Normal map creation and updates
must make zero model calls; an explicitly requested local-only enrichment may
add a separately labelled interpretation without a cloud fallback.

On 2026-08-21 the operator refined that idea into living-system v1. Decision
0032 replaces the arbitrary fixed concern categories and the planned local-AI
step with five Pareto Actions: define one Project-extensible contract, derive
trustworthy living state, project equal capability-map and Action-timeline
views, integrate a zero-model preview/apply refresh path, and dogfood the
complete experience on both Arcadia and Private Practice Now. The current Action is now
`define-living-system-v1-contract`. Home must link directly to current work and
affected Topics; maps and timelines must navigate both ways; provenance,
freshness, gaps, and unlinked history must remain visible; and generated
Markdown must stay useful without a plugin or paid service. Decision 0032's
measured-use triggers govern every deferred enhancement.

`define-living-system-v1-contract` is now `done`. The versioned parser accepts
Project-owned Topics, Relationships, and Views without imposing a fixed
software taxonomy; validates identity, selector, reference, source-containment,
and authority boundaries; and emits byte-stable normalized structure. The
shared target types keep Episodes, Signals, source/freshness receipts, impact
provenance, and unlinked history outside the writable manifest. Optional Log
`Action: plan-slug#action-id` links now resolve against the same Project's
managed plans rather than being inferred. Arcadia and Private Practice Now
fixtures, every required refusal class, 947 passing tests, and clean core,
Discord, and Dashboard builds prove the contract. The pointer moves to
`derive-living-system-state` to populate that target from authoritative records.

`derive-living-system-state` is now `done`. The zero-model assembler projects
managed pointers, plans, Actions, explicit Log links, Decisions, and supplied
Run, Artifact, pull-request, Git, and validation receipts into byte-stable
Episodes and Signals. Action references, changed files, and one-hop declared
Relationships produce visibly distinct declared, observed, and downstream
impact; unsupported work stays unmapped. Missing proof, stale receipts,
contradictions, and unlinked history remain explicit, and malformed operational
references fail at named fields. Arcadia and Private Practice Now fixtures plus
950 passing tests and clean core, Discord, and Dashboard builds prove the
derivation boundary. The pointer moves to
`build-living-system-map-and-timeline` so this truthful model becomes the
morning demo's navigable presentation.

`build-living-system-map-and-timeline` is now `done`. The zero-model projector
creates a presentation-grade Home, whole capability map, Project-defined
submaps, evolution timeline, Current Work, reciprocal Topic and episode notes,
plain-Markdown guide, and side-by-side Canvas under one isolated Project
subtree. The generated journey supports glance, orient, understand, and audit;
prints provenance and freshness beside claims; and keeps missing, stale,
conflicting, unmapped, and unlinked truth visible. Preview/apply agreement,
byte-stable reruns, collision refusal, stale retention, symlink containment,
valid Canvas and WikiLinks, and Arcadia/PPN isolation pass alongside 954 tests
and all builds. The pointer moves to `integrate-living-system-sync` so the two
demo stories can be created and refreshed through a real operator command.

On 2026-08-25 the operator returned to Arcadia Ask after dogfooding a real
Living Songbook capture. The request exposed one connected front-door gap:
text, links, and attachments need one auditable envelope; memorable exact
prefixes such as `songbook` need visible deterministic routing; the operator
must be able to inspect and change those rules without code; and capture should
open the guided understanding session rather than stop at a generic receipt.
`docs/plans/arcadia-ask-active-sessions.md` records the five-step plan and
Decision 0035 records the one sequencing question. The current living-system
review remains authoritative and untouched. The recommendation is to resolve
that review, activate Ask active sessions next, then restore
`idea-to-managed-build/promote-accepted-plan` after accepted Songbook dogfood.

## Links

- `docs/COMMANDS.md` — the operator-facing command guide
- `docs/plans/` — one file per initiative, each a managed document
- `CONSTITUTION.md`, `OPERATOR_CONTEXT.md` — standing constraints and context
