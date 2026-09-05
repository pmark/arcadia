# Flight Deck: operational acceptance and QA Artifact

Proposed acceptance contract for the complete feature. No scenario below is
claimed passed by this documentation change. Use isolated fixtures for mutation
and failure tests; real provider execution requires its bounded authorization.

## Target and evidence contract

| Target | URL | Status at this audit | Start/recovery |
| --- | --- | --- | --- |
| Existing Arcadia dashboard | `http://127.0.0.1:3020/` | Local-only visit confirmed; redirects to Now. Some data sources timed out; see 11. | Existing checkout: `pnpm dashboard` when port 3020 is free; use managed service procedure if already managed, never start a second competing server. |
| Flight Deck Candidate | `http://127.0.0.1:3020/flight-deck` | Missing: this change is documentation only. | First implementation must supply an isolated Candidate, exact port and command. Do not overwrite the running Stable dashboard to manufacture a demo. |
| Configured tailnet dashboard | `http://arcadia-1.alpine-rattlesnake.ts.net:3020/flight-deck` | Flight Deck missing; phone/tailnet reachability not verified in this audit. | Use the configured host service only after authorized rollout; verify from intended device. |

Every implementation PR replaces the proposed Candidate URL above with its
actual target, source revision, local/LAN/remote reachability evidence and exact
start/recovery command. The URL is an output, not a guessed port. Preserve Stable.
For no-UI backend slices, provide deterministic fixture tests and request/receipt
Artifacts, then state the Action that will make a browser rehearsal possible.

## Journey matrix

| ID | Starting condition and operator procedure | Observable pass | Primary Action |
| --- | --- | --- | --- |
| J01 | Return after three days; open portfolio Flight Deck and identify objective, running work, next dispatch and judgments. | All four answers found in 30 seconds without agent transcript or raw document archaeology. Each answer links to its source context. | focus-the-board-on-active-work |
| J02 | Expand a dormant Plan, inspect one with no queue cards, search for an unattached Decision, then reset scope. | No object disappears; active/draft/dormant distinction, unknown relations and loaded/total counts remain honest. | expose-planned-portfolio-work |
| J03 | Open an Action, follow a Decision and its proof, open specialist detail, use Back, close with Escape. | Same selected object and filters restored; keyboard focus returns; all relationship edges are typed and provenance labeled. | open-the-object-detail-rail |
| J04 | Move a lower Action above another, preview, cancel, then preview/apply and Undo. | Cancel changes nothing; apply and undo return durable receipts and correct order/next Action. Reorder does not move the Project pointer or interrupt a Session. | reuse-queue-steering-controls |
| J05 | Select a ready non-current Action; inspect Why not next and Make next; alter the queue in a second tab before confirmation. | Exact pointer consequence displayed; stale operation refused with retained context; refreshed preview succeeds only for the intended Action. | reuse-queue-steering-controls |
| J06 | Resolve a contextual Decision, reject another with feedback, and attempt deferral with then without a trigger. | Options have consequences; missing trigger refused; resolution updates eligibility or shows the remaining blocker. Proving judgments remain Needs operator. | reuse-contextual-decision-controls |
| J07 | Open a clarified Action with no build packet; follow preparation and inspect pending planning approval. | Preparation and launch remain distinct; the board never reports Running or supplies fake build authority. | connect-action-to-launch-packet |
| J08 | With both launch adapters configured, preview and launch an eligible Action. Repeat fixture with each provider selected automatically. | Correct compliant agent/model/effort and rationale appear; one confirmed Session starts for the exact Action without provider choice or terminal work. | launch-selected-agent-from-flight-deck |
| J09 | Double-click Launch, retry same request, lose the response after spawn, restart the server and reload. | At most one process/lease; durable receipt resolves uncertainty; no automatic replay into another Session. | expose-guarded-host-session-launch |
| J10 | Change pointer, packet hash, approval or provider binding after preview; try a malformed/cross-origin request and a browser-supplied arbitrary path/command. | Every mismatched/unauthorized apply is refused before process creation, with a useful remedy; no worktree deletion or implicit Git integration. | expose-guarded-host-session-launch |
| J11 | Make all compliant providers unavailable, then restore one; also occupy the same repository through an alias/managed Run. | Explicit selection refusal or busy-repository state; no weaker substitution, overlapping launch, paid reset, or silent agent switch. | support-selected-codex-and-claude-sessions |
| J12 | Add more than ten newer terminal records while an older Run/Session remains active. Open Running and native Session details from phone and desktop. | Active work remains counted and visible; host/worktree/agent/observed time correct; terminal-only attachment is honestly labeled. | observe-portfolio-agent-sessions |
| J13 | End a Session successfully without acceptance evidence, fail another, and reconcile each twice. | Exit receipt persists once; first is awaiting proof, second has a remedy; neither fabricates done, duplicates a Decision, or auto-launches next. | reconcile-session-exits-to-next-move |
| J14 | Open a produced Artifact, inspect failed/stale QA, then fresh revision-bound Candidate evidence. | Artifact existence is not Landed; exact procedure/target and QA outcome visible; acceptance, merge and release stay separate. | reuse-proof-and-delivery-controls |
| J15 | Submit contextual text/files, retry same capture, inspect receipt and propose a correction. | Original input/provenance preserved; one request record; proposal is distinguishable from accepted work and execution. | capture-and-correct-work-in-context |
| J16 | Fail snapshot/queue independently, return a delayed old response, disconnect/reconnect and change tabs. | Healthy sections remain usable; after 12 seconds errors offer retry; stale state labeled; obsolete result cannot overwrite newer data or authorize a write. | project-plan-lanes-and-pipeline-columns / observe-portfolio-agent-sessions |
| J17 | Fire a deferral trigger, introduce a dispatch refusal/service exception and an operator-task obligation. | Canonical exception and remedy visible without visiting every admin page; ordinary dormant work stays calm and discoverable. | surface-operational-exceptions-and-changes |
| J18 | Complete J01–J08 with keyboard and narrow phone viewport; use search, Back and specialist return. | Equivalent choices and receipts; no horizontal scroll needed for primary operations; focus/touch/non-color cues usable. | complete-flight-deck-mobile-and-navigation-parity |
| J19 | Browse, filter, expand, search and read for a full fixture session; observe model-invocation and governance counters. | No governed document/queue revision change and zero model calls from browsing. Ordinary telemetry is not misrepresented as a governed write. | verify-flight-deck-operational-loop |
| J20 | Use Candidate as first stop for a real week, then inspect old bookmarks after approved cutover. | Operator accepts the complete loop; any missing live-provider proof is named; root opens Flight Deck and specialist/Discord links still work. | dogfood-flight-deck-as-operations-home / make-flight-deck-the-default-entrance |

## Test layers and required evidence

- Pure fixtures: identity accounting, every known/unknown state, structural/prose
  relations, attention ownership, history coverage and selection rationale.
- Core integration: packet/authority validation, provider launch arguments,
  path identity, lease concurrency, persistence/crash windows and reconciliation.
  Stub process execution and provider availability; normal tests call no model.
- Browser journeys: shared queue/Decision/proof parity on old and new surfaces,
  context preservation, failed/ambiguous mutations, desktop/phone and keyboard.
- Healthy performance fixture: useful orientation within 3 seconds, documented
  environment and portfolio size; separately report live source timings. Never
  hide a stalled source behind an overall healthy service badge.
- Real proof: exact Candidate revision, provider actually used, Action/Session
  identity, procedure, observed result and operator feedback. No credentials or
  private transcript data in committed evidence. A synthetic pass is labeled.

For each scenario record fixture/real, revision, command/procedure, expected and
observed result, evidence link and unresolved gap. Required repository checks
are the relevant Vitest suites and builds; shared contracts need package-boundary
checks, shared components need old-surface regression coverage. Do not repeatedly
run model QA on unready deterministic evidence.

## Real-week operator procedure

1. Open the supplied Candidate on the normal device at the beginning of work.
   Expected: objective, current execution, next choice and Needs operator are clear.
2. Follow one real Action through priority/judgment/preparation to Launch.
   Expected: automatic selection, bounded authorization and durable Session receipt.
3. Return later and inspect execution, output and its test procedure.
   Expected: fresh status or honest uncertainty, exact evidence, next safe move.
4. Capture a correction and inspect planned work beyond the active lane.
   Expected: preserved input, explicit proposal state and no surprise execution.
5. Record every detour and whether it was deliberate specialist inspection or
   required to reconstruct routine state. Repeat over a real week of normal use.
   Expected: routine loop succeeds from Flight Deck; product gaps are repaired
   before declaring home-page readiness.
6. Supply acceptance or one concrete correction against the frozen revision.
   Expected: cutover remains gated until the operator accepts the experience.

The operator procedure is the end-user procedure. This product is the operator's
execution surface. No separate customer workflow is invented for this feature.

## Stopping and release

A failed live scenario records its exact outside input or implementation gap;
time passing is not acceptance. Open a PR per completed slice with its QA plan.
Do not wait for all twenty Actions before preserving/reviewing code. Final
cutover follows recorded acceptance and carries a simple root/nav rollback;
specialist route retirement and public deployment remain separately governed.

## J21 — Find and answer an agent-created proposal

Create an Agent Ask Plan proposal, close the coding-agent conversation and open
Flight Deck. Expected: Needs operator includes it with Project context and a
direct link. Open it, inspect exact effects and approval scope, and accept or
reject. Expected: the canonical settlement receipt, resulting work and next
move appear without YAML, CLI or chat archaeology. Repeat with a queue-repair
prerequisite, stale proposal evidence, failed settlement and phone deep link.
The obligation must remain visible on failure; zero pending is never inferred
from an unavailable proposal source. This extends the projection and contextual
Decision-control Actions and is mandatory before home-page cutover.

## Managed-production acceptance (supersedes manual-only continuation)

| ID | Procedure | Required result |
| --- | --- | --- |
| J22 | Activate an approved scope with two dependent Actions; close the browser after admission. | A completes with canonical evidence, B starts without another operator chat or launch. No unapproved Plan or authority expansion. |
| J23 | Turn Off while an Action runs; race a second tick, delayed launch request and second worker. | No new launch after the acknowledged cutoff; already committed work is named, preserved and reconciled according to the displayed Off policy. |
| J24 | Restart worker/browser while Active, then repeat after Off. | Existing lease/receipt prevents duplicates; valid Active scope resumes after reconciliation, revoked scope stays off. Worker unavailable is not confused with Inactive. |
| J25 | Limit provider A, retain compliant capacity on B, then restore A. | Independent eligible work continues through B; observed capacity refresh readmits A without manual Session setup or paid/reset effects. Both real provider paths must be proven; synthetic depletion is labeled. |
| J26 | Reorder included Plans while work runs; block one Project on judgment; include a draft Plan outside the grant. | Existing queue segment receipts determine future order, running work is not preempted, unrelated authorized work continues and the draft is never silently activated. |
| J27 | Force validation failure, repeated repair failure, mid-Session exhaustion and missing completion evidence. | Bounded retry/checkpoint recovery preserves work, no fabricated canonical done, no infinite token-consuming loop, and one directly answerable operator obligation when required. |
| J28 | Leave production Active across a real capacity stop and recovery using configured provider observation. | Automatic recheck/resume with freshness and source evidence; unknown/paid mode never masquerades as free tokens, and manual refresh is not labeled unattended proof. |

The first real two-Action proof J22–J24 is the urgent vertical milestone. Full
acceptance requires J25–J28 plus the prior orientation/review/proof/phone
scenarios. Implementation work is not complete merely because a switch renders
or a worker process exists. A screenshot is not a continuous-production proof.

## Bootstrap and real Flight Deck dogfood

| ID | Procedure | Required result |
| --- | --- | --- |
| J29 | Start the proven production runtime with no Flight Deck route/component installed; use existing Work Queue controls. | Activate/observe/Off and two-Action rehearsal work without any Flight Deck dependency. |
| J30 | Activate Flight Deck scope after bootstrap acceptance; observe its first two real Actions and all human interventions. | Controller launches board then orientation after canonical gates; exact Session/runtime/policy/output receipts prove real work, with no manual session relay. |
| J31 | Edit/build Flight Deck in its Candidate worktree while the production worker is active; use independent Off/status, restart and controlled upgrade procedure. | The known-good worker stays on its pinned runtime, Candidate changes cannot replace it, and recovery preserves authority/leases/work. |

J29 is a bootstrap release gate. J30/J31 are mandatory early real dogfood, not
a final-week substitute. The Flight Deck dogfood Action records evidence against
actual board/orientation work, not a separately invented demo.
