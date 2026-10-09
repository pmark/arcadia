---
arcadia: v1
type: plan
slug: operator-to-do-list-with-ask-only-input
project: arcadia
status: draft
milestone: Operator to-do list with Ask-only input
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-09
actions:
  - id: build-operator-todo-list
    title: "Give the operator one derived to-do list of everything Arcadia needs from him: arcadia todo."
    status: done
    responsibility: agent
    effort: session
    next_action: "Give the operator one derived to-do list of everything Arcadia needs from him: arcadia todo."
    expected_artifact: Evidence satisfying Agent Ask build-operator-todo-list
    clarification: clarified
    confidence: high
    source: Agent Ask amend-build-operator-todo-list-fixture-blocking-20261008
    acceptance_criteria:
      - "arcadia todo [--json] [--all] [--stale] [--project <slug>] is a read-only derived view with no new store and never mutates anything. Per Project it computes the selected Action and ready set the way arcadia next does (resolveDispatch, resolveReadySet and resolveOperatorGate under a read-only database), then composes: open Decisions and pending Agent Ask proposals classified blocking or alert by the existing classifyOperatorItems/resolveOperatorGate; open and deferred review_items (covering ActionClarification); waiting operator-task ledger items; production_operator_escalations rows read-only (one item per Action, kind escalation:<kind>, title from message, answer from remedy, always blocking, createdAt from first_detected_at, deduped against a listed Decision named in the message), so a stalled production loop appears even when no Decision or Ask exists; non-done work_items with clarification_status unclarified, a capture_id and no open review_item, as alert items of kind clarify whose answer is arcadia clarify --work <id> --apply; and Plan Actions only when requires_review, question_open or a readiness blocker names an operator step, excluding Project-pause states. It dedupes review_items by work_item_id and by doc_ref against open Decision documents, ledger items and Actions against the Decision or review_item that already represents them."
      - "Blocking is true only for an item that is the selected Action's operator gate (a blockingDecisionId, a requiredDecisionId or deferringDecisionId of a ready-set candidate, the selected Action's own operator reason, or a review_item or ledger item linked to one of these); everything else is an alert. Each item carries key <kind>:<source-id>, kind, title from the source's own field (nothing synthesized), project, blocking, origin, createdAt, staleReason when stale, and answer: the exact existing canonical command (for an Agent Ask, the two-phase settle preview command) and, where one exists, the existing Discord reply or dashboard path. --json output carries schema 'arcadia-todo-v1' and asOf (ISO timestamp and workspace name), and every item carries sourceRef (the canonical file path, or table and id). Blocking comes from resolveOperatorGate or the escalation row and is never recomputed. Decision and Agent Ask items also carry gateQuestion, options with consequences, and evidence. The doneWhen rule per kind is documented in help and START_HERE.md, not stored."
      - "Stale means positive evidence only: an Agent Ask of intent complete, split, or action with a target_ref is stale when every Action it targets exists in a Plan of its Project with status done; an Ask naming only absent Actions is an un-adopted proposal and never stale; supersession counts only through an explicit line 'Supersedes: <proposal ids>' in the rationale of an Agent Ask, read from its stored proposal; a Decision is stale when its action is done; a review_item is stale when its work_item is done or its doc_ref names an answered Decision. The default view prints a counts line (blocking, other, stale hidden, per kind), every blocking item, then at most 5 other items ordered with open Decisions first, newest first, then every other item oldest first; --all and --stale show the rest, and the default view ends with 'N more: --all'. Projects without a repo_path and fixture Projects whose slug contains 'rehearsal' or whose repo_path lies under the OS temp directory or ~/tmp appear only as a counts line, except that their blocking items are still listed and counted, so a stalled production loop is never hidden. With no resolvable workspace it prints the repo-local sources plus one explicit 'workspace sources unavailable: <remedy>' line, never a silently partial list; Decisions raised only on unmerged candidate branches are a documented limit."
      - Fixture tests cover one item per kind (including one operator_gate_pending and one repair_budget_exhausted escalation, and an escalation whose gate is also a listed Decision shown once), all dedup rules, positive-evidence staleness including an un-adopted proposal that stays visible, the blocking rule, ordering and cap, fixture-Project grouping, the degraded no-workspace output and a JSON golden; type, lint and build pass; START_HERE.md documents arcadia todo. A pushed PR with exact-head independent review and all required checks is the delivered Artifact; LOCAL ONLY or an unresolved blocker is labelled explicitly.
    depends_on: []
    decisions: []
    references: ["CONSTITUTION.md", "docs/managed-documents.md", "docs/planning-process.md", "docs/agent-guidance/index.json", "docs/plans/bootstrap-managed-production-to-build-flight-deck.md", "https://www.anthropic.com/engineering/harness-design-long-running-apps", "src/ask/operatorGate.ts", "src/docs/operatorGate.ts", "src/docs/operatorTasks.ts", "src/commands/operatorTasks.ts", "src/commands/review.ts", "src/commands/decision.ts", "src/commands/agentAsk.ts", "src/scheduling/schedule.ts", "src/db/repositories.ts", "apps/dashboard/lib/needs-you.ts", "START_HERE.md", "src/commands/next.ts", "src/ask/settlement.ts", "src/production/tick.ts"]
  - id: record-standard-harness-rule
    title: Record the standard-harness rule and this Plan's operator direction as indexed agent guidance.
    status: done
    responsibility: agent
    effort: session
    next_action: Record the standard-harness rule and this Plan's operator direction as indexed agent guidance.
    expected_artifact: Evidence satisfying Agent Ask record-standard-harness-rule
    clarification: clarified
    confidence: high
    source: Agent Ask operator-todo-ask-pivot-20261008-v6
    acceptance_criteria:
      - "A short indexed procedure docs/agent-guidance/standard-harness.md states: a standard harness runs unmodified with Arcadia as its state, tools and instruction files; a new workflow is one checked-in instruction file plus existing commands, not orchestration code; every response Arcadia needs from the operator is raised through a source arcadia todo reads, and operator input enters through Ask or Ingress; judged outputs get a separate grader; handoffs go to files; and this Plan's deferrals with their revival triggers. It grants no new authority."
      - "The procedure contains a section 'Session protocol (by convention today)' of at most 40 lines that links docs/agent-guidance/agent-peer-watch.md rather than restating its grammar, covering: identity (one Session per <project>/<actionId>; declare the agent/tier identity from arcadia identity resolve in the session title, PR comments and commits); lease (work only from the claim arcadia go or the host gave; takeover only by an arcadia-peer-takeover-request-v1 with basis claim_released or principal_proven_terminal; release_requested and silence release nothing); reportable states (working, needs_input, handed_off, done; healthy, idle and stalled are watcher inferences, not declarations); heartbeat (hand-written Arcadia-Agent, Arcadia-Action and when known Arcadia-Claim and Arcadia-Heartbeat trailers on every commit, at least every 10 minutes while working); inactivity ping (before any turn that leaves supervised or claimed work inactive without a PR, picker or completion, run arcadia ping send '<agent/tier> <project>/<actionId> <needs_input|handed_off|blocked>: <reason>; resume: <command>' --kind attention --agent <agent/tier> --link <the related GitHub Issue URL, else the PR>, and a needs_input state also raises an item arcadia todo reads); handoff by file or Agent Ask naming agent/tier, claim generation and candidate revision, never chat; receipts (completion is a complete Ask with per-criterion evidence and candidate_revision; a PR, green CI or launched process proves nothing); and honesty (agents are surrogates for future deterministic processes and decision systems and follow the protocol as if enforced)."
      - docs/agent-guidance/index.json gains one entry with a correct sha256 and triggers that do not duplicate existing entries (harness, orchestration, new workflow, instruction file, session, inactive, ping, handoff); a test or the existing guidance check fails if the Session protocol section is missing or its trailer keys differ from PEER_WATCH_TRAILERS; AGENTS.md and bootstrap budgets are unchanged; pnpm test passes. A pushed PR with exact-head independent review and all required checks is the delivered Artifact; LOCAL ONLY or an unresolved blocker is labelled explicitly.
    depends_on: []
    decisions: []
    references: ["CONSTITUTION.md", "docs/managed-documents.md", "docs/planning-process.md", "docs/agent-guidance/index.json", "docs/plans/bootstrap-managed-production-to-build-flight-deck.md", "https://www.anthropic.com/engineering/harness-design-long-running-apps", "docs/agents-context.md", "docs/agent-guidance/agent-peer-watch.md", "src/agentWatch/contract.ts", "src/agentWatch/classify.ts"]
  - id: grade-next-actions-before-actionable
    title: Make a next action count as actionable only when it states a done-condition and passes a separate grader; otherwise the operator gets exactly one question in arcadia todo.
    status: done
    responsibility: agent
    effort: session
    next_action: Make a next action count as actionable only when it states a done-condition and passes a separate grader; otherwise the operator gets exactly one question in arcadia todo.
    expected_artifact: Evidence satisfying Agent Ask grade-next-actions-before-actionable
    clarification: clarified
    confidence: high
    source: Agent Ask amend-operator-todo-acceptance-to-shipped-design-20261008-r2
    acceptance_criteria:
      - arcadia ask marks the work_items it creates unclarified, and the clarify generator schema gains a doneCondition field that is required on the clarified branch, enforced by normalizeVerdict and the deterministic lint rather than by schema validation (a schema-invalid reply would become a failed job that the idempotency key keeps reusing); normalizeVerdict (src/clarify/engine.ts) downgrades a clarified verdict lacking one to question_open with the existing gapType missing-success-criteria and exactly one question.
      - "Before recording clarified, a deterministic lint (non-empty doneCondition; nextAction starts with a verb; every file path, Action or Decision id and command name it mentions appears in the source material, which includes the prior clarification answer) and then a separate grader run. The grader is its own instruction file .agents/skills/next-action-grader/SKILL.md (symlinked from .claude/skills, reported as an external boundary if the sandbox blocks the link, and listed in docs/using-arcadia-skills.md) executed as its own local-preferred Intelligence call with a different prompt that never receives the generator's confidence, using a distinct model profile when one is configured and otherwise documenting that only prompt independence is claimed. It checks: concrete verb; first physical step startable by the named actor in under 15 minutes; observable done-condition; no invented facts; and when information is missing, a request for exactly that one item. Only a pass records clarified; a fail records question_open through the existing clarify --apply path (an ActionClarification review_item), so the single question appears in arcadia todo."
      - When the operator answers an ActionClarification at the CLI with review approve <id> --answer <text> --clarify or review resolve-reply <reply> --id <id> --clarify (a new opt-in flag that arcadia todo prints in its answer command), the answer is made durable and then clarify --work <id> --apply runs once; without the flag, and on the Discord and dashboard paths (which re-clarify themselves), no clarification is triggered, so nothing runs twice. When a passing verdict's actor is a coding agent and the work_item has a capture_id, clarify --apply drafts one strict v1 Agent Ask (intent action, request_id handoff-<work_item_id>-<first 12 hex of sha256(nextAction + doneCondition)>, rationale naming the capture envelope and work_item ids, acceptance from the done-condition) into the Project repository's .arcadia/asks/ through the existing draft writer (runAgentAskDraftCommand). Drafting is skipped, with the reason reported, when the work_item's Project has no repo_path or a proposal with that request_id already exists, including one already settled and archived. That draft is the file handoff; it appears in arcadia todo as a pending proposal, and clarify itself writes no Action status, pointer or queue.
      - Each grader verdict is stored as a receipt in the existing clarification record (no new table) with grader identity (model profile id or agent reference), prompt sha256, input sha256 and verdict, and the golden set's README states it is the contract any deterministic replacement grader must pass. A checked-in golden set of at least 10 hand-written cases (next action, done-condition, source, expected pass or fail with reason) runs in tests against the lint and a stubbed grader; tests also cover ask marking unclarified, missing done-condition, grader fail-with-question, grader-unavailable leaving the item unclarified, CLI answer re-clarify, and idempotent handoff Ask drafting. Dry run stays the default and grading never escalates to a paid model. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact; LOCAL ONLY or an unresolved blocker is labelled explicitly.
    depends_on: [build-operator-todo-list]
    decisions: []
    references: ["CONSTITUTION.md", "docs/managed-documents.md", "docs/planning-process.md", "docs/agent-guidance/index.json", "docs/plans/bootstrap-managed-production-to-build-flight-deck.md", "https://www.anthropic.com/engineering/harness-design-long-running-apps", "src/clarify/contract.ts", "src/clarify/engine.ts", "src/clarify/types.ts", "src/commands/clarify.ts", "src/intelligence/types.ts", ".agents/skills/arcadia-github-issues/SKILL.md", "docs/using-arcadia-skills.md", "src/commands/ask.ts", "src/commands/review.ts", "src/ask/agentAsk.ts", "src/ask/discovery.ts"]
  - id: capture-operator-decision-replies-as-asks
    title: Give every free-text operator answer to a Decision or review an Ask envelope, and measure how much operator input passes through Ask or Ingress.
    status: done
    responsibility: agent
    effort: session
    next_action: Give every free-text operator answer to a Decision or review an Ask envelope, and measure how much operator input passes through Ask or Ingress.
    expected_artifact: Evidence satisfying Agent Ask capture-operator-decision-replies-as-asks
    clarification: clarified
    confidence: high
    source: Agent Ask operator-todo-ask-pivot-20261008-v6
    acceptance_criteria:
      - "One fail-open helper calls the existing captureAskEnvelope for free-text operator replies at review resolve-reply (src/commands/review.ts), decision approve when free text accompanies the answer (src/commands/decision.ts), and the dashboard work-question route; Discord replies to Decision notifications reach the same helper through those commands. requestId is <surface>:<entity-id>:<sha256(text) first 12 hex>, originalText is the exact reply, and ingressSource comes from a small documented vocabulary in which each source is marked intake or provenance-only; these replies are provenance-only. The helper is skipped when the caller already holds a capture id (the arcadia ask reply path), so one reply yields one envelope. Capture failure is logged and never blocks or changes the canonical write. The capture id goes into the existing event or receipt payload; an existing capture_id column is never overwritten. The helper accepts optional actor ({ id }, set only when the calling surface authenticates a principal, today the Discord author id passed through a new --actor option on review resolve-reply) and optional project (slug, only where the call site already holds it). Both are stored in envelope_json only and excluded from the fingerprint, so replay returns the first stored envelope and never throws on an actor mismatch; CLI and dashboard replies record actor null and no id is invented."
      - The Discord free-text message path newly enforces DISCORD_ALLOWED_USER_IDS in messageCreate isAllowedMessage when it is configured, with the router's refusal reaction; when it is empty the bot keeps guild and channel gating and logs a startup warning, so the operator is never locked out by an unset value.
      - "A read-only coverage report (ask show --coverage or an ask-trail aggregate over existing tables, no new store) states, for a time window and per surface, captured operator inputs over canonical operator writes for surfaces with an independent countable canonical record (review and Decision replies, Ingress files). The numerator counts only sources marked operator intake; agent.ask and codex.* envelopes are excluded and reported separately. Discord messages, chat and other surfaces without an independent record are reported as captured N with denominator unknown, and the report headline states 'direct chat: not measured' so the metric cannot be read as the share of all operator input."
      - Tests prove each wrapped surface creates exactly one envelope per distinct reply, replay is idempotent, a capture failure leaves the canonical write unchanged, the allowlist behaves as specified when set and unset, and the coverage math, and that a replay of the same reply with a different actor returns the original envelope unchanged; type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact; LOCAL ONLY or an unresolved blocker is labelled explicitly.
    depends_on: [build-operator-todo-list]
    decisions: []
    references: ["CONSTITUTION.md", "docs/managed-documents.md", "docs/planning-process.md", "docs/agent-guidance/index.json", "docs/plans/bootstrap-managed-production-to-build-flight-deck.md", "https://www.anthropic.com/engineering/harness-design-long-running-apps", "src/ask/captureEnvelope.ts", "src/commands/review.ts", "src/commands/decision.ts", "src/commands/askTrail.ts", "apps/discord-bot/src/events/messageCreate.ts", "apps/discord-bot/src/replyRouter/router.ts", "apps/discord-bot/src/config.ts", "src/db/schema.ts"]
  - id: render-plan-progress-as-todo
    title: Show any Plan's progress in the to-do motif through the existing arcadia plans command.
    status: done
    responsibility: agent
    effort: session
    next_action: Show any Plan's progress in the to-do motif through the existing arcadia plans command.
    expected_artifact: Evidence satisfying Agent Ask render-plan-progress-as-todo
    clarification: clarified
    confidence: high
    source: Agent Ask operator-todo-ask-pivot-20261008-v6
    acceptance_criteria:
      - "arcadia plans --plan <slug> [--all] [--json] prints, derived on every call from the Plan document with no store: a counts line (done, in progress, blocked, deferred, open, total), the current Action, the next five unfinished Actions, and blocked Actions with their recorded reason, as a Markdown checklist (- [x], - [ ], - [!]); --all prints every Action. The current Action is PROJECT.md current_action for the active Plan; otherwise the first unfinished Action in document order whose depends_on are done, or 'none (Plan not active)'. Ordering is plan-document order constrained by depends_on and is stated as not the dispatch queue. Output states that done means the recorded Action status, not re-proven acceptance. --json emits a stable PlanProgress shape for later Flight Deck and GitHub projections."
      - countActions in src/commands/plans.ts is exported and extended with a deferred bucket and reused rather than duplicated; the command stays workspace-free; arcadia path, arcadia now, the Flight Deck page and every GitHub surface are untouched.
      - "--json output carries schema 'arcadia-plan-progress-v1' and source { planSlug, planPath, updated } from the Plan's frontmatter. Each Action entry carries key <project>/<actionId> (the same key schedule uses), status (the Plan document's recorded status, unmapped) and dependsOn. The output states it is a derived one-way view whose statuses are the Plan document's, not the scheduler's board statuses, and nothing in it is read back. A test asserts key equals actionKeyOf(project, actionId) for every Action in a fixture Plan."
      - Fixture tests cover a large Plan, deferred and blocked Actions, active versus inactive current-Action rules, dependency ordering and the JSON golden; type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact; LOCAL ONLY or an unresolved blocker is labelled explicitly.
    depends_on: []
    decisions: []
    references: ["CONSTITUTION.md", "docs/managed-documents.md", "docs/planning-process.md", "docs/agent-guidance/index.json", "docs/plans/bootstrap-managed-production-to-build-flight-deck.md", "https://www.anthropic.com/engineering/harness-design-long-running-apps", "src/commands/plans.ts", "src/commands/docket.ts", "src/docs/parse.ts", "src/docs/types.ts", "src/northStar/path.ts", "src/scheduling/schedule.ts", "src/scheduling/github.ts"]
  - id: point-operator-surfaces-at-todo
    title: Make the operator's existing surfaces point at the one to-do list instead of their own merges.
    status: done
    responsibility: agent
    effort: session
    next_action: Make the operator's existing surfaces point at the one to-do list instead of their own merges.
    expected_artifact: Evidence satisfying Agent Ask point-operator-surfaces-at-todo
    clarification: clarified
    confidence: high
    source: Agent Ask operator-todo-ask-pivot-20261008-v6
    acceptance_criteria:
      - "The dashboard approvals page reads arcadia todo --json --all: Decision and Agent Ask rows keep today's settle controls and POST paths unchanged, while review, ledger and Action rows appear read-only with their answer command, so the phone-friendly dashboard shows the one list. The Flight Deck page and needs-you scoring are untouched. Parity tests prove every Decision and Ask the old loaders returned still appears with its options."
      - "The morning orientation packet gains an optional operatorTodoLines input fed the way workSafetyLines is (src/orientation/composer.ts, src/commands/orientation.ts), showing the to-do counts and each blocking item with its answer, escalation items first so the packet states what stopped production overnight, degrading to 'to-do unavailable: <reason>'; it is delivered through the packet's already-live path with no new message type, channel or schedule."
      - Tests cover the approvals reader and the packet line including degradation; the PR includes runnable operator QA steps; type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact; LOCAL ONLY or an unresolved blocker is labelled explicitly.
    depends_on: [build-operator-todo-list]
    decisions: []
    references: ["CONSTITUTION.md", "docs/managed-documents.md", "docs/planning-process.md", "docs/agent-guidance/index.json", "docs/plans/bootstrap-managed-production-to-build-flight-deck.md", "https://www.anthropic.com/engineering/harness-design-long-running-apps", "apps/dashboard/app/api/approvals/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "src/orientation/composer.ts", "apps/discord-bot/src/orientation/scheduler.ts", "src/commands/orientation.ts"]
  - id: raise-stale-triage-decision
    title: Prepare the evidence-backed list of stale Arcadia operator items and raise one operator Decision to retire it.
    status: done
    responsibility: agent
    effort: session
    next_action: Prepare the evidence-backed list of stale Arcadia operator items and raise one operator Decision to retire it.
    expected_artifact: Evidence satisfying Agent Ask raise-stale-triage-decision
    clarification: clarified
    confidence: high
    source: Agent Ask amend-operator-todo-plan-supersedes-ref-20261008-r2
    acceptance_criteria:
      - "arcadia todo --stale --json for the Arcadia Project is saved as a list Artifact with each item's staleReason evidence, its sha256, and counts of stale, non-stale and unclassifiable items (intents that name no Action, and other Projects' items, which need their own Project's Decision and are named as a revival trigger). Superseded proposals agentask_3b07406ec8dc13e410 and agentask_58f7a77c2a4de8eab7 are included through the 'Supersedes:' line in the rationale of the settled Ask operator-todo-ask-pivot-20261008-v6."
      - One Decision raised through the existing Decision writer asks whether to reject or resolve exactly the listed ids bound to that sha256, with each option's consequence; it appears in arcadia todo. Nothing is settled by this Action, and no Action status, pointer or queue changes.
    depends_on: [build-operator-todo-list]
    decisions: []
    references: ["src/commands/agentAsk.ts", "src/ask/settlement.ts", "src/commands/review.ts", "src/commands/decision.ts"]
  - id: apply-approved-stale-triage
    title: Retire exactly the operator-approved stale items through the existing governed writers.
    status: done
    responsibility: agent
    effort: session
    next_action: Retire exactly the operator-approved stale items through the existing governed writers.
    expected_artifact: Evidence satisfying Agent Ask apply-approved-stale-triage
    clarification: clarified
    confidence: high
    source: Agent Ask operator-todo-ask-pivot-20261008-v6
    acceptance_criteria:
      - "Only after the triage Decision is answered approving the list: each listed Agent Ask is settled rejected with the existing two-phase agent-ask settle and each listed review_item is resolved with the existing review writer, batched and serialized against fresh main per the settlement-conflict procedure, with one receipt per item; items whose state changed since the list's sha256 are skipped and reported. If the answer declines, nothing is settled and the answer is recorded."
      - The before and after arcadia todo counts are recorded; no Action status, pointer or queue changes.
    depends_on: [raise-stale-triage-decision]
    decisions: []
    references: ["CONSTITUTION.md", "docs/managed-documents.md", "docs/planning-process.md", "docs/agent-guidance/index.json", "docs/plans/bootstrap-managed-production-to-build-flight-deck.md", "https://www.anthropic.com/engineering/harness-design-long-running-apps", "src/ask/settlement.ts", "src/commands/review.ts", "docs/agent-guidance/agent-asks.md"]
  - id: prove-operator-request-to-started-work
    title: Prove a real operator request travels through Ask to graded work that a fresh session starts, with the operator touching only Ask, the to-do list and arcadia go.
    status: open
    responsibility: agent
    effort: session
    next_action: Prove a real operator request travels through Ask to graded work that a fresh session starts, with the operator touching only Ask, the to-do list and arcadia go.
    expected_artifact: Evidence satisfying Agent Ask prove-operator-request-to-started-work
    clarification: clarified
    confidence: high
    source: Agent Ask plan-ask-intent-dispatch-20261008-r2
    acceptance_criteria:
      - The operator sends one genuine request for real work, phrased as work to create, through an existing Ask or Ingress surface (Discord message, dashboard Ask or iCloud Ingress); an agent never writes or posts it. The receipt binds the capture envelope, ask request and resulting work_item. A request that lands only in Back Burner or a review_item without a work_item is reported as a failed attempt, not a pass.
      - "The work_item is graded by the delivered generator and grader, triggered by the arcadia clarify --work <id> --apply command that arcadia todo lists for the new work_item: either a passing next action with actor and done-condition, or exactly one question shown in arcadia todo that the operator answers through its listed CLI command or Discord reply, after which automatic re-grading passes. A passing coding-agent verdict yields the handoff Agent Ask, which appears in arcadia todo."
      - The operator settles that Agent Ask from arcadia todo, placing the new Action in the active Plan's queue, then starts a new session with only arcadia go; that session works the resulting Plan Action by id without relay and produces a commit or PR naming both the Action id and the work_item id. A gate receipt, launched process or approval request alone never satisfies this. The working session's commits carry the Session protocol trailers, and the evidence index cites the commit paragraph with Arcadia-Agent and Arcadia-Action.
      - An evidence index records one verdict and receipt per criterion pinned to the envelope, work_item, Agent Ask, Action id, candidate revisions and PR heads, the arcadia todo and arcadia plans --plan outputs before and after, and the coverage report for the window; missing or stale proof blocks a success claim, and no production acceptance threshold or unfinished Action status of other Plans changed. If any supervised session in the proof stops without completion, the evidence index includes its inactivity ping (id, link and message); the proof does not pass without it.
    depends_on: [grade-next-actions-before-actionable, capture-operator-decision-replies-as-asks, point-operator-surfaces-at-todo, render-plan-progress-as-todo, stop-asks-vanishing]
    decisions: []
    references: ["CONSTITUTION.md", "docs/managed-documents.md", "docs/planning-process.md", "docs/agent-guidance/index.json", "docs/plans/bootstrap-managed-production-to-build-flight-deck.md", "https://www.anthropic.com/engineering/harness-design-long-running-apps", "src/commands/ask.ts", "src/commands/go.ts", "apps/discord-bot/src/events/messageCreate.ts"]
  - id: stop-asks-vanishing
    title: Make every operator Ask that is not explicitly an idea visible in arcadia todo, so no Ask vanishes into the Back Burner.
    status: open
    responsibility: agent
    effort: session
    next_action: Make every operator Ask that is not explicitly an idea visible in arcadia todo, so no Ask vanishes into the Back Burner.
    expected_artifact: Evidence satisfying Agent Ask stop-asks-vanishing
    clarification: clarified
    confidence: high
    source: Agent Ask plan-ask-intent-dispatch-20261008-r3
    acceptance_criteria:
      - Behind a config flag ask.routing.v2, which defaults on and can be turned off to restore today's routing, an operator Ask that matches no execution pattern goes to Clarify First instead of the Back Burner. Clarify First means a review_item that arcadia todo lists, carrying an ask-origin answer command. The Back Burner still receives an Ask only when the intake classification is Idea or the operator passes --back-burner. A Review Response with no resolvable reference also goes to Clarify First. Agent-sourced Asks (agent.ask envelopes) keep today's routing. Only a whole message that exactly matches a closed acknowledgement list ('thanks', 'thank you', 'ok', 'okay', 'got it', 'ack', 'done', or emoji only), after trimming whitespace and punctuation and ignoring case, creates no new question. So does an exact duplicate of an open Ask question within 24 hours. Their receipts say why, and the report counts them as suppressed, apart from the vanish rate. A message such as 'ok, ship X' is never suppressed.
      - The intake patterns in src/intake/index.ts recognise 'I should be able to', 'I want (to be able) to', 'let me' and 'it would be good if'. With these, the operator's example 'I should be able to Ask Arcadia to schedule a recurring action' is captured as work. Intake also records two deterministic flags in extractedFields. recurrence is set when the text says every, daily, weekly, monthly, recurring or schedule. planning is set when the existing planningRecommended pattern matches. ask_requests stores both flags so the report can count them.
      - "arcadia todo renders two section headers. 'Yours' holds the existing operator items and a 'Your Asks need one answer (N)' group: the newest 5 Ask-originated questions, with the full count always shown and never hidden by the other-items cap. 'Agents are doing' is one count line of in-flight agent work, naming arcadia todo --agents, which this Action adds to list that work. A counts line reads 'Back Burner: N incubating (M new in 7 days)'. The morning packet counts the Ask questions. Existing Back Burner items are not moved or changed. With no resolvable workspace, the degraded output states that Ask questions and Ask-origin tasks are unavailable."
      - "Tests cover:\n- the routing change for each classification;\n- the review-reply fallback;\n- the new phrasings;\n- the recurrence and planning flags;\n- trivial-acknowledgement and duplicate suppression;\n- an agent-sourced Ask keeping its route;\n- the flag-off rollback;\n- both todo sections and the counts line.\nType, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact."
    depends_on: []
    decisions: []
    references: ["CONSTITUTION.md", "docs/arcadia-ask-product-vision.md", "docs/planning-process.md", "src/commands/ask.ts", "src/intake/index.ts", "src/stewardship/index.ts", "src/commands/todo.ts", "src/backBurner/surfacing.ts", "src/orientation/operatorTodoLines.ts"]
  - id: ask-receipt-and-one-reply-correction
    title: Make every Ask reply state what Arcadia heard and where it put it, and let the operator correct it with one reply.
    status: open
    responsibility: agent
    effort: session
    next_action: Make every Ask reply state what Arcadia heard and where it put it, and let the operator correct it with one reply.
    expected_artifact: Evidence satisfying Agent Ask ask-receipt-and-one-reply-correction
    clarification: clarified
    confidence: high
    source: Agent Ask plan-ask-intent-dispatch-20261008-r2
    acceptance_criteria:
      - "Every arcadia ask result, from the CLI and in the Discord bot's reply, opens with one line before any detail: 'Heard: <type> (<confidence>, <rule|memo|model>) -> <what was created and where> . wrong? reply type: work|idea|answer|status'. The stewardship detail stays available with --verbose or --json."
      - "arcadia ask correct <ask_id> --type <work|idea|answer|status> [--project <slug>] re-routes the Ask only through the existing governed writers: create a work_item, create a review_item, or promote or archive a Back Burner item. It links the new record to the old as superseded and never deletes the original capture or record. In Discord, a reply to an Ask receipt that starts with 'type:' or 'project:' calls the same command. A correction to 'answer' requires an explicit reference to a pending item. That reference goes through the existing review resolve-reply writer and its validation, and from Discord is accepted only when DISCORD_ALLOWED_USER_IDS is configured and includes the author. Otherwise the correction is refused, so a correction never answers a Decision by inference or for an unverified author. The 'task' target is added by ask-do-for-me-operator-tasks."
      - ask-trail (arcadia ask show) displays the supersession. Tests cover each correction target, the refusal of an answer correction with no reference or an unverified author, and the Discord reply path. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: [stop-asks-vanishing]
    decisions: []
    references: ["CONSTITUTION.md", "docs/arcadia-ask-product-vision.md", "docs/planning-process.md", "src/commands/ask.ts", "src/intake/index.ts", "src/stewardship/index.ts", "src/commands/todo.ts", "apps/discord-bot/src/events/messageCreate.ts", "src/commands/askTrail.ts"]
  - id: ask-corrections-stick
    title: Make a corrected Ask route correctly the next time it is sent, instantly and with no model call.
    status: open
    responsibility: agent
    effort: session
    next_action: Make a corrected Ask route correctly the next time it is sent, instantly and with no model call.
    expected_artifact: Evidence satisfying Agent Ask ask-corrections-stick
    clarification: clarified
    confidence: high
    source: Agent Ask plan-ask-intent-dispatch-20261008-r3
    acceptance_criteria:
      - An additive migration creates ask_corrections with columns ask_request_id, normalized_text, text_hash, predicted_type, corrected_type, corrected_project, source and created_at, with no cascade delete. It also adds nullable confidence and corrected_type columns to ask_requests. Each correction row is written in the same transaction as the re-route, so a correction cannot exist without its memo.
      - A memo stage runs before the intake patterns. An operator Ask whose normalized text exactly matches a stored correction routes to the corrected type and Project, and its receipt says '(memo <date>)'. There is no fuzzy matching. An answer to an ask-origin clarification question also writes a correction row. Only operator corrections (source cli, discord or answer) are used as memos. Rows recorded from a model re-route are never used as memos. Raw Ask text stays in the workspace database and is never written to any repository.
      - Tests cover the transactional write, a memo hit on the identical Ask, a miss on different text, and the no-cascade guarantee. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: [ask-receipt-and-one-reply-correction]
    decisions: []
    references: ["CONSTITUTION.md", "docs/arcadia-ask-product-vision.md", "docs/planning-process.md", "src/commands/ask.ts", "src/intake/index.ts", "src/stewardship/index.ts", "src/commands/todo.ts", "src/db/schema.ts"]
  - id: ask-local-model-tiebreaker
    title: Give an unmatched operator Ask a typed interpretation from the local model within seconds, falling back to one question.
    status: open
    responsibility: agent
    effort: session
    next_action: Give an unmatched operator Ask a typed interpretation from the local model asynchronously, falling back to one question.
    expected_artifact: Evidence satisfying Agent Ask ask-local-model-tiebreaker
    clarification: clarified
    confidence: high
    source: Agent Ask plan-ask-intent-dispatch-20261008-r3
    acceptance_criteria:
      - The IntakeClassifier seam in src/intake/index.ts becomes injectable. A model-assisted classifier runs asynchronously through the same job and idempotency path the clarify engine uses, not inline in arcadia ask. It calls the local-preferred Intelligence route (operation arcadia.ask.classify, allowPaidUsage false) only for operator Asks that the deterministic rules and the memo left as Clarify First questions. Its output schema is an enum of work, task or unknown, plus actor, recurrence, planning and one question. It can never output idea, answer or status. Its extracted fields never set a Project, a Decision or authority.
      - A passing classification re-routes the Ask through the same governed writers as arcadia ask correct, recorded with source model (never used as a memo; see ask-corrections-stick), and updates its todo entry. When the model is unavailable, slow or unsure, the Ask stays the one Clarify First question, never an error and never the Back Burner. The classifier is behind a config flag that is off by default until prove-operator-request-to-started-work passes. Ask text that reaches a coding agent through a handoff Ask is marked untrusted.
      - Tests use a stubbed model to cover a pass, a timeout, an unavailable route, a forbidden output type and a malformed output. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: [ask-corrections-stick]
    decisions: []
    references: ["CONSTITUTION.md", "docs/arcadia-ask-product-vision.md", "docs/planning-process.md", "src/commands/ask.ts", "src/intake/index.ts", "src/stewardship/index.ts", "src/commands/todo.ts", "src/clarify/engine.ts", "src/intelligence/types.ts"]
  - id: ask-do-for-me-operator-tasks
    title: Make an Ask for something only the operator can do land in the Yours part of arcadia todo as an operator task.
    status: open
    responsibility: agent
    effort: session
    next_action: Make an Ask for something only the operator can do land in the Yours part of arcadia todo as an operator task.
    expected_artifact: Evidence satisfying Agent Ask ask-do-for-me-operator-tasks
    clarification: clarified
    confidence: high
    source: Agent Ask plan-ask-intent-dispatch-20261008-r2
    acceptance_criteria:
      - "An operator Ask classified as task, or as work whose clarified actor is operator (RESPONSIBILITY_FOR_ACTOR), becomes an Ask-origin operator task stored in the workspace database. It is not written to the checked-in operator-task ledger, so Decision 0028's ledger rules and the no-raw-Ask-text-in-repositories rule are unchanged. arcadia todo lists it in 'Yours' as kind operator_task with origin ask:<ask_id> and an answer command that marks it done or declined, with operator attestation as for ledger tasks. An Ask with no resolvable Project still becomes a task, unscoped; no Project is guessed."
      - "arcadia ask correct gains the 'task' target, and the Discord 'type: task' reply now works. Tests cover the database store, the todo projection, done and declined, the correction target, and the unscoped case. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact."
    depends_on: [ask-receipt-and-one-reply-correction]
    decisions: []
    references: ["CONSTITUTION.md", "docs/arcadia-ask-product-vision.md", "docs/planning-process.md", "src/commands/ask.ts", "src/intake/index.ts", "src/stewardship/index.ts", "src/commands/todo.ts", "src/docs/operatorTasks.ts", "src/clarify/contract.ts"]
  - id: ask-golden-set-and-vanish-report
    title: "Prove Ask routing keeps improving: a checked-in golden set guards it and a weekly report shows the vanish rate."
    status: open
    responsibility: agent
    effort: session
    next_action: "Prove Ask routing keeps improving: a checked-in golden set guards it and a weekly report shows the vanish rate."
    expected_artifact: Evidence satisfying Agent Ask ask-golden-set-and-vanish-report
    clarification: clarified
    confidence: high
    source: Agent Ask plan-ask-intent-dispatch-20261008-r2
    acceptance_criteria:
      - tests/fixtures/ask-golden.jsonl holds paraphrased cases, never raw Ask text, each with an expected type. They are proposed by an agent in a PR, and a reviewed merge is their approval. A test replays every case through the pure intake, memo and stewardship functions and fails CI on any regression.
      - "arcadia ask report [--since <window, default 7d>] [--json] prints these metrics per operator source:\n- vanish rate: operator Asks that, 1 hour after capture, have no open record listed by arcadia todo and no acted, answered or operator-filed Idea outcome; target zero;\n- corrected ÷ classified;\n- questions ÷ Asks;\n- Back Burner arrivals;\n- memo hits;\n- counts of Asks flagged recurrence (the Schedule revival trigger: 3 or more) and planning;\n- corrections not yet backed by a golden case."
      - When 3 or more memos share a corrected type and a token pattern, the report says so. An agent may then propose a deterministic rule and a golden case in a reviewed PR; no rule is generated automatically. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: [ask-corrections-stick]
    decisions: []
    references: ["CONSTITUTION.md", "docs/arcadia-ask-product-vision.md", "docs/planning-process.md", "src/commands/ask.ts", "src/intake/index.ts", "src/stewardship/index.ts", "src/commands/todo.ts", "src/commands/askCoverage.ts"]
questions: []
decisions: []
current_action: prove-operator-request-to-started-work
---

# Operator to-do list with Ask-only input

Created as an inactive draft from accepted Agent Ask operator-todo-ask-pivot-20261008-v6; creation changed no pointer. Current activation is recorded in frontmatter.
