# Runs page information architecture

Design proposal, 2026-09-29. This is supporting evidence for an Agent Ask,
not an activated Plan or permission to change production. Scope: the operator's
390×844 phone at `http://arcadia-1.alpine-rattlesnake.ts.net:3020`.

## Outcome alignment

**Outcome:** The operator can answer a judgment, execute an authorized operator
script, or monitor and steer production from the phone without hunting through
unrelated controls, losing evidence, or waiting for hidden data.

**Milestone:** Three separately reviewed slices deliver one judgment home,
the script start → watch → result flow, and a production-focused Runs home,
with measured request budgets and phone-width proof.

The request supplies the end state, constraints and ordering. No changes to the
Project's existing Outcome, Milestone, active Plan or queue are proposed here.
The standing Milestone is “Bootstrap managed production to run unattended from
the GitHub board”; its current Action is `limit-sessions-per-provider-account`.
This new work is Agent responsibility, design and build; required Artifacts are
this proposal, an inactive draft-Plan Ask, three slice PRs, executable validation
and 390×844 QA screenshots. Acceptance of the draft does not activate it.

**Vital few:** preserve the existing judgment writers and give each item a
URL; extend the existing script runner into an observable launch flow; reuse
the production and queue controls rather than creating another queue.
No new workflow engine, transcript store, analytics, generalized navigation
framework or log search engine is needed. Revisit those only when a concrete
operator flow cannot be completed with these surfaces. There is no new runtime
model inference; plan generation defaults to Medium Token Impact with one
bounded implementation and scoped review pass per Action. Repair rounds name
their failure and remain bounded by the existing CodeRabbit contract.

## Evidence

The [verified operation map and request budgets](../reports/runs-page-surface-audit-2026-09-29.md) record each operation, its operator cadence and API/writer. Live phone inspection found 162 approvals ahead of hidden production and active-work sections. The instrumented isolated fixture confirms two initial API requests on Runs, one on Review, one on Work Queue and two on Flight Deck. These are request counts; the slowest-call claim is not verified by a live latency comparison. Proposed after budgets are three on Runs and one per focused route; logs, history, alerts and Next push load only when requested.

## Recommended routes and phone flow

Five labeled primary destinations: **Today · Runs · Needs operator · Operator
actions · More**. Labels remain visible at 390px; targets are at least 44px.
Both chrome and sidebar share the same destinations and active-child behavior.
More groups existing routes, without removing their URLs: Projects (including
Path and Back Burner), Capture/Ingress, QA/PRs, and System
(Intelligence, Journal, Status, Reports and existing dashboard views).
More is a static directory: no portfolio shellout until a destination opens.
Sidebar contextual data loads only when the drawer is open.

| Route | Owns | Leaves out |
| --- | --- | --- |
| `/review` | All operator judgment: managed Decisions, review items, clarifications, Agent Asks. Ranked compact cards, search, kind/Project/gate/age/cost filters, Project focus. | Scripts and production controls. |
| `/review/decisions/[project]/[id]` | One managed Decision: question, all option consequences, recommendation, source/effects, answer controls, durable answered receipt. | Other queues. |
| `/review/items/[id]` | One operational review/clarification: existing kind-specific controls, plan/packet/evidence, outcome preview, receipt and continuation. | Managed Decision lookup by guessed title. |
| `/review/asks/[project]/[requestId]` | One Ask: desired result, rationale, current preview/effects/refusals/required Decisions, recommendation, Accept/Reject, durable settlement receipt. | Treating proposal options as disposition controls. |
| `/review/[decision-ref]` | Compatibility resolver for Decision 0076's existing draft: review database id or governed number; redirects to its scoped canonical item URL. Ambiguous portfolio numbers ask for Project; unknown and answered states are explicit. | Guessing which Project owns `0001`. |
| `/actions` | Operator-script library: search title/problem/effect/id, status and repeatability filters, descending updatedAt with running/failed pinned within matching results. | Script launch from an unexplained list button. |
| `/actions/[id]` | Full validated descriptor, latest state, one Run/Retry CTA, authority confirmation, history on demand. Completed one-shots retain disabled success and receipt. | Production Plan Action editing; heading says “Operator action”. |
| `/actions/[id]/runs/[runId]` | One script execution attempt: starting/running/terminal state, start/finish/exit, receipt, bounded log output, exact failure handoff. POST returns this URL; launch navigates here. | Replacing `/runs/[id]`, which remains the execution Run page. |
| `/runs` | Active Sessions/Runs first, then recorded production state and This push; Next push disclosure; compact counted links to judgment and operator-action attention; History and Queue secondary navigation; Flight Deck link. | Approval cards and script library. |
| `/runs/history` | Paginated recent execution Runs, stable detail links. Loads only on navigation. | Active polling or full portfolio snapshot. |
| `/runs/queue` | Existing Work Queue steering, with its own single payload and exact-preview/revision/undo safeguards. | Another read-only duplicate of the ordered queue. |
| `/flight-deck` | Standalone read-only portfolio evidence under More, linked from Runs. Phone-first Project/Plan filter and stacked state sections; wide grid remains useful on desktop. | A second evidence board inside Runs. |

`/work-queue` redirects to `/runs/queue`; `/flight-deck` keeps its existing URL
and moves under More. Redirects preserve query intent and existing bookmarked
links. `/runs/[id]` remains untouched; reserve static children in Next routing.
Bot `ARCADIA_DASHBOARD_URL` remains the base, not a new hardcoded host. Slice 1
supports the deep-link Ask's first Action and preserves its `/review/<ref>`
contract; the existing Ask's Discord formatter Action remains owned there.
Amend that unsettled scope through a newly keyed replacement Ask, preserving
every original deep-link criterion in the first slice and consolidating its
Discord follow-up there. Archive the original input and retire its pending
proposal before settling the replacement; never approve both as competing
Plans. The other two slices depend on the first slice.

### Judgment list safety and one-tap acceptance

Extend the existing ranking; keep its default ordering, focus exclusions,
duplicate and historical handling. Deduplicate managed Decisions mirrored as
review items by canonical source reference, never title similarity. Search can
find focused-out live items. Cost distinguishes operator attention from Token
Impact and deterministic settlement cost; unknown gate/age/cost is labeled
unknown, not invented.

For supported recommended outcomes, the server prepares an inspectable outcome
preview with current authority/effect fingerprint alongside the compact card.
The card shows the consequence beside its one-tap Accept/Approve control.
Stale previews refuse and refresh before applying; never silently preview a
different effect and immediately execute it. Details, alternatives, free-text
answers, refinement and evidence live on the stable item page. Existing
Approve & Run still requires its explicit execution preview/confirmation;
deferral requires a named trigger. No-options Decisions go to their answer
page rather than auto-choosing. Each kind uses its existing canonical writer.
Answered URLs remain useful after reload and show the saved receipt; pending
list membership is not the only detail lookup source.

The [surface audit](../reports/runs-page-surface-audit-2026-09-29.md) specifies the append-only launch evidence, deterministic directory binding, legacy handling and path/lock safety contract.

### Selected production control placement

Keep On/Off visibly on `/runs` in a small persistent status strip
below Active now and above This push, separate from disclosures. It is close
to the work it controls and usable as a stop control. Worker/provider status
remains visible; detailed alerts load when opened. Explicitly name recorded
scope before activation and retain the backend's revision/scope checks.

Fix #809 by owning pending mutation state above collapsible queue/alert
sections. A collapse cannot remount a second switch or forget an in-flight
POST. Disable duplicates until authoritative post-toggle status arrives;
refuse stale GET overwrite and retain a visible failure. Test a delayed POST,
collapse/reopen, exactly one launch, and correct terminal state. ## Slices and proof

1. **Judgment home and item pages:** replace the unsettled Decision 0076 Ask
   with its expanded first Action, preserving all original deep-link and Discord
   follow-up acceptance criteria. Add
   Agent Ask/review detail, filters, canonical deduplication, preview-bound
   one-tap acceptance and receipts. Remove ApprovalQueue from Runs in this
   slice once its new home works; keep a compact link there. Its Discord-link
   follow-up is consolidated into this same slice, not duplicated.
2. **Operator-script flow:** searchable/filterable library, full descriptor,
   authority confirmation, per-launch evidence/history and safety regressions.
   Remove script cards/poll from Runs only after this flow works.
3. **Runs and navigation:** Active now first, This/Next push, paginated History,
   Queue tab/route, standalone Flight Deck link, visible production control
   strip and #809 regression. Trim both navigation systems together.

Each slice gets one PR with `START_HERE.md` changes in that PR, dashboard build,
`pnpm exec vitest run apps/dashboard`, full `pnpm exec playwright test`, and
the CodeRabbit/required-check loop. Seed the existing isolated e2e workspace
and a temporary operator-script library with deterministic safe scripts; never
click live production or approvals for QA. Move `batch-push-view.spec.ts` and
`needs-you-board.spec.ts` assertions with their behavior, preserving preview,
trigger, refinement and receipt coverage. Add script search → detail → authority
confirmation → launch → result, retry/concurrent/one-shot/traversal cases, and
Decision deep link → answer → receipt/reload/unknown/answered/ambiguous cases.

PR screenshots cover empty, loaded, filtered, pending, failure and completed
states at 390×844, including every changed/new page and expanded Next push.
Name seeded local URLs separately from the intended phone URL. Never imply a
candidate is live at port 3020 before the reviewed change is integrated and the
service is verified. Match before/after request measurement windows and retain
the request inventory, timings and screenshot files in each QA Artifact.

## Operator choices, answered

The operator chose **Keep Flight Deck standalone** and **Visible On/Off on
Runs** in this session on 2026-09-29. Flight Deck retains its portfolio identity
under More; Runs links to it without duplicating the board. Start/stop remains
immediately available beside active work, with persistent pending state fixing
#809. The alternatives above are superseded by these answers; do not ask them
again. Record the answers through the canonical Decision writer and reference
that Decision in the Plan Ask.

The build sequence remains judgment home → script flow → Runs/navigation.
An inactive draft Plan preserves the scope without replacing the active
managed-production Plan or choosing queue placement. Build activation is a
separate governed transition after the operator accepts the prepared Plan.
