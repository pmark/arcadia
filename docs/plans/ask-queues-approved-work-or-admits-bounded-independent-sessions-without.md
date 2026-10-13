---
arcadia: v1
type: plan
slug: ask-queues-approved-work-or-admits-bounded-independent-sessions-without
project: arcadia
status: draft
milestone: Ask queues approved work or admits bounded independent Sessions without disrupting in-flight work; first prove Codex Luna Hello World to an independently reviewed green PR with production Off.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-13
actions:
  - id: scout-isolation-preflight
    title: Implement a deterministic Luna scout preflight and offline replay of the retained failed trial before any new model call.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement a deterministic Luna scout preflight and offline replay of the retained failed trial before any new model call.
    expected_artifact: Evidence satisfying Agent Ask scout-isolation-preflight
    clarification: clarified
    confidence: high
    source: Agent Ask plan-queue-independent-luna-scout-20261013-v3
    why: "The previous trial stopped at an unattributed Codex-config change; a new live run cannot assume trust-only attribution."
    acceptance_criteria:
      - Replay the retained one-file Ask and failed approval packet without model calls; preserve original evidence and separate verified causes from hypotheses.
      - The preflight receipt records an immutable source revision, Node 22 runtime, exact gpt-6-luna model/effort, experiment scope and before-state snapshots including protected content sufficient for attribution without exposing secrets; a focused fixture test verifies each recorded pin.
      - A config change is admitted only when a content diff proves the exact permitted fixture trust entry; every other or unattributed change stops the run. Resolve the prior stop by verified attribution or a specifically recorded operator Decision; a fresh baseline alone cannot clear it.
      - Fixture-only commands carry explicit workspace scope; live Project/queue/production changes fail the isolation check. Focused preflight tests use fixtures and make zero provider calls.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1356", "https://github.com/pmark/arcadia/issues/1357", "https://github.com/pmark/arcadia/issues/1320", "docs/agent-guidance/ask-todo-scout.md", "docs/agent-guidance/operator-directed-work.md", "docs/decisions/0124-decide-how-a-new-ask-is-admitted-while-a-plan-or-action-is-in-flight-preserve.md"]
  - id: repair-scout-approved-handoff
    title: Implement the smallest repair that carries an approved exact-scope Ask into an executable Luna packet without a repeated approval gate.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement the smallest repair that carries an approved exact-scope Ask into an executable Luna packet without a repeated approval gate.
    expected_artifact: Evidence satisfying Agent Ask repair-scout-approved-handoff
    clarification: clarified
    confidence: high
    source: Agent Ask plan-queue-independent-luna-scout-20261013-v3
    why: "The real builder declined an allegedly approved packet; CreateWork also added tests to the explicit one-file artifact request."
    acceptance_criteria:
      - Given the exact HelloWorld.txt-only request, the generated approved scope and Artifact remain exactly that request; tests/validation are harness-owned and do not widen the builder file scope. Regression covers issue 1357.
      - An approval packet names the applicable approval receipt and bounded assignment authority, removes stale approve-or-reject instructions, and carries a valid governed Action when that execution route requires one. It never fabricates an Action or treats a null Action as permission. Regression covers the contradictory packet in issue 1356.
      - Unapproved, revoked or stale approval still refuses execution; replay deterministically proves both approved and refused cases without model calls.
    depends_on: [scout-isolation-preflight]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1356", "https://github.com/pmark/arcadia/issues/1357", "https://github.com/pmark/arcadia/issues/1320", "docs/agent-guidance/ask-todo-scout.md", "docs/agent-guidance/operator-directed-work.md", "docs/decisions/0124-decide-how-a-new-ask-is-admitted-while-a-plan-or-action-is-in-flight-preserve.md"]
  - id: expose-scout-run-evidence
    title: Implement Ask and To-do correlation with the approved Run and its observable result through existing CLI/API read models.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement Ask and To-do correlation with the approved Run and its observable result through existing CLI/API read models.
    expected_artifact: Evidence satisfying Agent Ask expose-scout-run-evidence
    clarification: clarified
    confidence: high
    source: Agent Ask plan-queue-independent-luna-scout-20261013-v3
    why: "Approval returned run:null and claimed resuming even though Ask show could not expose the failed Run."
    acceptance_criteria:
      - Approval distinguishes queued, running, failed/requires-review and completed truthfully; a linked Run is returned when created or later discoverable using the original Ask identity. Cover issue 1320.
      - Ask show and To-do expose the same Run state, waiting reason, Artifact status and evidence references; retrying request IDs creates no duplicate work.
      - Queued or approval receipts alone never count as completed Hello World. Focused tests assert shared CLI/API data; no separate UI orchestration or polling authority.
    depends_on: [repair-scout-approved-handoff]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1356", "https://github.com/pmark/arcadia/issues/1357", "https://github.com/pmark/arcadia/issues/1320", "docs/agent-guidance/ask-todo-scout.md", "docs/agent-guidance/operator-directed-work.md", "docs/decisions/0124-decide-how-a-new-ask-is-admitted-while-a-plan-or-action-is-in-flight-preserve.md"]
  - id: prove-luna-scout-green-pr
    title: Run one explicitly authorized bounded manual Luna scout through Ask and To-do and preserve its Hello World delivery as an independently reviewed green PR.
    status: open
    responsibility: agent
    effort: session
    next_action: Run one explicitly authorized bounded manual Luna scout through Ask and To-do and preserve its Hello World delivery as an independently reviewed green PR.
    expected_artifact: Evidence satisfying Agent Ask prove-luna-scout-green-pr
    clarification: clarified
    confidence: high
    source: Agent Ask plan-queue-independent-luna-scout-20261013-v3
    why: "Prove the smallest complete path while managed production stays Off before building automatic side-session admission."
    acceptance_criteria:
      - Before the run, the isolation stop is resolved, disposable repository and any dedicated remote are explicitly identified/authorized, provider capacity is checked, and exact source/runtime/model pins are recorded. Never create/use a remote from a guessed destination.
      - One scout persona uses only Ask and To-do for system interaction; setup, operator approval transport, one bounded existing executor iteration, host Git/PR preservation and the independent oracle are separately labelled harness responsibilities. No new scheduler, production activation, shared service restart or fixture bypass.
      - Pin gpt-6-luna at low effort initially; allow one builder attempt with a 90-second cap, no implicit provider fallback, paid credits/reset or automatic retry. Independent review is a separate bounded role. Any later attempt requires a named failure and explicit bounded authorization. Record actual usage separately from deterministic cost; do not claim free or infer monetary cost.
      - The independent oracle verifies exact HelloWorld.txt bytes Hello World! followed by one newline, no other builder file changes, completed correlated Run and accepted Artifact. Distinguish this artifact verdict from PR delivery verdict.
      - Preserve the delivery with host-owned semantic Git identity in an isolated candidate, linked PR, independent review of the current head and all repository-required checks green. Stop before merge/deploy. A timeout, absent file, validator failure, scope leak or red review yields No with evidence and actionable logged defects, never a green claim.
      - Collect a hash manifest, sanitized receipts, prompt/argv, runtime/source/model pins, validation results, usage, bug links, Run/Artifact/PR ids, review and exact-head checks. Production remains Off and the live Plan/current Action/queue are unchanged.
    depends_on: [scout-isolation-preflight, expose-scout-run-evidence]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1356", "https://github.com/pmark/arcadia/issues/1357", "https://github.com/pmark/arcadia/issues/1320", "docs/agent-guidance/ask-todo-scout.md", "docs/agent-guidance/operator-directed-work.md", "docs/decisions/0124-decide-how-a-new-ask-is-admitted-while-a-plan-or-action-is-in-flight-preserve.md"]
  - id: implement-bounded-independent-admission
    title: Implement queue and independent-Session disposition using existing admission, claims and scheduling controls after the scout reaches a green PR.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement queue and independent-Session disposition using existing admission, claims and scheduling controls after the scout reaches a green PR.
    expected_artifact: Evidence satisfying Agent Ask implement-bounded-independent-admission
    clarification: clarified
    confidence: high
    source: Agent Ask plan-queue-independent-luna-scout-20261013-v3
    why: "Decision 0124 selects parallel independent work without disrupting the in-flight Plan."
    acceptance_criteria:
      - Default executable intake queues approved work; independent Sessions require verified operator identity or exact standing authorization, one concrete assignment, free permitted capacity and isolated ownership. Requesting interruption only opens a pinned operator choice; this Action does not implement automatic preemption.
      - Urgency maps to the existing operator-owned scheduling authority under Decisions 0048/0054/0122, with visible preview/receipt; no competing priority store or implicit queue write from proposal capture.
      - Fixtures prove production Off blocks all new automatic admissions, occupied slots wait, overlapping work/dependencies wait or refuse, and request-id replay causes no duplicate Session. Existing committed work is not killed.
      - Fixtures prove an independent Session leaves the active Plan/current Action unchanged, shares the same capacity gate as ordinary work, terminates at reviewed green PR or a truthful bounded blocker, and cannot merge or widen authority.
    depends_on: [prove-luna-scout-green-pr]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1356", "https://github.com/pmark/arcadia/issues/1357", "https://github.com/pmark/arcadia/issues/1320", "docs/agent-guidance/ask-todo-scout.md", "docs/agent-guidance/operator-directed-work.md", "docs/decisions/0124-decide-how-a-new-ask-is-admitted-while-a-plan-or-action-is-in-flight-preserve.md", "docs/decisions/0122-decide-whether-production-admission-follows-an-operator-owned-project.md"]
  - id: project-disposition-through-cli-api-ui
    title: Expose the same Ask disposition, effective order, waiting reason and Session/Run/PR evidence in CLI, API and the existing Ask/To-do UI.
    status: open
    responsibility: agent
    effort: session
    next_action: Expose the same Ask disposition, effective order, waiting reason and Session/Run/PR evidence in CLI, API and the existing Ask/To-do UI.
    expected_artifact: Evidence satisfying Agent Ask project-disposition-through-cli-api-ui
    clarification: clarified
    confidence: high
    source: Agent Ask plan-queue-independent-luna-scout-20261013-v3
    why: "Efficient CLI/API and accessible UI must operate on one shared data contract."
    acceptance_criteria:
      - CLI/API/UI accept and render capture-only, queued, independent Session or request-interruption without client-specific execution logic; show effective ordering and truthful eligibility/blockers.
      - An end-to-end fixture verifies queue plus independent Sessions with Off, occupied slot, conflict, duplicate request and stale interruption pins; it performs zero external/model calls.
      - Update START_HERE.md and operator guidance with the supported flow and actual remote-reachable controls; unsupported or unimplemented behavior remains visibly deferred.
    depends_on: [implement-bounded-independent-admission]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1356", "https://github.com/pmark/arcadia/issues/1357", "https://github.com/pmark/arcadia/issues/1320", "docs/agent-guidance/ask-todo-scout.md", "docs/agent-guidance/operator-directed-work.md", "docs/decisions/0124-decide-how-a-new-ask-is-admitted-while-a-plan-or-action-is-in-flight-preserve.md"]
questions: []
decisions: []
---

# Ask queues approved work or admits bounded independent Sessions without disrupting in-flight work; first prove Codex Luna Hello World to an independently reviewed green PR with production Off.

Created as an inactive draft from accepted Agent Ask plan-queue-independent-luna-scout-20261013-v3; creation changed no pointer. Current activation is recorded in frontmatter.
