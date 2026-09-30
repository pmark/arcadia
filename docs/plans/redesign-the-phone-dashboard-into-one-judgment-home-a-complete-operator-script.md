---
arcadia: v1
type: plan
slug: redesign-the-phone-dashboard-into-one-judgment-home-a-complete-operator-script
project: arcadia
status: draft
milestone: Redesign the phone dashboard into one judgment home, a complete operator-script flow and a Runs home for in-flight work and queued Plan Actions.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-09-30
actions:
  - id: add-single-decision-dashboard-page
    title: Build one operator judgment home with Decision, review, clarification and Agent Ask item pages, preserving the Decision 0076 deep-link and Discord notification contracts.
    status: open
    responsibility: agent
    effort: session
    next_action: Build one operator judgment home with Decision, review, clarification and Agent Ask item pages, preserving the Decision 0076 deep-link and Discord notification contracts.
    expected_artifact: Evidence satisfying Agent Ask add-single-decision-dashboard-page
    clarification: clarified
    confidence: high
    source: Agent Ask plan-phone-dashboard-judgment-actions-runs-2026-09-29-v2
    acceptance_criteria:
      - The dashboard serves a page at /review/<decision-ref> for one Decision, where <decision-ref> is its governed number (for example 0076) or its database id.
      - The page shows that Decision's question, every option with its consequence, the recommendation, and the same answer controls /review offers for its kind, reusing the existing review-action endpoint.
      - Answering from the page records exactly what answering the same Decision from /review records, and a test proves it.
      - An unknown or already-answered reference shows a clear not-found or already-answered state instead of an error, and a test covers each.
      - Each Discord notification that names a specific Decision includes a link to /review/<decision-ref> built from the configured ARCADIA_DASHBOARD_URL.
      - The requires-review summary lists one link per pending Decision instead of only telling the operator to run /arcadia review.
      - Formatter tests cover a single Decision, several Decisions, and a non-default ARCADIA_DASHBOARD_URL.
      - START_HERE.md's Answering Decisions section describes following the Discord link to answer a Decision.
      - /review is the sole judgment home for managed Decisions, review items, clarifications and Agent Asks; canonical source identities deduplicate overlapping Decisions; the approval queue is removed from /runs and replaced with a compact link.
      - Search and kind, Project, gate_question, age and operator-cost filters find focused and focused-out live items while lib/needs-you.ts ranking remains the default order; unavailable metadata is explicit.
      - Scoped stable item URLs show every applicable question or desired result, option consequence, recommendation, evidence and control, and retain the canonical answer or settlement receipt after reload; ambiguous governed numbers require a Project.
      - List acceptance is one tap against the consequence preview shown on that card; changed effects refuse rather than silently apply a new preview. Explicit execution confirmation, trigger-required deferral, feedback-required refinement and automatic clarification continuation retain their existing behavior.
      - On a cold /review navigation before its first poll, exactly one scoped judgment request is issued, with no full snapshot, Runs, operator scripts or logs; item pages load one scoped item and do not poll the list.
      - "pnpm dashboard:build, pnpm exec vitest run apps/dashboard and the full pnpm exec playwright test pass; needs-you-board.spec.ts retains its safety coverage and new Decision/Ask deep-link answer-to-receipt flows are covered; the PR QA Artifact contains request inventories and 390x844 screenshots with exact seeded and intended phone URLs."
    depends_on: []
    decisions: []
    references: ["docs/proposals/runs-page-information-architecture.md", "docs/reports/runs-page-surface-audit-2026-09-29.md", "docs/decisions/0077-choose-where-flight-deck-evidence-and-the-production-on-off-control-belong-in.md", "docs/decisions/0076-answer-decisions-through-discord-and-the-dashboard.md", ".arcadia/asks/archive/agent-ask-plan-single-decision-deep-link-2026-09-29.yaml", "START_HERE.md", "docs/planning-process.md", "docs/AGENT_ORIENTATION.md", "docs/arcadia-semantics.md", "apps/dashboard/app/review/page.tsx", "apps/dashboard/lib/needs-you.ts", "apps/dashboard/components/approval-queue.tsx", "apps/dashboard/app/api/approvals/route.ts", "apps/dashboard/app/api/review-action/route.ts", "apps/dashboard/app/api/clarify-action/route.ts", "apps/dashboard/app/api/review-focus/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "apps/discord-bot/src/formatters/requiresReviewFormatter.ts", "apps/discord-bot/src/config.ts", "tests/e2e/needs-you-board.spec.ts"]
  - id: build-operator-script-library-and-launch-evidence
    title: Build a searchable operator-script library, full per-script detail and a per-launch watch-and-result page with append-only history.
    status: open
    responsibility: agent
    effort: session
    next_action: Build a searchable operator-script library, full per-script detail and a per-launch watch-and-result page with append-only history.
    expected_artifact: Evidence satisfying Agent Ask build-operator-script-library-and-launch-evidence
    clarification: clarified
    confidence: high
    source: Agent Ask plan-phone-dashboard-judgment-actions-runs-2026-09-29-v2
    acceptance_criteria:
      - /actions searches title, problem, desired effect and id; filters needs attention, ready, running, failed and completed one-shot plus repeatable/one-shot; matching running and failed items stay pinned above descending updatedAt results.
      - /actions/[id] displays the entire validated descriptor including problem, desired effect, authority does/never_does, success/failure effect and next step; it shows current state and one Run or Retry control with an authority-restating confirmation before launch.
      - An authorized launch POST accepts only the library id, returns a server-created runId and navigates to /actions/[id]/runs/[runId]; each launch preserves append-only start/finish records, timestamps, exit code, descriptor/authority snapshot, deterministic script-directory binding, bounded log output, receipt and exact failure handoff.
      - Per-script history is paginated and loaded only when opened; successful one-shot scripts retain disabled succeeded state and their receipt permanently; repeatable scripts can launch again without overwriting previous attempts; legacy latest-state evidence is labeled without invented history.
      - Same-origin, strict id/descriptor/executable validation, lock and under-lock rechecks, successful one-shot refusal and main-checkout library authority remain enforced. Tests reject traversal, escaped symlinks, cross-script launch lookup, invalid ids and concurrent/duplicate launches.
      - Each library, detail or run-page cold navigation issues one scoped request before its first poll; history/log data is fetched only when displayed; running-state polling stops on terminal result, unmount and hidden page; a dead launcher fails truthfully.
      - Operator scripts and their poll are removed from /runs once the new flow works; a compact attention-count link remains, with stale/unavailable counts explicit.
      - "START_HERE.md documents the new start-to-result flow; pnpm dashboard:build, pnpm exec vitest run apps/dashboard and full pnpm exec playwright test pass, including search-to-script-to-confirmation-to-launch-to-result, retry and one-shot scenarios; the PR QA Artifact contains 390x844 screenshots of all new pages and states, exact URLs and measured request inventories."
    depends_on: [add-single-decision-dashboard-page]
    decisions: []
    references: ["docs/proposals/runs-page-information-architecture.md", "docs/reports/runs-page-surface-audit-2026-09-29.md", "docs/decisions/0077-choose-where-flight-deck-evidence-and-the-production-on-off-control-belong-in.md", "docs/decisions/0076-answer-decisions-through-discord-and-the-dashboard.md", ".arcadia/asks/archive/agent-ask-plan-single-decision-deep-link-2026-09-29.yaml", "START_HERE.md", "docs/planning-process.md", "docs/AGENT_ORIENTATION.md", "docs/arcadia-semantics.md", "apps/dashboard/app/api/operator-script/route.ts", "apps/dashboard/lib/operatorScriptRunner.ts", "apps/dashboard/app/runs/page.tsx", "apps/dashboard/lib/originGuard.ts", "artifacts/generated/operator-scripts/", "tests/e2e/fixtures/workspace.ts"]
  - id: focus-runs-on-active-work-and-next-push
    title: Focus Runs on active Sessions and Runs followed by the next push, preserve visible production control, reconcile queue and Flight Deck navigation and fix issue 809.
    status: open
    responsibility: agent
    effort: session
    next_action: Focus Runs on active Sessions and Runs followed by the next push, preserve visible production control, reconcile queue and Flight Deck navigation and fix issue 809.
    expected_artifact: Evidence satisfying Agent Ask focus-runs-on-active-work-and-next-push
    clarification: clarified
    confidence: high
    source: Agent Ask plan-phone-dashboard-judgment-actions-runs-2026-09-29-v2
    acceptance_criteria:
      - /runs leads with Active Sessions and execution Runs with existing Reattach/Resume behavior, followed by persistent Production On/Off and This push lanes, token points, Project queues and the actionable review boundary; Next push is one tap away and loads only when opened.
      - Delayed Production On/Off stays pending across queue or alert disclosure collapse/reopen, refuses a duplicate POST and stale GET overwrite, and resolves visibly to authoritative success or failure; an e2e regression proves issue 809 fixed.
      - History is one tap away, paginated and never fetched before navigation; history polling does not fetch active work or hidden panels. Cold /runs issues three scoped requests before its first poll, including attention counts, active work, production core and This push, with zero approval-list, descriptor-library, full-snapshot or history requests.
      - /work-queue redirects to /runs/queue, preserving filtering, reorder, exact-preview apply, cancel, undo and Make next with revision/fingerprint guards; /flight-deck remains standalone under More and is linked from Runs without a duplicate evidence board.
      - "Both chrome and sidebar use five labeled phone destinations: Today, Runs, Needs operator, Operator actions and More. Existing secondary routes remain reachable under More, active child routes are marked correctly and closed navigation does not fetch hidden contextual data."
      - Flight Deck and Runs reflect Domain, Project, Mission/Outcome, Milestone, Plan and Action through canonical structural references; Mission/Outcome remain Project context, Plan remains a managed document, and Action cards link their Artifacts, Decisions and Project Log. Missing and unattached relationships stay explicit; no title-based joins or new primary concepts are introduced.
      - Seeded 390x844 Playwright proof shows concurrent Sessions across two Projects and distinct Plans, multiple Runs for one Action, a completed Run awaiting acceptance, an Artifact awaiting a Decision and unattached evidence; links, five-state projection and pending controls remain independent and truthful.
      - Existing /runs/[id] details, Discord and bot base-URL links, bookmarked moved-route queries and guide links keep working; unavailable or stale attention counts never appear as zero; new user-facing labels obey docs/arcadia-semantics.md.
      - "START_HERE.md changes in the same PR; batch-push-view.spec.ts and needs-you-board.spec.ts move with behavior without dropping safety assertions; pnpm dashboard:build, pnpm exec vitest run apps/dashboard and full pnpm exec playwright test pass; the PR QA Artifact includes 390x844 changed-page screenshots, expanded Next push and toggle pending/result states, exact URLs and before/after request inventories."
    depends_on: [build-operator-script-library-and-launch-evidence]
    decisions: []
    references: ["docs/proposals/runs-page-information-architecture.md", "docs/reports/runs-page-surface-audit-2026-09-29.md", "docs/decisions/0077-choose-where-flight-deck-evidence-and-the-production-on-off-control-belong-in.md", "docs/decisions/0076-answer-decisions-through-discord-and-the-dashboard.md", ".arcadia/asks/archive/agent-ask-plan-single-decision-deep-link-2026-09-29.yaml", "START_HERE.md", "docs/planning-process.md", "docs/AGENT_ORIENTATION.md", "docs/arcadia-semantics.md", "apps/dashboard/app/runs/page.tsx", "apps/dashboard/hooks/use-runs.ts", "apps/dashboard/hooks/use-production-control.ts", "apps/dashboard/components/production-control-panel.tsx", "apps/dashboard/components/chrome.tsx", "apps/dashboard/components/sidebar.tsx", "apps/dashboard/app/work-queue/page.tsx", "apps/dashboard/app/flight-deck/page.tsx", "tests/e2e/batch-push-view.spec.ts", "tests/e2e/needs-you-board.spec.ts", "https://github.com/pmark/arcadia/issues/809", "apps/dashboard/lib/flight-deck.ts"]
questions: []
decisions: []
---

# Redesign the phone dashboard into one judgment home, a complete operator-script flow and a Runs home for in-flight work and queued Plan Actions.

Created as an inactive draft from accepted Agent Ask plan-phone-dashboard-judgment-actions-runs-2026-09-29-v2; creation changed no pointer. Current activation is recorded in frontmatter.
