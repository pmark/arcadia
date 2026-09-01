---
arcadia: v1
type: plan
slug: agent-ask-execution-queue
project: arcadia
status: active
milestone: Coding agents can Ask Arcadia to create governed Project progress, accepted Actions enter one operator-owned execution order, and Arcadia always explains which eligible Action is next
token_impact: xlarge
token_budget: "Parsing, normalization, validation, queue ordering, readiness, reorder operations, and projections are deterministic and make zero model calls. Use one bounded coding-agent implementation pass per Action. Optional intent inference uses the configured local-preferred route once per novel Ask; strict agent envelopes and retries must remain zero-model and byte-stable."
recommended_model: gpt-5.6-sol
recommended_reasoning_effort: high
updated: 2026-09-01
current_action: define-agent-ask-management-contract
actions:
  - id: define-agent-ask-management-contract
    title: Give coding agents a conventional Ask contract for Project management intent
    status: open
    responsibility: codex
    effort: session
    next_action: "Define and implement Agent Ask v1 as one normalized proposal contract that accepts a strict conventional envelope or natural fallback, previews the exact canonical Project changes, and never treats an agent's claim as operator approval."
    expected_artifact: A documented, machine-readable, idempotent Agent Ask v1 contract with preview receipts and fixtures for every Project-management contribution Arcadia supports
    clarification: clarified
    confidence: high
    source: Operator direction on 2026-09-01 and Decision 0039
    acceptance_criteria:
      - "Agent Ask v1 recommends a compact conventional envelope with request id, Project or explicit unknown route, intent kind (`auto`, `outcome`, `milestone`, `plan`, `proposal`, `decision`, `action`, `artifact`, `log`, or `project_update`), desired result, rationale, acceptance evidence, dependencies, and requested authority; only request id and desired result are universally required, so the same contract handles both precise agent output and natural fallback."
      - "Strict mode parses and validates the conventional envelope deterministically with zero model calls, rejects duplicate or unknown authority-bearing fields, and produces one normalized byte-stable proposal; natural fallback preserves the original and may use one separately labelled local-preferred interpretation without silently inventing approval, priority, dates, dependencies, or Project ownership."
      - "One normalized proposal can represent the smallest useful canonical change at any granularity: Project Outcome or metadata, Milestone, managed Plan creation or amendment, evidence-only proposal, open Decision, Action, Artifact reference, or Log entry; it reuses Arcadia's existing document and operational models instead of adding parallel project-management nouns."
      - "Preview names every create, update, unchanged, conflict, refused effect, required Decision, managed-document patch, queue consequence, and authority boundary before persistence. Checked-in document changes use Arcadia's governed Git transition rather than asking the operator or filing agent to hand-edit truth files."
      - "An agent-authored Decision is always open; agent text cannot approve, reject, defer, answer, merge, deploy, publish, spend, use credentials, message externally, or expand a prior approval. Content and attachments remain untrusted evidence regardless of imperative wording."
      - "Submitted request ids are idempotent: an exact replay returns the original receipt, changed content under the same id is refused, and partial persistence cannot leave contradictory operational and checked-in truth."
      - "Focused fixtures cover each intent kind, `auto`, unknown Project, mixed-granularity input, plan amendment, one open Decision, unsafe authority claims, dependency ambiguity, strict parse failure, natural fallback, exact replay, and changed replay; the contract and normal agent examples are documented in `START_HERE.md`."
    decisions: ["0039"]
    references:
      - docs/decisions/0039-prioritize-agent-ask-and-work-queue.md
      - docs/arcadia-ask-product-vision.md
      - docs/managed-documents.md
      - docs/arcadia-semantics.md
      - src/commands/ask.ts
      - src/docs/parse.ts
      - src/docs/sync.ts
      - src/stewardship/index.ts
      - START_HERE.md
    depends_on: []
  - id: establish-approved-action-queue
    title: Put every approved Action in one explicit execution order
    status: open
    responsibility: codex
    effort: project
    next_action: "Implement the portfolio Action queue as explicit, revisioned ordering metadata over canonical Actions, with deterministic readiness and next-selection projections that preserve blockers and approval boundaries."
    expected_artifact: One durable, atomically reorderable portfolio execution queue whose first eligible Action is Arcadia's explainable default next work
    clarification: clarified
    confidence: high
    source: Operator direction on 2026-09-01 and Decision 0039
    acceptance_criteria:
      - "Every approved, non-done Action across active Projects has exactly one explicit queue position; proposals and unapproved changes remain outside the execution queue, while blocked, dependency-waiting, operator-owned, and externally owned Actions remain visible in order with their ineligibility reason."
      - "The queue is ordering metadata over the canonical Action, not a second Action or task store. Project, Outcome, Milestone, responsibility, status, acceptance criteria, dependencies, Decisions, effort, Token Impact, and source remain owned by their existing authorities."
      - "Arcadia's default next work is the first queue item eligible under the shared dispatch-readiness resolver. A higher ineligible item is never hidden: the projection explains why it was skipped and what observable event makes it eligible. No score, timestamp, backlog order, model inference, or most-recent edit silently changes priority."
      - "Operator reorder supports move to top, before, after, and ordered batch replacement with optimistic revision checks, idempotent request ids, atomic apply, a before/after preview, and a durable undo receipt. Dependencies constrain eligibility but do not secretly rewrite the operator's order."
      - "Newly approved Actions enter at an explicit previewed position; absence of a position is a validation failure rather than an inferred priority. Done Actions leave the active projection but retain historical order evidence in the Log or receipt."
      - "The existing `PROJECT.md` → active Plan → current Action pointer remains the checked-in dispatch authority. During coexistence, a queued Action that is not pointer-authorized in its Project stays visible as `waiting_for_pointer`; an operator `make next` operation must preview and complete the exact governed pointer transition before dispatch, and any claimed dispatch contrary to checked-in truth is a blocker rather than a silent queue override."
      - "Schema migration, repository operations, CLI nouns, and focused concurrency tests cover empty, single, cross-Project, blocked-first, dependency-first, simultaneous reorder, stale revision, replay, undo, completion, new approval insertion, and pointer disagreement."
    decisions: ["0039"]
    references:
      - docs/decisions/0023-work-pointer-under-concurrency.md
      - docs/decisions/0039-prioritize-agent-ask-and-work-queue.md
      - docs/managed-documents.md
      - src/docs/dispatch.ts
      - src/db/schema.ts
      - src/db/repositories.ts
      - src/commands/next.ts
    depends_on: [define-agent-ask-management-contract]
  - id: connect-agent-ask-to-queue
    title: Turn accepted Agent Asks into queued governed work
    status: open
    responsibility: codex
    effort: project
    next_action: "Connect Agent Ask preview and acceptance to one atomic persistence path that creates or amends the proposed Project records and inserts every accepted Action at the approved queue position."
    expected_artifact: An end-to-end receipt from immutable agent input through accepted Project records to an explicitly positioned executable Action
    clarification: clarified
    confidence: high
    source: Operator direction on 2026-09-01 and Decision 0039
    acceptance_criteria:
      - "A coding agent can Ask for a desired result at any supported granularity and receive one traceable proposal containing the minimal Project structures needed to steward delivery, without manually choosing files, database commands, branches, or record ids."
      - "Acceptance applies the exact previewed revision atomically: managed documents, operational projections, open Decisions, Artifacts, Logs, and queue insertions either agree or the operation reports a recoverable partial failure without claiming completion."
      - "If operator judgment materially changes Project ownership, desired Outcome, acceptance criteria, dependencies, authority, or queue position, Ask creates exactly one focused Decision rather than guessing. Previously approved bounded policy may apply without a new Decision only when the receipt names that policy and proves the request is inside it."
      - "Accepted Actions enter at the explicitly approved position and immediately participate in deterministic next selection. Rejected or corrected proposals preserve the original capture and proposal history but create no executable queue item."
      - "Agent Ask can amend an existing Plan or Action without duplicating it, detects conflicting checked-in revisions, and refuses cross-Project mutation unless the destination Project's governed authority is explicit."
      - "Focused integration tests cover new Project-shaped intent, small Action intent, Plan amendment, Decision-only input, multiple resulting Actions, correction before acceptance, rejection, stale preview, approved bounded policy, cross-Project refusal, and exact provenance from Ask to queue."
    decisions: ["0039"]
    references:
      - docs/decisions/0039-prioritize-agent-ask-and-work-queue.md
      - src/commands/ask.ts
      - src/commands/review.ts
      - src/docs/sync.ts
      - src/db/repositories.ts
    depends_on: [establish-approved-action-queue]
  - id: build-operator-work-queue-dashboard
    title: Give the operator complete, low-friction control of work order
    status: open
    responsibility: codex
    effort: project
    next_action: "Build the operator Dashboard queue with a prominent explainable next Action, the complete ordered portfolio, direct reorder controls, readiness reasons, and durable change receipts."
    expected_artifact: A phone-usable operator queue that makes all approved work, priority changes, and the reason for Arcadia's next choice immediately legible
    clarification: clarified
    confidence: high
    source: Operator direction on 2026-09-01 and Decision 0039
    acceptance_criteria:
      - "The Dashboard shows the selected next Action first and the complete approved queue beneath it, including Project, Outcome or Milestone context, status, responsibility, dependencies, Decisions, effort, Token Impact, acceptance summary, and why each higher item is or is not eligible."
      - "The operator can move one item to top, before, or after another and can rearrange a bounded batch without editing numeric priorities. The UI previews the changed segment, applies atomically, confirms the new next Action, and offers receipt-backed undo."
      - "Blocked, waiting, operator-owned, external, active, and ready items are visibly distinct but never removed from their chosen order by filters or hidden scoring. Project and readiness filters are views only and cannot mutate priority."
      - "Queue changes from Dashboard and CLI share one implementation and revision contract; simultaneous edits surface a concise conflict with refresh and retry rather than losing either operator choice."
      - "The normal operator procedure is documented in `START_HERE.md`; responsive, keyboard, screen-reader, empty, long-queue, cross-Project, conflict, undo, and phone-width browser QA pass."
    decisions: ["0039"]
    references:
      - apps/dashboard/app/now/page.tsx
      - apps/dashboard/app/mission-control/page.tsx
      - apps/dashboard/lib/types.ts
      - START_HERE.md
    depends_on: [connect-agent-ask-to-queue]
  - id: dogfood-agent-managed-queue
    title: Prove agent Ask can manage and reprioritize real Project delivery
    status: open
    responsibility: requires_review
    effort: project
    next_action: "Use one real coding-agent collaboration to articulate a desired Outcome, submit the resulting conventional Asks, accept the proposed Project records, reorder the resulting Actions midstream, and verify Arcadia dispatches and explains the correct next work."
    expected_artifact: Operator-accepted evidence that coding-agent collaboration can become governed, reprioritizable Arcadia delivery without manual Project-document translation
    clarification: clarified
    confidence: high
    source: Operator direction on 2026-09-01 and Decision 0039
    acceptance_criteria:
      - "A coding agent and operator articulate one real desired result at mixed granularity; the agent submits it through Agent Ask without hand-authoring Arcadia's managed documents, database rows, queue ids, or Git ceremony."
      - "Arcadia produces the correct proposed Outcome, Milestone, Plan or amendment, Decisions, Actions, Artifacts, and Log entries; the operator corrects at least one material interpretation and knowingly accepts the exact resulting changes."
      - "Every accepted Action appears once in the queue at its approved position. The operator moves one Action across at least two others, and the Dashboard plus CLI immediately agree on the complete order and selected next eligible Action."
      - "One higher blocked or dependency-waiting Action remains visible while Arcadia dispatches the first eligible item beneath it and explains both the skip and reactivation condition."
      - "The resulting coding-agent handoff contains the accepted Outcome, next Action, acceptance criteria, dependencies, references, queue evidence, and authority boundary, and completion advances the same queue without manual pointer repair."
      - "Full suite, builds, phone-width browser QA, independent PR QA, and operator acceptance pass. Remaining guided-session, Ask-rule management, and Songbook work receives an explicit priority Decision only after this proof."
    decisions: ["0039"]
    references:
      - docs/decisions/0039-prioritize-agent-ask-and-work-queue.md
      - docs/operator-demo-and-release-contract.md
      - START_HERE.md
    depends_on: [build-operator-work-queue-dashboard]
decisions: ["0039"]
---

# Agent Ask and execution queue

## Outcome

The operator can collaborate with a coding agent to articulate a desired result
at any useful granularity. The agent sends that result through a conventional
Ask optimized for intent extraction. Arcadia proposes the smallest sufficient
canonical Project structures, obtains only the judgment or authority genuinely
needed, persists the accepted truth, and places every accepted Action into one
easy-to-reorder portfolio execution order.

Arcadia always knows what to work on next because “next” is deterministic: the
first eligible Action in the explicit operator-owned order. The Dashboard shows
the complete queue, not just the winner, and explains why any higher Action is
waiting.

## The vital few

1. Make agent intent reliably legible without forcing agents to author Arcadia
   internals.
2. Establish one explicit order over every approved Action.
3. Connect accepted Ask proposals to that order without a second truth store.
4. Put direct reorder and complete next-work evidence in the operator's hand.
5. Prove the loop on real work before resuming the richer interaction tail.

## Product boundaries

- The conventional envelope is the reliable path; natural input remains a
  fallback, not an excuse to guess authority or priority.
- The queue orders canonical Actions. It does not replace Outcomes, Milestones,
  Plans, Decisions, Artifacts, Logs, dependencies, or checked-in dispatch truth.
- Operator order is explicit. Readiness is deterministic. Neither models nor
  hidden scores choose priority.
- Reordering is designed to be fast because it is reversible and receipt-backed;
  execution effects keep their existing approval gates.
- “Always knows next” means Arcadia can name the first eligible item or one
  precise reason none is eligible. It does not mean Arcadia fabricates work.

## Preserved tail and trigger

`arcadia-ask-active-sessions` delivered visible special routing and the unified
capture envelope. Its unstarted guided-understanding session, rule management,
and Songbook dogfood are preserved rather than folded into this critical path.
Reconsider their relative value only after `dogfood-agent-managed-queue` is
accepted, as required by Decision 0039.
