---
arcadia: v1
type: project
slug: arcadia
name: Arcadia
status: active
goal: Turn stated outcomes into clarified, routed, executable work without the operator holding the whole portfolio in their head.
outcome: The operator states a desired outcome; Arcadia clarifies it, routes it to the right Project, drives coding agents, and reports back — asking for a decision only when one is genuinely needed.
milestone: Every adopting project receives Way changes and can ask for Way capabilities without anyone writing Arcadia twice
active_plan: way-delivery
current_action: go-fetches-and-fast-forwards-base-from-remote
updated: 2026-09-05
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

The operator clarified on 2026-09-01 that Ask should remove personal Git and PR
ceremony from planning and Project management, while preserving repository
truth and approval boundaries behind the interaction. They also want otherwise-
expiring included Claude Code and Codex capacity to advance safe Back Burner
work without silently consuming paid credits or resets. The non-active
`docs/plans/provider-capacity-harvesting.md` captures the modular estimates,
dependency graph, critical-usage reporting, and activation boundary. It extends
the completed Agent Queue plan's deferred `budget-aware-admission` Action and
does not compete with the active Ask pointer.

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
Living-system v1 is now accepted. The operator explicitly accepted its Arcadia
and Private Practice Now dogfood review; the two Project-owned manifests and
the deterministic Arcadia1-vault projections remain the proof surface. No
dashboard acceptance control exists for a document-owned `requires_review`
Action, so that product gap is recorded separately rather than added to the
completed v1 scope. The pointer has resumed
`idea-to-managed-build/promote-accepted-plan`.

On 2026-08-27 the operator moved the operator attention board to the front of
Arcadia's product queue. Decision 0036 promotes the existing blocking-question
slice into `build-operator-attention-board`: a minimal `Needs you` surface that
ranks only consequential operator judgment and makes urgency, temporal trigger,
Outcome and release relevance, what the item unlocks, operator minutes, Token
Impact, recommendation, evidence, choices, and immediate consequences legible.
`promote-accepted-plan`, the prepared-plan approval surface, and Ask active
sessions remain governed work; they are not cancelled, and their post-board
order must be chosen from evidence rather than inferred from queue position.

The operator attention board is now complete. `Needs you` ranks the active
operator-only set, gives Decisions typed consequence previews and durable
transition receipts, and now applies the same explicit handoff contract to
standalone coding-agent packets and failed or review-required Runs without
pretending that opening a record or revealing a guarded command changed state.
The complete 18-test browser suite, 1,088 unit tests, and clean core, Discord,
and Dashboard builds prove the slice. The pointer returns to
`idea-to-managed-build/promote-accepted-plan`, because that deterministic
accepted-plan-to-build promotion remains the direct unresolved seam in the
current Milestone; the larger plan-reading surface still depends on it.

Dogfood on 2026-08-30 found that an old plan question (R53) was still consuming
operator attention even though PPN had a different active plan and Codex-owned
current Action. Needs you now exposes **Reassess** on clarification Decisions:
the deterministic transition checks the source question against the Project's
checked-in active plan, withdraws disconnected Decisions without erasing their
history, and labels questions found in the active plan **Still declared**
without claiming semantic validity. Those questions can be **Flagged for agent
review**, which parks them outside Needs you in a dedicated Agent Queue lane
without starting a Run or granting execution authority.

On 2026-08-29 the operator selected tmux as the first concrete transport for
Arcadia-managed coding-agent Sessions. This does not displace
`promote-accepted-plan`: Arcadia must first produce the exact governed build
Action a Session will execute. The active plan now orders two Session slices
immediately after that seam: persist and explicitly launch one addressable
Claude Code Session in Arcadia's existing isolated worktree, then reconcile
its exit into a thin receipt and the repository's next Action or Decision.
Only after real dogfood may worker queueing reactivate; notifications wait for
an observed unnoticed state, and transcript monitoring, prompt injection,
default-on launch, and session analytics remain deferred against named
triggers.

On 2026-08-30 the operator approved Decision 0035's sequence amendment: the
living-system review is resolved, so Ask active sessions now runs before the
idea-to-managed-build pointer is restored. Decision 0038 is also approved for
one bounded credential-backed dogfood rehearsal, but that rehearsal remains a
separate, later Action after the Ask sequence; approval does not claim it has
run. Decisions 0028 and 0037 were ratified as written, making their follow-up
implementation and adoption work explicit rather than implicit.

`make-special-routing-visible` is now `done`. Workspace-owned
`config/ask-rules.json` v1 rules are strict, normalized, source-bound, and
model-free; enabled exact-prefix matches produce an inspectable receipt with
original and stripped text, routing evidence and ignored candidates, extracted
fields, link candidates, attachment inventory, processors, proposed writes,
non-actions, and approval gates. `arcadia ask-rule test` runs the same matcher
and extractor without writes. Focused refusal and regression coverage proves
the `songbook` boundaries, explicit `--project arcadia` precedence, stable
normalization, and pre-write rejection of invalid rule state; the full suite
and build pass. The pointer moves to `unify-ask-capture-envelope` so text,
links, and attachments share one immutable capture and derivation record.

`unify-ask-capture-envelope` is now `done`. Dashboard text, file-only, and
combined submissions carry one caller-generated request id into an atomic,
idempotent capture envelope. The envelope preserves original text and submitted
URLs, proposes but never follows known Google wrapper targets, hashes every
attachment, retains duplicate original filenames with collision-free storage,
and labels metadata, text extraction, transcription, OCR, and media-analysis
results independently. Both Dashboard paths return the same compact receipt;
downstream ingress processing reuses the immutable envelope. Eighteen focused
tests plus the 1,146-test full suite and both production builds pass. The
pointer moves to `build-guided-understanding-session` to turn that receipt into
the editable, corrigible operator interaction defined by Decision 0035.

On 2026-09-01 the operator changed the priority before that unstarted UI slice.
Decision 0039 activates `agent-ask-execution-queue`: coding agents get a
conventional Ask contract for proposing any useful Project-management
contribution, accepted Actions enter one explicit portfolio order, and the
Dashboard makes the whole queue plus Arcadia's next eligible choice legible and
easy to rearrange. The queue orders canonical Actions rather than creating a
second task model; readiness, dependencies, Decisions, responsibility, and
authority remain enforced. The completed Ask routing and capture work stays
accepted, while the guided understanding session, rule management, and Songbook
dogfood wait for accepted agent-managed queue proof before reprioritization.

`define-agent-ask-management-contract` is now `done`. `agent-ask preview`
accepts strict Agent Ask v1 YAML for every supported Project-management intent
or an explicitly keyed natural `auto` fallback, preserves immutable capture and
proposal receipts, previews canonical create/update/interpret effects, and
withholds every Project, managed-document, and queue change until acceptance.
Explicit Projects resolve before capture; Decisions remain open; unknown fields,
unsafe authority claims, malformed strict input, and changed request-id replays
are refused before contradictory writes. Eight focused scenario groups, the
1,153-test full suite, and the core/Discord build pass. The pointer moves to
`establish-approved-action-queue` so accepted work can receive one explicit,
explainable portfolio order.

`establish-approved-action-queue` is now `done`. The Agent Queue projects every
approved unfinished Action in each active Project into one revisioned order,
keeps blocked and responsibility-owned work visible with its reason, refuses an
unpositioned Action as invalid priority, and selects only the first eligible
Action whose checked-in Project pointer grants dispatch authority. Operators
can preview and atomically apply top/before/after moves or complete batch order,
use optimistic revisions and idempotent request ids, and restore the current
order from a durable undo receipt. `advance queue make-next` separately previews
the exact Project and active Plan patch and requires its fingerprint before
changing governed dispatch truth. The full suite passes 1,154 tests with 6
skipped; core, Discord, Dashboard production, and package-boundary builds pass.
The pointer moves to `connect-agent-ask-to-queue` so accepted proposals create
canonical Project effects, enter this order explicitly, and issue the approved
Discord settlement ping.

The operator additionally approved Decision 0040 on 2026-09-01: after an Agent
Ask reaches a durable settled disposition, Arcadia will send one retry-safe ping
through its configured Discord channel with a brief summary of the Project,
disposition, canonical effects, Decisions, queue placement, and resulting next
eligible Action. Previews, refusals, conflicts, and partial persistence do not
send settlement pings. Delivery failure remains observable and retryable without
rolling back Project truth or duplicating the notification.

The first `connect-agent-ask-to-queue` vertical slice now works for strict new
Action proposals and for rejection of any proposal. Fingerprinted acceptance
creates and syncs the canonical active-Plan Action, assigns the operator-approved
Responsibility and explicit queue position, and records a pending Discord
effect summary; the bot acknowledges delivery only after a successful send.
The Action remains current while accepted non-Action effects, amendments,
correction, and mixed-granularity settlement are extended through the same
receipt path.

Accepted settlement now covers every Agent Ask v1 intent with the smallest
canonical effect: Outcome and Milestone updates, draft Plan creation or named
Plan amendment, named Action amendment, open Decisions for decision/auto or
ambiguous Project updates, planned Artifact references, Project Log entries,
and evidence-only proposals. All reuse existing truth stores and feed the same
Discord settlement receipt. The current Action remains open for strict
multi-Action settlement, correction and stale-amendment conflict proof before
the pointer advances to the operator queue Dashboard.

On 2026-09-01 a live dogfood of that Ask-and-queue path ran end to end and
exposed two defects inside its own milestone. A natural-language Ask that named
an existing plan, Action id, and Decision still produced only a generic
interpretation Decision (0042) rather than a concrete proposal, and that
Decision duplicated a question Decision 0041 already carried. Both are now
governed Actions in `agent-ask-execution-queue`, added through Agent Ask itself
rather than by hand. The same session proved the queue's reorder path — two
applied moves with before/after previews, optimistic revisions, and undo
receipts — and proved that queue order does not grant dispatch authority: two
Arcadia Actions sat at positions 0 and 1 as `waiting_for_pointer` while Arcadia
dispatched a pointer-authorized Action beneath them and said why.

Decision 0043 then moved the pointer to `way-delivery` at
`evaluate-document-triggers`. The pointer had been parked on
`dogfood-agent-managed-queue`, which is `requires_review` and therefore
undispatchable, so nothing in Arcadia was startable. The triggers Action is
clarified, codex-owned, session-sized, and zero-model, and it closes a standing
contradiction: nine Arcadia documents declare deferrals with reviving
conditions, the continuation protocol says a firing trigger outranks
`current_action`, and until now no command could evaluate a single one.
`agent-ask-execution-queue` is paused, not superseded — it keeps its active
status, its two new Ask-quality Actions, and its open dogfood question, and
Decision 0042's answer still governs what reactivates after it.

Activating the plan also surfaced a real queue behavior worth remembering: four
newly active Actions arrived with no explicit queue positions, which set
`orderValid` to false and made the selected next Action `None` rather than
letting Arcadia infer priority from document order. One explicit placement
restored a valid order.

`accept-upstream-proposals` is now `done`. A 2026-09-04 cloud session with no
reachable Arcadia workspace found the code already complete and merged
(commit `1b8e3b0`, present on `main` before this session began): `proposal`
parses as a first-class document keyed on its question, `docs sync` ingests
each as a `WayProposal` review item, `arcadia portfolio` lists unresolved ones
under "Waiting on you" and stops once a Decision closes them, and the shared
AGENTS.md region states the file-a-proposal rule. `tests/upstream-proposals.test.ts`
passes 8/8 and the full suite passes 1,199 of 1,207 (7 skipped, 3 files
failing on a pre-existing dashboard workspace-link error and an unrelated
Obsidian-memory assertion, both present before this session and untouched by
it). No code change was needed, so nothing was pushed. The pointer moves to
`adopt-operator-task-ledger`, the next executable Action in document order;
`carry-decision-options` and `stop-dumping-rationale-into-recommendation` are
also open but not currently executable — their `next_action` fields do not
begin with a concrete verb, a control-document defect worth repairing in a
future session rather than silently skipped.

Because this container has no `ARCADIA_WORKSPACE`, `arcadia next`,
`arcadia work done`, and `arcadia agent-ask preview` all refuse with
"Arcadia workspace is not configured" — the workspace is the operator's
private operational data and lives outside this repository. This pointer move
and result are recorded directly in the checked-in documents, which are
authoritative per `docs/managed-documents.md`; a session with the operator's
workspace can run `docs sync` to reconcile the database projection.

`adopt-operator-task-ledger` is now `done`. `.arcadia/operator-tasks.jsonl`
is an append-only, repo-local ledger promoted from PPN's ADR 0025 by
Decision 0028 — deliberately no workspace and no database, the same shape
as `resolveDispatch` and `evaluateTriggers`, since an agent raising a task
is often reporting exactly the environment gap (no reachable workspace, no
credential) that would make a database-backed ledger unusable when needed
most. `arcadia operator-task raise` requires an origin already in project
control (an Action id or a Decision id) and a `--because`; `evidence`
attaches an agent's non-binding note without closing anything; `close` and
`decline` are terminal, operator-only, and refuse without an explicit
`--operator` flag. `docket` now reports the open count so entries surface
without a separate hunt. Verified with 13 new tests, the full suite (1,225
passing, 7 skipped, the one pre-existing unrelated Obsidian-memory failure
untouched), and a clean typecheck. The pointer moves to
`rename-codex-responsibility-to-agent`, the next executable Action in
document order; `carry-decision-options` and
`stop-dumping-rationale-into-recommendation` remain open but not yet
executable for the same next-action-defect reason noted above.

## Links

- `docs/COMMANDS.md` — the operator-facing command guide
- `docs/plans/` — one file per initiative, each a managed document
- `CONSTITUTION.md`, `OPERATOR_CONTEXT.md` — standing constraints and context
