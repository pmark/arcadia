# Flight Deck: operator experience and execution contract

> Latest sequencing: [18](./18-bootstrap-then-dogfood.md) separates Managed
> Production bootstrap from Flight Deck. Build and prove the controller through
> the existing Work Queue first; use it to produce the real Flight Deck Actions.

> Production-first revision: [17](./17-managed-production-contract.md) now
> requires continuous, capacity-aware execution under an Active/Inactive policy.
> It replaces the original per-Session-only scope and scheduling deferrals.

Supplement to 09, based on the audit in 11 and operator direction on 2026-09-05.
This specifies proposed behavior; the Agent Ask in 14 carries the corresponding
managed Action amendments. It does not assert implementation or settlement.

## Product promise

Open Flight Deck first. Understand what is happening, what is planned, what
needs judgment, and the next safe move without reconstructing agent history.
Change priority, resolve a Decision, launch one automatically selected coding
agent, and see what actually happened. Every current fact has one authoritative
home; this surface projects and controls those homes through existing contracts.

The default route is `/flight-deck`; after operational acceptance `/` points
there. Now remains focused on the North Star, Path on the route to it, and
specialists remain directly reachable. Flight Deck owns the operational loop,
not every detailed editor. Desktop uses lanes/rail; phone uses grouped list/full
height detail with the same objects, choices, receipts and return context.

## First screen and progressive disclosure

1. **Orientation:** target/Outcome, current Milestone per selected Project,
   observed execution count, unresolved operator judgments, next eligible Action
   and why it was selected, recent verified changes. Portfolio scope is explicit.
2. **Needs operator:** cross-portfolio attention with the question, consequence,
   affected Action and stage. Global exceptions remain visible even if a filter
   hides their lane. Counts are of canonical obligations, not duplicated cards.
3. **Work:** active Plan lanes grouped by Project; inactive and unattached lanes
   collapsed, with counts. Stage is Needs operator / Ready / Running / Proving /
   Results. Results may show Landed only with evidence; maintain recognizable
   correspondence to 09's columns. Waiting/blocked states remain visible with
   owner and remedy, even when they do not fit a happy-path gate.
4. **Planned:** active/draft/dormant/completed Plans, Milestones, Action counts,
   dependencies, activation conditions, and gaps. Empty Plans and Projects with
   no active plan remain discoverable. Source links open existing Plan views.
5. **Capture:** project-scoped or portfolio-scoped intent entry and attachments,
   reusing Ask and capture receipts. The resulting proposal/question/Action link
   opens in context. Capture never implies execution approval.

Use tab-like views or concise sections, not a wall of every existing dashboard
widget. A visible reset returns to portfolio overview. Persist view preferences
only; URL carries selected object and scope so browser Back, reload, copied
links and specialist return restore context. A missing/deleted object displays a
clear explanation instead of silently opening another one. Search spans loaded
and retrievable portfolio records, reveals dormant matches, and labels coverage.

## Identity, state and truth rules

- Key every canonical object by Project plus type plus stable id/doc_ref. A
  queue entry and attention projection of the same Action are one Action card;
  a Run, Session and Decision remain distinct records with explicit relations.
- Columns show work stage; responsibility/waitingOn explains who can advance
  it. Do not derive judgment solely from failure, age, or column. Unknown states
  get a labeled visible fallback with source evidence, never silent omission.
- Show structural relationships as structural, prose-recovered links as named
  in prose, and ambiguous/missing links as unresolved. Prose cannot grant
  authority or select an Action. Validate references against the same Project.
- Detail exposes Outcome, Milestone, Action, next move, acceptance, expected
  Artifact, dependencies, Decisions/options, token budget, proof, Session/Run,
  source paths and freshness as relevant. Missing data is a named gap.
- Read active Sessions and active Runs independently of history limits. Keep
  recent results bounded with load-more/history and truthful totals; unknown
  totals stay unknown. Never label a loaded slice the whole portfolio.
- Queue nextActionKey decides the next eligible portfolio Action. The per-Project
  pointer and per-Action readiness remain separate, visible facts. Why not next
  exposes all higher skipped work and reasons; invalid order has a repair path.
- Browsing makes no governed writes and no model calls. Optional narrative or
  advice is a separately invoked capability with explicit provenance.

## Controls and receipts

| Intent | Flight Deck interaction | Existing authority boundary |
| --- | --- | --- |
| Change portfolio order | Top/before/after/up/down/batch, exact preview, Apply and Undo | Existing queue revision and receipt contract; not a pointer or execution grant. |
| Make an Action current | Show previous/next and exact managed pointer preview, confirm | Existing make-next fingerprint; revalidate dependencies and current documents. |
| Resolve a Decision | Options with consequences, recommendation as advice, reject feedback, defer trigger, or scoped reply | Existing review/clarification handlers; never offer approve as the only choice. |
| Propose changed work | Ask with explicit Project/Action context and preserved input | Preview → operator settlement; no browser-owned plan or Action state. |
| Prepare missing packet | Explain missing planning/build prerequisite and offer existing preparation path | Preparing is not launching; accepted planning does not silently authorize build. |
| Launch coding work | Show automatic selection, bounded scope and exact launch preview; operator clicks Launch | One Action, one packet, one selected binding, one isolated Session, current authorization. |
| Inspect/recover execution | Open Session details and native reattach/resume; inspect linked Run; request retry when supported | Exit is not completion; retry is the existing Decision flow, not blind replay. |
| Test/accept output | Show Stable/Candidate, exact revision, procedure, evidence and QA choices | QA evidence does not merge, publish, release or complete unrelated work. |

Managed-production activation and revocation follow the policy in 17; repeated
launch mechanics within that policy do not ask for another human confirmation.
Every mutation has pending/confirmed/refused/conflicted/unknown-result states.
A success toast alone is insufficient: show receipt, resulting state and next
available move. After an ambiguous timeout, reconcile by request id before
retrying. Preserve entered text on failure. Disable duplicate submission locally
and enforce it on the server. Preview cancellation makes no mutation.

## Automatic agent selection and launch

### Reuse and selection

Resolve the Action's existing portable execution profile (and the current,
explicitly documented legacy normalization when no profile exists). Reuse
`selectCompliantCodingAgent` and its configured profiles, adapter bindings and
availability. Show resolved agent/model/effort, selection rationale, mapping and
binding provenance, required tools/locality, intended repository and scope.
Do not ask the operator to pick Codex versus Claude in the ordinary flow.
A manual override is not required for v1. No weaker fallback, paid-credit/reset
consumption or invented quota estimate is introduced by Flight Deck.

The selected binding must have a supported, available launch adapter. Add Codex
alongside Claude in the canonical Session path. Apply launch-capability filtering
before selection or return a typed refusal; never select one agent and execute
another. Preserve an existing immutable packet's selection; if new selection is
needed, prepare a new bound packet and preview rather than rewriting provenance.

### Preview and apply contract

A launch preview performs no process creation or Git mutation. It binds Project,
Plan, Action/doc_ref, authoritative document revision, queue revision, packet id
and hash, required approved Decisions, selected mapping/binding/model/effort,
repository/base revision and intended worktree, plus an idempotent request id.

At Launch, the server resolves trusted configuration again and compares this
identity. Changed pointer, documents, packet, approval, repository or binding
requires a fresh preview. Unavailable provider gets a reason and safe next step.
No arbitrary browser path, command, model arguments or executable is trusted.
Use the canonical CLI/service boundary and argument arrays.

Host process execution requires an explicit operator action. Reject cross-origin
and malformed requests using the app's supported origin and request-token
strategy; preserve existing local/tailnet deployment assumptions without
introducing public access or a broad new identity product. Enforce one live or
prepared Session lease per canonical repository and account for existing managed
Runs before admitting competing work. Two tabs and aliases of one repository
must not launch overlapping work. Return a durable launch receipt that survives
browser reload, connection loss and server restart. A failed preparation records
recoverable state and does not remove someone else's worktree.

Launch may prepare an isolated branch/worktree. It must not implicitly integrate
prior work, merge, fetch with newly granted credentials, retire branches, deploy,
publish or send messages. Reuse/extract `go`'s preparation mechanics rather than
invoking its entire reconciliation operation. Expose required reconciliation as
a separate, explained existing operation with its own authority.

### Observe and continue

The Session view shows Action and packet, selected provider/model, host,
branch/worktree, native Session id, prepared/running/needs-input/exited/failed
observations, last checked time, and next remedy. Process liveness is not semantic
progress; do not label an idle but live process healthy progress. Native open,
reattach and resume instructions state the host on which they work. Phone users
can launch and observe from Flight Deck; terminal-only inspection is labeled.

Reuse the existing `idea-to-managed-build/reconcile-session-exit` contract and
implementation when available; add no parallel reconciler. A database-only
`work done` update is not canonical managed-document completion.
Reconciliation persists an exit receipt and links available Run/Artifact/Decision
proof. It checks canonical completion evidence rather than inferring done from
exit zero or a PR link. It makes the next Action/Decision visible through the
existing governance path and releases leases only on proven terminal state.
While Inactive, work never automatically chains into another launch. While
Active, the standing policy in 17 authorizes automatic admission of the next
eligible Action after reconciliation; new scope or consequential effects still
require their separate authority. Reprioritizing queued work
does not interrupt a running Session; say so beside the control. Arbitrary
mid-session chat, kill/pause controls and transcript ingestion are deferred;
existing native-session access is the first recovery route.

## Reliability and responsiveness

First slice must render its shell immediately and expose source-specific loading,
timeouts and retry within 12 seconds under the audit's stalled-source scenario.
Target useful orientation within 3 seconds in a documented healthy local fixture;
report measured live timing separately. Read-only, cheap independent sources
should render as they arrive; expensive PR/QA/AI work must not block the root.

One refresh owner coalesces requests, cancels obsolete ones, ignores late results,
refreshes on focus/reconnect, and refreshes affected sources after mutation.
Use existing 5-second active/45-second idle cadence as the starting bound, with
backoff on failure. No overlapping infinite process polls. Show generated/observed
age per source; a partial refresh is not a consistent cross-source transaction.
Disable dependent writes until the server can revalidate; keep independent reads
usable. Last-known state must be labeled and must never authorize execution.

Keyboard selection, focus trap/restore, Escape, Back and stable deep links are
acceptance requirements. Phone layout must not require horizontal board scrolling
to reach primary operations. Use text and icons as well as semantic colors.

## Scope precedence and completion

This contract proposes replacing 09's copy-only/no-process boundary with explicit
operator-triggered launch, and its no-new-CLI/table assumption with reuse-first
extensions where measured gaps require them. No new board state store is allowed;
a launch receipt/migration may be necessary in the existing Session subsystem.
The old two-endpoint limit and Artifact-equals-Landed rule are insufficient.
Docs 00–08 remain spatial/design background; doc 10's capacity deferral stays.

Complete means a real operator can orient, inspect planned work, change order,
resolve judgment, launch an automatically selected supported agent, observe its
Session, inspect/test its output and identify the next safe move, from the same
entry point. Prove this with deterministic failure scenarios and a real-week
rehearsal before switching the default entrance. Keep specialist URLs and a
reversible root-route change; retiring them requires separate approval.

## Every request for judgment has an answerable destination

Needs operator includes pending Agent Ask proposals as well as Decisions,
operator-task obligations, approval gates and QA judgments. These are projections
of their existing records; do not create duplicate Decisions merely to get a
proposal onto the screen. Every capture/preview requesting judgment returns a
stable direct review link. The operator never needs a YAML path, proposal id,
terminal command or remembered agent conversation to find or answer it.

Proposal detail shows a short question, why it matters, affected work, exact
before/after effects, recommended option and alternatives with consequences,
authority scope and any prerequisite such as queue placement. Accept/reject
uses the Agent Ask settlement contract, not generic review approval. A correction
creates a new explicit proposal version; stale evidence requires a fresh preview.
A pending obligation remains visible until its authoritative disposition is
recorded. Failed/unknown settlement shows recovery, never silent disappearance.
The confirmed receipt links the resulting work and names the next safe move.

Required regression: create a proposal in a coding-agent session, close that
conversation, open Flight Deck, find it under Needs operator, inspect effects
and answer it from that page. Repeat from its direct link on a phone. No CLI or
conversation lookup is permitted. A zero count must mean all configured review
sources were checked; otherwise display partial/unknown coverage.
