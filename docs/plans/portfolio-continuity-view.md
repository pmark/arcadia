---
arcadia: v1
type: plan
slug: portfolio-continuity-view
project: arcadia
status: draft
milestone: One portfolio or Project view tells the truthful story of past, current, planned, deferred, and Incubating work while conversation reliably preserves new ideas
token_impact: large
token_budget: "Build the read projection, ordering, filters, fixtures, and browser checks deterministically. Use model-bearing work for implementation, one visual review of the mobile and desktop view, and bounded diagnosis only when deterministic checks fail; conversational capture routing remains rule-first."
recommended_model: gpt-5.6-sol
recommended_reasoning_effort: high
updated: 2026-08-30
actions:
  - id: build-arcadia-now-vertical-slice
    title: Make the immediate next governed move obvious and tappable
    status: open
    responsibility: agent
    effort: project
    next_action: Implement one deterministic Arcadia Now snapshot and a phone-friendly Dashboard view that explains the current situation and exposes only typed, freshly revalidated transition options with explicit consequences and receipts.
    expected_artifact: A tested Arcadia Now CLI snapshot, mobile web view, and governed transition endpoint proving one safe end-to-end advance path
    clarification: clarified
    confidence: high
    source: Decision 0017 and the live Private Practice Now PR #39 orientation on 2026-08-15
    acceptance_criteria:
      - The snapshot names what materially changed, what needs the operator now and why, what can wait, the current Milestone, the recommended next Action, its work classification, and its required Artifacts.
      - The snapshot reuses existing managed-plan, Action, Decision, Run, pull-request, and attention-object reads and adds no second task store, priority engine, workflow language, or required model call.
      - The phone-friendly web view presents exactly one recommended primary option when exactly one governed transition is eligible; zero or multiple options are explained without inventing a choice.
      - Every option has a typed allowlisted operation and target, checkable prerequisites, a plain-language consequence, the expected next state, and any authorization or external-system boundary.
      - Invocation reloads live state, rejects stale or unsafe options legibly, behaves idempotently, returns an outcome receipt, and refreshes the briefing from authoritative state.
      - Merge, deployment, spending, outward messaging, credentials, and other protected operations retain their specific approval or confirmation gates and are never concealed by a generic Advance button.
      - One fixture reproduces the 2026-08-15 sequence in which PPN PR #39 is merged, the parsing anomaly is resolved, and the next portfolio move changes without manual queue repair.
      - START_HERE.md and the PR QA plan provide the exact local and phone-reachable URL, operator procedure, expected effects, and refusal behavior.
    decisions: ["0017"]
    references:
      - src/commands/docket.ts
      - src/workMonitoring/pullRequests.ts
      - src/dashboard/snapshot.ts
      - apps/dashboard
      - docs/decisions/0013-operator-briefing-and-feedback.md
      - docs/decisions/0014-tappable-operator-questions.md
      - START_HERE.md
    depends_on: []
  - id: define-portfolio-continuity-projection
    title: Define one truthful Past, Now, Next, and Later projection
    status: open
    responsibility: agent
    effort: session
    next_action: Specify and implement a read-only projection over existing managed plans, Actions, Decisions, Runs, Artifacts, Logs, and Incubating material, with portfolio scope and an optional Project filter.
    expected_artifact: A typed continuity snapshot and fixture suite that explains placement and ordering for every supported Arcadia record
    clarification: clarified
    confidence: high
    source: Decision 0016 and operator direction on 2026-08-15
    acceptance_criteria:
      - The projection exposes four distinct horizons: Past, Now, Next, and Later, at portfolio scope or filtered to one Project.
      - Past uses observed timestamps from completed Actions, Decisions, Runs, Artifacts, and Logs; unknown timestamps remain unknown rather than inferred.
      - Now identifies the authoritative current Action, active Runs, open Decisions, and blocked Actions without confusing merely ready work with current work.
      - Next preserves managed-plan pointer, dependency, and Decision order without inventing calendar dates or automatic priority.
      - Later distinguishes draft plans, explicitly deferred Actions with reactivation triggers, and Incubating material.
      - The projection reuses existing source records and adds no second timeline, planning, or execution store.
      - The existing orientation timeline retains its separate capacity-to-scale behavior and contract.
    decisions: ["0016", "0017"]
    references:
      - src/dashboard/snapshot.ts
      - src/docs/dispatch.ts
      - src/docs/journal.ts
      - src/orientation/timeline.ts
      - src/backBurner
      - docs/arcadia-semantics.md
    depends_on: [build-arcadia-now-vertical-slice]
  - id: build-portfolio-continuity-view
    title: Make the whole portfolio story navigable in one view
    status: open
    responsibility: agent
    effort: project
    next_action: Build a mobile-first Dashboard view over the continuity snapshot with portfolio and Project scope, compact horizon navigation, source links, and truthful empty or unknown states.
    expected_artifact: One responsive portfolio continuity view that makes past, current, next, deferred, and Incubating work legible without visiting separate queues
    clarification: clarified
    confidence: high
    source: Decision 0016
    acceptance_criteria:
      - The operator can switch between the entire portfolio and one Project without leaving the view.
      - Past, Now, Next, and Later remain visually and semantically distinct on phone and desktop.
      - Every row names its Project, canonical object type, status or horizon reason, relevant time when known, and direct detail or source link.
      - Deferred work shows the condition that will reactivate it; an item without a trigger is not presented as truthfully deferred.
      - Incubating ideas are visibly not commitments, while current and pointer-selected Actions are unmistakable.
      - The view does not require model output, calendar scheduling, inferred completion dates, or a new persistence layer.
      - Existing Project, Decision, Run, Back Burner, and Mission Control detail remains reachable rather than duplicated wholesale.
    decisions: ["0016"]
    references:
      - apps/dashboard
      - apps/dashboard/lib/arcadia-cli.ts
      - apps/dashboard/lib/types.ts
      - START_HERE.md
    depends_on: [define-portfolio-continuity-projection]
  - id: make-conversation-capture-explicit
    title: Give every tangential idea a visible Arcadia capture receipt
    status: open
    responsibility: agent
    effort: session
    next_action: Add and document a conversation handoff contract that preserves materially separate operator input through managed documents or Arcadia intake and reports whether it joined the current Action, became a separate planned Action or Decision, or entered Incubating with a trigger.
    expected_artifact: A tested conversational capture receipt contract used by Arcadia's coding-agent guidance and surfaced in operator handoffs
    clarification: clarified
    confidence: high
    source: Decision 0016
    acceptance_criteria:
      - A materially separate idea mentioned during active work is never silently left only in conversation history.
      - The receipt names the Project when known, canonical object type, status, Responsibility when applicable, and durable document or Arcadia identifier.
      - Input that changes the current Action is attached there; independent concrete work becomes a planned Action; judgment becomes a Decision; an uncommitted idea becomes Incubating.
      - An Incubating or deferred item names a visible reactivation trigger, or is honestly rejected or archived instead of being postponed indefinitely.
      - Ambiguous Project, desired Outcome, or authorization produces one focused Decision rather than guessed routing.
      - Existing natural-language intake, managed-document authority, and approval boundaries remain intact.
    decisions: ["0016"]
    references:
      - AGENTS.md
      - CLAUDE.md
      - docs/dogfooding.md
      - docs/ADAPTER_CONTRACT.md
      - src/commands/ask.ts
      - src/docs/sync.ts
    depends_on: [define-portfolio-continuity-projection]
  - id: dogfood-portfolio-continuity
    title: Run a real portfolio review from the continuity view
    status: open
    responsibility: requires_review
    effort: short
    next_action: After the view and capture receipt are implemented, review Arcadia, Private Practice Now, Rebuster, and Martian Rover from one phone session, capture one unrelated idea in conversation, and verify its receipt and placement without manual repair.
    expected_artifact: An operator QA Log proving one end-to-end portfolio review and conversational capture cycle
    clarification: clarified
    confidence: high
    source: Decision 0016
    acceptance_criteria:
      - The operator can explain what is past, current, next, and later across all four Projects from the single view.
      - Filtering to each Project preserves the same truth and ordering without cross-Project leakage.
      - One tangential idea stated during the review receives a durable capture receipt and appears in the correct horizon on refresh.
      - At least one deferred item displays its real trigger and one Incubating item remains visibly non-committed.
      - Friction, ambiguity, or missing source data is recorded in the QA Log before any automatic scheduling or prioritization is proposed.
    decisions: ["0016"]
    references:
      - START_HERE.md
      - docs/operator-demo-and-release-contract.md
    depends_on: [build-portfolio-continuity-view, make-conversation-capture-explicit]
decisions: ["0016", "0017"]
---

# Portfolio continuity view

## Outcome

The operator can open one view and understand the portfolio's story without
reconstructing it from plans, queues, Decisions, Runs, Logs, and the Back
Burner. The same operating loop can receive a tangential thought in ordinary
conversation, preserve it honestly, and show where it landed.

## Pareto boundary

The first valuable form is Arcadia Now: a deterministic immediate-orientation
snapshot, phone-friendly web view, and one governed transition path. That
vertical slice proves the data and interaction contract before the broader
Past, Now, Next, and Later projection is built around it. The plan does not
schedule the future, infer deadlines, rank every Project, summarize with a
model, or duplicate source records. Past is ordered by observed time. Now
follows authoritative state. Next follows pointers and dependencies. Later
keeps draft, deferred, and Incubating work distinct.

## Activation trigger

The operator has now validated the immediate-orientation need in a live PPN
incident and selected the Arcadia Now interaction shape. This plan still stays
draft while `demo-first-delivery` owns Arcadia's authoritative work pointer.
Activate it when the operator explicitly chooses Arcadia Now over that active
work, or when the current demo-first Action is accepted. Until then, coding
agents can honor Decisions 0016 and 0017 manually by preserving separate ideas,
reporting capture receipts, and presenting one clearly consequential next move.
