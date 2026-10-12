# Shared To Dos and Pull Requests Experience Requirements

Design proposal · 12 October 2026 · Design only; no implementation

Make To-Dos the primary management surface: the operator can understand and act on PR-related work there without visiting the Pull Requests page. Both pages embed the same PR card, summary, Markdown description, read-aloud player, merge preview and result components. Pull Requests remains a focused inventory and investigation view. Use progressive disclosure to keep scanning compact while preserving every useful action in place.

The key distinction is **who must act**, **whether the merge gate passes**, and **whether automatic execution is actually scheduled**. A green GitHub status establishes neither authority nor execution.

## Goal and boundaries

From a phone, the operator should be able to use To-Dos to identify what needs them, understand the associated PR, listen to its summary and description, inspect merge order and evidence, and complete an authorized merge. Visiting Pull Requests is optional. Both surfaces have equivalent PR capabilities; their selection, grouping and surrounding navigation differ. TLDR remains a nice-to-have and never blocks the core flow.

This proposal creates no Action, Decision, queue entry or merge authorization. The active Milestone concerns bounded production Sessions and clearing `/todo` stops. Its current Action, `attach-the-session-probe-result-to-the-reconcile-receipt`, is agent-owned and requires evidence that the Session probe and budget appear in the reconcile receipt. It does not govern this separate design request.

Non-goals: a new scheduler/review system, bulk merge, changing policy, automatic model calls, silently answering Decisions, deployment, service installation/restart or worktree management.

## To Dos as the management surface

To-Dos continues to show canonical pending operator work, rather than importing every open PR as a new task. An explicitly associated PR appears inside its existing To-do, with the shared PR card and all permitted controls. Important Decisions are proposed, decided, approved and enacted through their PRs; To-Dos presents that same lifecycle and action in place. One PR associated with several obligations is one resource with explicitly identified scope. Several associated PRs appear as distinct cards within the work item.

Provide a Pull requests filter within To-Dos for associated pending work. A secondary, collapsed Related PR activity section may expose explicitly associated automatic, blocked or recently completed PR activity without counting it as an operator To-do. The dedicated Pull Requests page remains the complete inventory. Unknown associations are visible as missing context; never manufacture obligations from titles, Project membership or absent automation. This preserves a single place to manage operator work without turning the To-do count into an open-PR count.

## Shared components and service contract

| Shared unit | Required behavior on both pages |
| --- | --- |
| PR card | Repository and PR identity, full title, actual target, canonical operator reason, compact readiness, dependency and confirmed execution state. |
| PR details | Optional TLDR above the original Markdown body, with source revision, freshness and source links. |
| Read aloud | Play from the compact card; expanded playback, seek, speed, retry and MP3 download where supported. Narration begins with TLDR when available, then description. Comments remain outside this scope. |
| Merge controls | Same permitted action, pinned server preview, explicit confirmation, drift refusal, durable attempt and verified receipt. |
| Evidence and dependencies | Same review, required checks, authority, source freshness and sourced merge-order information. |

Use one shared PR resource keyed by repository and PR number, with explicit canonical To-do associations. Keep the code head/base revision distinct from the title/body content revision. A common server projection supplies facts and permissions; page adapters select and arrange resources without reimplementing eligibility, operator classification, summary generation or merge logic. Reuse the existing reader and Intelligence audio service. Component names and exact file boundaries are implementation choices, not a requirement for a generic task framework.

Both surfaces invoke the same backend merge operation and observe the same attempt. Concurrent tabs, page switches and an automatic executor cannot create duplicate attempts. Confirmed remote results refresh the PR resource and reconcile associated To-dos through their owning source rules; a local success badge or hidden card is never task completion evidence. Keep the receipt visible before a resolved item leaves the pending list.

TLDR and audio assets are shared across surfaces and keyed by source content revision and generation settings. Selecting Play reuses a matching MP3 or requests generation; opening a page or disclosure starts no inference or speech. Cached TLDR is displayed without generating speech. If no TLDR exists, use the existing summary-plus-description generation flow where available; any later body-only option must label its narration scope. Stale assets are labelled and never silently replace current content. Audio failures leave text and merge controls usable.

## Progressive disclosure

| Level | Visible content and controls |
| --- | --- |
| Scan | Full PR title and identity; operator reason; immediate blocker or next step; compact readiness; actual merge target; direct Listen and permitted primary action; Details and Evidence controls. A cached TLDR may show two lines with an explicit expand control. |
| Understand | Expanded TLDR followed by the original Markdown body, full audio controls and MP3 download; related obligation controls and useful dependency context. Missing TLDR offers optional Generate TLDR without blocking reading. |
| Verify | Review and check receipts, exact revisions, authority source, dependency provenance, changed paths and execution history. |
| Commit | A focused confirmation naming the exact PR/head, actual destination, method and effect, followed by progress and a verified receipt. |

Do not hide the only usable action in a menu or require expansion merely to start listening. Merge preview opens its own confirmation without requiring body or evidence expansion. Avoid deep accordion nesting: one Details disclosure and one Evidence disclosure per card are sufficient; the long Markdown description can have a labelled Show full description control. Show a compact player while playback is active even if Details is collapsed. Starting another narration pauses the current one; no overlapping voices.

Disclosure, filters and deep links preserve orientation and keyboard focus across refresh. A cross-page PR deep link opens the same resource and requested section; playback position and active attempt are retained during dashboard navigation. Temporary presentation state is not a new truth store. Narrow screens use wrapping labels and 44px controls. Critical failures, stale merge proof and changed confirmation scope interrupt the relevant action visibly, even when evidence is collapsed.

## Shared experience acceptance criteria

- A phone operator can find a PR-associated To-do, understand it, listen, inspect evidence and complete a permitted merge entirely on To-Dos. Pull Requests is not a required step.

- Both pages render the same shared PR modules and invoke the same projection, asset service and mutation contract. The same PR revision produces matching reason, gates, target and execution state.

- Switching surfaces reuses the matching summary and MP3, retains playback position and observes the same merge attempt. Concurrent clicks or an automatic executor reconcile one attempt.

- A compact card exposes the operator reason, blocker, destination, Listen and primary action. Collapsing details never hides active playback or a material authority warning.

- TLDR precedes Markdown and narration when available. No automatic generation occurs on load, refresh or expansion; stale content and failed generation remain legible.

- Important Decisions show their linked PR, proposal, operator approval and verified enactment state on both pages. Only explicitly scoped Decision effects reconcile after the verified merge; unrelated obligations retain their canonical identity. Related activity does not inflate pending operator counts.

- Keyboard, screen reader, 320px viewport and 200% zoom QA exercises both surfaces, all disclosure levels, active audio, confirmation drift, duplicate submission and lost-response recovery.

## Page and card hierarchy

Use one column on phone and desktop, with a visible border, contrasting panel surface, 16–20px padding and 16–24px gaps between cards. Keep the existing palette; strengthen the separation between PRs while making sections within a card quieter. Long titles wrap fully. The card itself is not a link.

Replace passive metric tiles with filter buttons: **All**, **Needs operator**, **Automatic merge scheduled**, **Blocked**, **Drafts**. Add Project and search filters. Counts can overlap; show “Showing 8 of 14”. Failed Project scans stay visible, so an empty filter cannot imply a complete portfolio scan.

Default groups:

1. **Needs operator** — verified operator-only work, actionable first, then blocked with the reason visible.

2. **Automatic merge scheduled** — confirmed waiting/running execution; failed or stalled attempts first.

3. **Other open PRs** — agent repair/review, ready without scheduled execution, and unknown authority/automation.

4. **Drafts** — collapsible when other PRs exist.

An alternate **By dependency** view groups evidenced stacks by repository. It only changes presentation, never governed Action order. Preserve URL filters, card deep links and focus during refresh; announce changes rather than moving the focused card.

### Annotated mobile card

Illustrative data only; these are not current PR facts.

```text
Pull requests                          Refresh
8 open · 3 Projects · Checked 20s ago
[All 8] [Needs operator 2] [Automatic 3] …
[Project: All v] [Search…]

Needs operator (2)

┌──────────────────────────────────────────┐
│ ! NEEDS OPERATOR · YOUR MERGE            │ A
│ Arcadia · pmark/arcadia · #1403           │ B
│ Record the approved authority change     │
│                                          │
│ Carries important Decision 0122,          │ C
│ approved, not enacted. Merge needed.     │
│                                          │
│ Review ✓  Checks 7/7 ✓  Merge state ✓    │ D
│ After #1401 ↗ · Declared dependency       │ E
│                                          │
│ [Listen] [Details ▾] [Evidence ▾]        │ F
│ [Merge into main… disabled]              │ G
│ Waiting for #1401 to merge.               │
│ View on GitHub ↗           Checked 20s ago│
└──────────────────────────────────────────┘
                     20px gap
┌──────────────────────────────────────────┐
│ ↻ AUTO-MERGE SCHEDULED                   │
│ …next PR's own identity and title…       │
│ Arcadia is waiting for the final check.  │
│ Review ✓  Checks 6/7 …  Merge state ✓    │
│ Last activity 20s ago · View attempt      │
└──────────────────────────────────────────┘
```

**A:** A full-width ownership strip, not a tiny readiness badge. Gold/person icon means Needs operator; steel/clock means confirmed scheduling; neutral/question icon means unknown. Clay marks failure. Text carries the meaning independently of color.

**B–C:** Identity, full title, then the important Decision's proposal and current stage: Needs your decision, Approved · not enacted, or Enacted via merged PR. Show the actual options and consequences. The focused PR confirmation explicitly names the decision being approved and the merge that will enact it; no generic approval label.

**D–E:** Three compact gate summaries and a linked dependency when applicable. “Review” means valid independent review; “Checks” means passed versus expected required jobs. Unknown is explicit. The card names both the authority reason and immediate blocker.

**F:** Compact actions include **Listen**, **Details** and **Evidence**. Details reveals the optional TLDR above the original Markdown description and the full reader. Evidence reveals review/check details, source bindings, changed paths and dependency provenance. The operator reason, immediate blocker, uncertain state and critical authority warnings remain visible when collapsed.

**G:** Once #1401 is confirmed merged and all other gates revalidate, this becomes an actionable **Merge into main…** button. Always name the actual target: a stacked child might instead say **Merge into feature/base…**. Disabled reasons are adjacent text with working evidence/remedy links.

## Ownership eligibility and scheduling

Use the same canonical operator-work projection as the To-dos page: `arcadia todo --all`, served through the shared approvals feed (`GET /api/approvals`). A PR's **Needs operator** flag must link to the same active item key, reason, source reference and resolution state. Match an explicit repository/PR or governed-record association, never a title or Project alone. Keep merge readiness and actual automatic scheduling separate. The current shared schema has no explicit PR-merge binding; extend that shared projection where needed rather than building a second PR-page classifier. Missing, stale or unavailable evidence stays unknown. Project the Decision-through-PR lifecycle from that shared source: Needs your decision → Approved · not enacted → Merging → Enacted via merged PR. Approval and enactment are distinct states in one workflow; neither requires the operator to visit a second page.

| Evidence | Prominent wording and behavior |
| --- | --- |
| Important Decision or authority change requires operator | **Needs operator**; name the source and whether an answer or merge is outstanding. |
| Authorized executor has accepted this PR/head for merge | **Auto-merge scheduled**; name executor, waiting condition, freshness and attempt link. |
| Executor is submitting merge | **Merging**; disable duplicate submissions. |
| Fresh evidence positively confirms no scheduled execution | **No auto-merge scheduled**; separately show eligible/waiting/blocked. |
| Scheduling information missing or unreadable | **Automatic merge not confirmed**; never translate absence into “You must merge”. |
| Authority cannot be established | **Merge authority unknown**; withhold merge and identify missing evidence. |
| Scheduled attempt failed, paused or lost authority | **Merge failed** / **Automatic merge paused**, with reason and bounded remedy. |
| Remote merge verified | **Merged into [target]**, commit, time and receipt. |

Missing automation ownership alone never produces Needs operator. An agent-owned PR with failed checks normally needs agent repair. A changed Decision file is an assessment flag, not proof that the Decision is important or settled.

Scheduling requires an actual current execution record/provider state with owner, scope and authorization. Eligibility under Decision 0060/0080, production being Active, an open Session or a passed QA Decision is insufficient. If GitHub auto-merge is enabled but Arcadia's extra gate is unverified, say **GitHub auto-merge enabled; Arcadia gate not confirmed**, rather than promising compliant automatic action. Conflicting operator-only/automation evidence is prominent and cannot authorize execution.

## Merge order with provenance

Avoid a numbered total merge queue. Show “After #1401” / “Unblocks #1405” and, for real stacks, a compact chain. Sort only the evidenced relations; parallel siblings share a step. Updated time, PR number, CI completion and Action queue order are not dependency evidence.

Distinguish:

- **Declared dependency:** a governed prerequisite mapped to these exact PRs/heads; may be a hard gate where its source requires it.

- **Observed stack:** one PR's base branch matches another open PR's head. Label **Stacked on #1401 · branch evidence**. Recommend parent-first landing, but do not call that a declared semantic dependency.

- **Advisory:** body claims or reviewer suggestions, clearly attributed; not silently promoted into hard gates.

- **Overlap warning:** shared files or Decision documents; no precedence follows from overlap alone.

- **Unknown/conflicting:** incomplete scans, ambiguous mappings, cycles or contradictory evidence; show the limitation and withhold automatic sequencing where necessary.

Show the current base and intended final target for stacks. Merging into a feature branch is not merging into main. Recommend parent-first integration, then explicit authorized retarget/update and fresh head/check/review evaluation. Never hide retargeting, rebasing or base-branch deletion inside Merge. “No dependency recorded” does not promise independence.

## Optional TLDR and the original source

The collapsed card needs no summary. If a current cached TLDR exists, show up to two sentences labelled **Generated from PR description**, with expansion. Otherwise leave that space out.

“Details” exposes the **Original PR description** as GFM, with Source Markdown available. The current inventory's `summary` is readiness copy; `briefing.materialFacts` is deterministic evidence. Neither is a content TLDR. Generated summaries cover the title/body, not comments, the diff or review findings; they never supply authority or gate judgments.

Provide **Generate TLDR** independently from **Listen** when the optional integration is added: retrieve cached text without inference, and generate missing text only on a tap. Do not make someone generate audio to read a summary.

The merged PR1328 source already supports a bounded unpaid local TLDR and MP3, but presently starts both on Play: summary followed by the original description, with Markdown normalized for speech. Opening the page or original body triggers no model call. A failed TLDR falls back to original-body narration with an explicit label; no cloud fallback. Preserve native audio controls, seeking, download, visible preparation/errors and existing bounded retry. The source is reported merged but not installed in managed services; live availability was not inspected here.

Reuse that reader, label its current action **Listen: summary + description**, and split out optional text-summary retrieval/generation rather than pretending it exists already. Source freshness should bind title/body content separately from code head: body edits stale TLDR/audio, while code pushes stale merge proof. Mark older generated content and offer explicit regeneration. TLDR/audio failure never blocks scanning, evidence or merge. No automatic narration or inference on refresh.

## In page merge

1. **Merge into [target]…** obtains a fresh server preview without mutating GitHub. Bind configured repository/PR, exact head, base, merge method, authority, gate/dependency evidence and expiry to an opaque confirmation reference.

2. **Inline confirmation** shows title, branch → actual target, short/full head SHA, method and the passed gate. Example: “Squash-merge #1403 at a1b2c3d into main.” State any linked-Issue effect. Use the standing squash rule unless the governed path supplies a specific evidenced exception. For an important Decision, confirmation explicitly states the proposed answer, scope and consequences alongside the exact change: Approve Decision 0122 and merge into main. A prior valid approval is shown rather than requested again. Persist auditable approval evidence before attempting merge; if merge fails, retain Approved · not enacted and offer safe retry. Decision record reconciliation follows the governed path after verified merge. Branch deletion, installation/restart and deployment remain separate operations.

3. **Confirm** revalidates current head/base/authority, all required jobs, independent review and clean merge state immediately before mutation. Use the provider's expected-head precondition. The browser supplies the opaque reference, not shell text, paths or self-asserted proof. Any drift disables confirmation and offers a fresh preview.

4. **Merging…** is a durable attempt, not success. Use one idempotent claim shared with any automatic executor. Disable duplicate taps. Manual takeover of a scheduled merge is available only if the backend can coordinate it safely; otherwise show its attempt.

5. **Merged** requires confirmed remote state, commit and receipt. Keep the completed card long enough to read it, preserve focus and refresh dependent PRs. A lost response shows **Checking merge result…** and reconciles the same attempt before Retry.

Decision 0060/0080 requires a valid independent review of the current head with no unresolved blocking finding, every required CI job green on that head, and clean merge state. Drafts cannot pass. Only the backend may recognize documented, proven review-carry-forward exceptions; they do not waive current checks or mergeability. Empty check lists are not passed proof. CodeRabbit is advisory and its silence/rate limit never blocks progress.

Important Decisions are decided, approved and enacted through pull requests. The shared card must present the proposed decision and exact change, capture the operator's explicit approval for that scope, and enact it through a gated merge. To-Dos hosts the complete experience; Pull Requests shows the same record and controls. Approval without a successful merge remains Approved · not enacted. A verified merge enacts the exact approved repository change, with PR, head and merge-commit evidence. These PRs require operator judgment even when technically green; agents cannot infer approval from passing checks.

The documented application has no authenticated operator identity layer; same-origin guards alone do not prove who clicked. Before remote credentialed merging, establish the permitted caller and authorization through the reviewed deployment/execution boundary. Reuse validated operator-script/descriptor and receipt machinery where applicable, returning results into this card. A raw new shellout endpoint is insufficient. This is an integration gap, not permission granted by the design.

**Errors:** failing/pending/missing checks, stale/blocking review, drafts and conflicts disable merge with precise evidence/remedy links. No bypass control. Partial scans/outages retain stale cards and checked-at times; live preflight must succeed. Head/base/policy drift requires a new preview. A lost response reconciles one attempt; closed-unmerged is not success. Retry is offered only when safe. Remedies are remote-visible, not host terminal instructions.

## Accessibility

Cards are labelled articles with unique PR-scoped controls; no hover-only or color-only meaning. Minimum 44px targets, wrapping titles/branches and contained Markdown tables/audio prevent page-level horizontal scrolling at 320px or 200% zoom. Inline confirmation receives focus and returns it on Cancel. Announce progress politely and errors clearly. Disabled reasons remain accessible; evidence links still work. Refresh preserves focus, and reduced motion is honored.

## Existing capabilities and missing integrations

Paths below are repository-relative. Reader source was inspected in the PR1328 candidate; managed-service availability was not verified.

| Capability | Evidence and reuse | Gap for this design |
| --- | --- | --- |
| PR inventory, errors, card structure | `apps/dashboard/app/admin/pull-requests/page.tsx:13`, `:56`, `:102`; GET `apps/dashboard/app/api/pull-requests/route.ts:7` | Stronger hierarchy, filters, disclosure and inline merge state; current page is explicitly read-only. |
| Readiness and material facts | `src/workMonitoring/pullRequests.ts:23`, `:202`, `:361`, `:402`; matching DTO `apps/dashboard/lib/types.ts:434` | No head/base SHAs in inventory DTO, no expected required-check manifest, exact independent-review binding, authority assessment or automation execution record. Current `merge_ready` cannot authorize a button. |
| Observed stacking | `src/workMonitoring/pullRequests.ts:238`, `:378` | Repository-scoped dependency evidence with revisions, stale/cycle handling and current target. Existing sort is readiness/update time, not merge order. |
| Independent-review evidence and guarded integration | `src/production/independentReview.ts:411`; `src/production/sessionHandoff.ts:393`, `:422`; `src/qa/prReview.ts:710`, `:896` | Reuse proof concepts; do not equate production local fast-forward integration with a scheduled GitHub merge. Add an explicit projection/adaptor for PR gate evidence. |
| Shared operator To-dos and existing Decision controls | `apps/dashboard/lib/approvals-feed.ts:16`; `apps/dashboard/lib/arcadia-cli.ts:417`; `src/commands/todo.ts:81`; `apps/dashboard/app/api/approvals/route.ts:10` | Reuse the same canonical item key, source reference, pending/resolved state and controls. Add explicit PR/source association and any missing PR-merge obligation to the shared projection, not a separate PR classifier. The existing approval endpoint answers Decisions; it does not merge PRs. |
| Validated execution and receipts | `apps/dashboard/app/api/operator-script/route.ts:72`, `:179`; `docs/agent-guidance/operator-actions.md` | A reviewed, pinned merge operation with proper authorization, exact-head gate and idempotent outcome reconciliation. No general in-page PR merge endpoint was found in the bounded inspection. |
| PR1328 TLDR + MP3 | Read-only source: `apps/dashboard/components/pull-request-audio.tsx:8`, `components/read-aloud.tsx:18`, `lib/pull-request-audio.ts:9`, `app/api/pull-requests/audio/route.ts:13`; `docs/intelligence/READ_ALOUD.md` | Reported merged but not installed in managed services; no live verification here. Reuse after installation; optional source revision/cached-TLDR projection remains additional work. |

A future server projection should join the PR inventory to the canonical operator To-dos projection by explicit source association. Extend the common projection to represent an operator PR-merge obligation when existing items cannot express it, so the obligation appears consistently on both pages. Keep the same item identity, explanation, source and resolution rules; add PR identity/head references needed for safe display and execution. Project merge gates and actual automation attempts from their existing sources separately. Do not maintain a parallel operator queue, infer authority from a TLDR, or mark every PR in a Project as needing attention because that Project has an unrelated to-do.

## Acceptance criteria

- Each card is unmistakably separate on a phone, with identity, ownership, reason, compact gate and next step. Filters never hide scan incompleteness.

- Green GitHub status without current review/authority/scheduling evidence never enables merge or promises automation. Unknown stays explicit; missing executor alone never becomes Needs operator.

- Declared dependencies, observed stacks, advisory order and overlaps are distinguishable. Every merge CTA/confirmation names its actual target; no hidden retarget/rebase occurs.

- Stale head/base/policy, missing/failing checks, invalid review, draft and non-clean state refuse merge. Duplicate taps/lost responses reconcile one attempt; success requires a remote merge receipt.

- Important-Decision/authority PRs preserve explicit operator approval. Their verified merge enacts only the approved Decision/change carried by that PR and reconciles its canonical record through the governed path. It cannot approve unrelated Decisions, deploy, restart, delete branches or reorder the Action queue.

- Opening page/body starts no model/speech work. Optional written TLDR can be obtained without audio once its integration exists; source/errors are honest and never block the core page.

- Keyboard/screen-reader/320px/200%-zoom use covers actionable, disabled, stale and uncertain-result states. Future QA names a reachable URL and installed revision rather than claiming source code is live.

## Small future sequence

1. Extract the shared PR resource and card/details/evidence/reader modules. Embed them in explicitly associated To-dos and the PR inventory with compact progressive disclosure. Do not duplicate classification or count informational PR activity as operator work.

2. Project exact-head gate, authority and actual execution records from existing sources; add required-check inventory and stale/contradictory evidence handling. No new scheduler.

3. Resolve the operator-channel/identity boundary, then connect pinned preview → confirmation → durable receipt through the governed path. Cover races and lost responses, update `START_HERE.md`, and perform independent review before shipping.

4. Add optional lazy/cached text TLDR separately from speech. Rich dependency visuals wait for stacks that need them; neither enhancement delays the core UX.

The operator's required product workflow is important Decisions decided, approved and enacted through PRs, available directly on To-Dos. Existing guidance treats Decision answers and PR merges as separate operations and requires chat instruction for important-Decision merges. Implementation must reconcile that guidance and the verified operator identity/authorization contract through the governed path before activation. This requirements update records the requested workflow; it does not silently amend policy or claim the integration already exists.

## Provenance and authority

Operator-requested requirements update on 12 October 2026 following PR #1334. The operator specified To-Dos as the single management surface, shared PR components on both pages, progressive disclosure, and important Decisions decided, approved and enacted through PRs. This document records those product requirements. It does not amend the Constitution, grant agent merge authority, settle a Decision, activate a Plan, or implement the workflow. Existing governance and operator authentication must be reconciled before enabling the proposed Decision-through-PR controls.
