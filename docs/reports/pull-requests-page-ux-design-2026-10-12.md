# Pull Requests Page UX Design

Design proposal · 12 October 2026 · Design only; no implementation

Make every PR a distinct card. Lead with its title and a prominent flag explaining whether it needs the operator or has a confirmed automatic merge scheduled. Follow with a short reason, compact merge evidence, any evidenced dependency, and one useful next step. Keep the original description, optional TLDR and audio inside that card.

The key distinction is **who must act**, **whether the merge gate passes**, and **whether automatic execution is actually scheduled**. A green GitHub status establishes neither authority nor execution.

## Goal and boundaries

The operator should be able to scan this page from a phone, identify their part, understand the change and merge an eligible PR without opening several GitHub tabs. Card clarity, ownership, dependency evidence and in-page merge are the core. TLDR is optional and never blocks them.

This proposal creates no Action, Decision, queue entry or merge authorization. The active Milestone concerns bounded production Sessions and clearing `/todo` stops. Its current Action, `attach-the-session-probe-result-to-the-reconcile-receipt`, is agent-owned and requires evidence that the Session probe and budget appear in the reconcile receipt. It does not govern this separate design request.

Non-goals: a new scheduler/review system, bulk merge, changing policy, automatic model calls, silently answering Decisions, deployment, service installation/restart or worktree management.

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
│ already answered. Operator merge needed. │
│                                          │
│ Review ✓  Checks 7/7 ✓  Merge state ✓    │ D
│ After #1401 ↗ · Declared dependency       │ E
│                                          │
│ [What changes ▾] [Evidence ▾]            │ F
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

**B–C:** Identity, full title, then one or two sentences explaining the actual reason and next step. An unanswered Decision gets an **Answer Decision 0122…** control with its real options and consequences; a generic approval never doubles as merge.

**D–E:** Three compact gate summaries and a linked dependency when applicable. “Review” means valid independent review; “Checks” means passed versus expected required jobs. Unknown is explicit. The card names both the authority reason and immediate blocker.

**F:** “What changes” holds TLDR, original description and reader. “Evidence” holds review/check details, source bindings, changed paths and dependency provenance. Critical authority warnings stay outside disclosures.

**G:** Once #1401 is confirmed merged and all other gates revalidate, this becomes an actionable **Merge into main…** button. Always name the actual target: a stacked child might instead say **Merge into feature/base…**. Disabled reasons are adjacent text with working evidence/remedy links.

## Ownership eligibility and scheduling

Use the same canonical operator-work projection as the To-dos page: `arcadia todo --all`, served through the shared approvals feed (`GET /api/approvals`). A PR's **Needs operator** flag must link to the same active item key, reason, source reference and resolution state. Match an explicit repository/PR or governed-record association, never a title or Project alone. Keep merge readiness and actual automatic scheduling separate. The current shared schema has no explicit PR-merge binding; extend that shared projection where needed rather than building a second PR-page classifier. Missing, stale or unavailable evidence stays unknown. Answering a Decision and completing a separate operator merge obligation remain distinct.

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

“What changes” exposes the **Original PR description** as GFM, with Source Markdown available. The current inventory's `summary` is readiness copy; `briefing.materialFacts` is deterministic evidence. Neither is a content TLDR. Generated summaries cover the title/body, not comments, the diff or review findings; they never supply authority or gate judgments.

Provide **Generate TLDR** independently from **Listen** when the optional integration is added: retrieve cached text without inference, and generate missing text only on a tap. Do not make someone generate audio to read a summary.

The merged PR1328 source already supports a bounded unpaid local TLDR and MP3, but presently starts both on Play: summary followed by the original description, with Markdown normalized for speech. Opening the page or original body triggers no model call. A failed TLDR falls back to original-body narration with an explicit label; no cloud fallback. Preserve native audio controls, seeking, download, visible preparation/errors and existing bounded retry. PR1328 was merged before this design was written; managed-service availability was not verified during design inspection.

Reuse that reader, label its current action **Listen: summary + description**, and split out optional text-summary retrieval/generation rather than pretending it exists already. Source freshness should bind title/body content separately from code head: body edits stale TLDR/audio, while code pushes stale merge proof. Mark older generated content and offer explicit regeneration. TLDR/audio failure never blocks scanning, evidence or merge. No automatic narration or inference on refresh.

## In page merge

1. **Merge into [target]…** obtains a fresh server preview without mutating GitHub. Bind configured repository/PR, exact head, base, merge method, authority, gate/dependency evidence and expiry to an opaque confirmation reference.

2. **Inline confirmation** shows title, branch → actual target, short/full head SHA, method and the passed gate. Example: “Squash-merge #1403 at a1b2c3d into main.” State any linked-Issue effect. Use the standing squash rule unless the governed path supplies a specific evidenced exception. Branch deletion, Decision settlement, installation/restart and deployment are separate operations.

3. **Confirm** revalidates current head/base/authority, all required jobs, independent review and clean merge state immediately before mutation. Use the provider's expected-head precondition. The browser supplies the opaque reference, not shell text, paths or self-asserted proof. Any drift disables confirmation and offers a fresh preview.

4. **Merging…** is a durable attempt, not success. Use one idempotent claim shared with any automatic executor. Disable duplicate taps. Manual takeover of a scheduled merge is available only if the backend can coordinate it safely; otherwise show its attempt.

5. **Merged** requires confirmed remote state, commit and receipt. Keep the completed card long enough to read it, preserve focus and refresh dependent PRs. A lost response shows **Checking merge result…** and reconciles the same attempt before Retry.

Decision 0060/0080 requires a valid independent review of the current head with no unresolved blocking finding, every required CI job green on that head, and clean merge state. Drafts cannot pass. Only the backend may recognize documented, proven review-carry-forward exceptions; they do not waive current checks or mergeability. Empty check lists are not passed proof. CodeRabbit is advisory and its silence/rate limit never blocks progress.

The target experience includes in-page merging for operator-owned PRs, conditional on resolving the authorization channel before activation. Important Decision/authority PRs remain Needs operator even when technically green. Current guidance specifically calls for operator chat instruction for those merges. Treating verified in-page confirmation as equivalent needs an explicit governance decision before enabling it. An answered linked Decision is not itself that merge instruction. A GitHub link with the in-page control disabled is an interim state while this integration is missing, not the intended final experience.

The documented application has no authenticated operator identity layer; same-origin guards alone do not prove who clicked. Before remote credentialed merging, establish the permitted caller and authorization through the reviewed deployment/execution boundary. Reuse validated operator-script/descriptor and receipt machinery where applicable, returning results into this card. A raw new shellout endpoint is insufficient. This is an integration gap, not permission granted by the design.

**Errors:** failing/pending/missing checks, stale/blocking review, drafts and conflicts disable merge with precise evidence/remedy links. No bypass control. Partial scans/outages retain stale cards and checked-at times; live preflight must succeed. Head/base/policy drift requires a new preview. A lost response reconciles one attempt; closed-unmerged is not success. Retry is offered only when safe. Remedies are remote-visible, not host terminal instructions.

## Accessibility

Cards are labelled articles with unique PR-scoped controls; no hover-only or color-only meaning. Minimum 44px targets, wrapping titles/branches and contained Markdown tables/audio prevent page-level horizontal scrolling at 320px or 200% zoom. Inline confirmation receives focus and returns it on Cancel. Announce progress politely and errors clearly. Disabled reasons remain accessible; evidence links still work. Refresh preserves focus, and reduced motion is honored.

## Existing capabilities and missing integrations

Source paths are repository-relative. The reader inspection used the published PR1328 source.

| Capability | Evidence and reuse | Gap for this design |
| --- | --- | --- |
| PR inventory, errors, card structure | `apps/dashboard/app/admin/pull-requests/page.tsx:13`, `:56`, `:102`; GET `apps/dashboard/app/api/pull-requests/route.ts:7` | Stronger hierarchy, filters, disclosure and inline merge state; current page is explicitly read-only. |
| Readiness and material facts | `src/workMonitoring/pullRequests.ts:23`, `:202`, `:361`, `:402`; matching DTO `apps/dashboard/lib/types.ts:434` | No head/base SHAs in inventory DTO, no expected required-check manifest, exact independent-review binding, authority assessment or automation execution record. Current `merge_ready` cannot authorize a button. |
| Observed stacking | `src/workMonitoring/pullRequests.ts:238`, `:378` | Repository-scoped dependency evidence with revisions, stale/cycle handling and current target. Existing sort is readiness/update time, not merge order. |
| Independent-review evidence and guarded integration | `src/production/independentReview.ts:411`; `src/production/sessionHandoff.ts:393`, `:422`; `src/qa/prReview.ts:710`, `:896` | Reuse proof concepts; do not equate production local fast-forward integration with a scheduled GitHub merge. Add an explicit projection/adaptor for PR gate evidence. |
| Shared operator To-dos and existing Decision controls | `apps/dashboard/lib/approvals-feed.ts:16`; `apps/dashboard/lib/arcadia-cli.ts:417`; `src/commands/todo.ts:81`; `apps/dashboard/app/api/approvals/route.ts:10` | Reuse the same canonical item key, source reference, pending/resolved state and controls. Add explicit PR/source association and any missing PR-merge obligation to the shared projection, not a separate PR classifier. The existing approval endpoint answers Decisions; it does not merge PRs. |
| Validated execution and receipts | `apps/dashboard/app/api/operator-script/route.ts:72`, `:179`; `docs/agent-guidance/operator-actions.md` | A reviewed, pinned merge operation with proper authorization, exact-head gate and idempotent outcome reconciliation. No general in-page PR merge endpoint was found in the bounded inspection. |
| PR1328 TLDR + MP3 | Read-only source: `apps/dashboard/components/pull-request-audio.tsx:8`, `components/read-aloud.tsx:18`, `lib/pull-request-audio.ts:9`, `app/api/pull-requests/audio/route.ts:13`; `docs/intelligence/READ_ALOUD.md` | Merged source inspected; managed-service availability was not verified during design inspection. Reuse after installation; optional source revision/cached-TLDR projection remains additional work. |

A future server projection should join the PR inventory to the canonical operator To-dos projection by explicit source association. Extend the common projection to represent an operator PR-merge obligation when existing items cannot express it, so the obligation appears consistently on both pages. Keep the same item identity, explanation, source and resolution rules; add PR identity/head references needed for safe display and execution. Project merge gates and actual automation attempts from their existing sources separately. Do not maintain a parallel operator queue, infer authority from a TLDR, or mark every PR in a Project as needing attention because that Project has an unrelated to-do.

## Acceptance criteria

- Each card is unmistakably separate on a phone, with identity, ownership, reason, compact gate and next step. Filters never hide scan incompleteness.

- Green GitHub status without current review/authority/scheduling evidence never enables merge or promises automation. Unknown stays explicit; missing executor alone never becomes Needs operator.

- Declared dependencies, observed stacks, advisory order and overlaps are distinguishable. Every merge CTA/confirmation names its actual target; no hidden retarget/rebase occurs.

- Stale head/base/policy, missing/failing checks, invalid review, draft and non-clean state refuse merge. Duplicate taps/lost responses reconcile one attempt; success requires a remote merge receipt.

- Important-Decision/authority PRs retain their operator boundary. Merge cannot silently settle Decisions, deploy, restart, delete branches or change the Action queue.

- Opening page/body starts no model/speech work. Optional written TLDR can be obtained without audio once its integration exists; source/errors are honest and never block the core page.

- Keyboard/screen-reader/320px/200%-zoom use covers actionable, disabled, stale and uncertain-result states. Future QA names a reachable URL and installed revision rather than claiming source code is live.

## Small future sequence

1. Improve the read-only cards, ownership/unknown wording, filters and dependency provenance. Reuse the installed reader when available.

2. Project exact-head gate, authority and actual execution records from existing sources; add required-check inventory and stale/contradictory evidence handling. No new scheduler.

3. Resolve the operator-channel/identity boundary, then connect pinned preview → confirmation → durable receipt through the governed path. Cover races and lost responses, update `START_HERE.md`, and perform independent review before shipping.

4. Add optional lazy/cached text TLDR separately from speech. Rich dependency visuals wait for stacks that need them; neither enhancement delays the core UX.

The remaining consequential judgment is whether verified in-page confirmation can replace the specifically required chat instruction for important-Decision/authority PRs. This proposal recommends that integration but does not authorize it. The visual design and honest read-only state projection do not depend on that decision.

## Design provenance

Prepared by the operator-requested heavy design sub-agent (GPT-6 Astra, high reasoning) on 2026-10-12, then clarified to require the same canonical operator-work source as To-dos. This is an ordinary design document, not a governed Plan, Action or Decision. Implementation begins only on a subsequent authorized request; recording this proposal does not change merge authority or activate an in-page merge endpoint. Source evidence and instruction-retrieval notes remain with the original design artifact.
