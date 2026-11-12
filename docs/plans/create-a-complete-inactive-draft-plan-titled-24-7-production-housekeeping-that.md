---
arcadia: v1
type: plan
slug: create-a-complete-inactive-draft-plan-titled-24-7-production-housekeeping-that
project: arcadia
status: draft
milestone: Create a complete inactive draft Plan titled 24/7 production housekeeping that orders the Codex-corrected housekeeping list (priorities 0 to 8) for operator acceptance.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-12
actions:
  - id: reconcile-no-go-card-and-run-window
    title: "Priority 0: reconcile the NO-GO production card and the open run-window projection so a held or superseded card cannot appear ready, with no press."
    status: open
    responsibility: agent
    effort: session
    next_action: "Priority 0: reconcile the NO-GO production card and the open run-window projection so a held or superseded card cannot appear ready, with no press."
    expected_artifact: Evidence satisfying Agent Ask reconcile-no-go-card-and-run-window
    clarification: clarified
    confidence: high
    source: Agent Ask plan-24x7-production-housekeeping-20261112
    why: "Conflicting projections (NO-GO comment on #1929 versus a ready-to-press card) must be resolved before any other housekeeping Action runs."
    acceptance_criteria:
      - Work monitor no longer reports the superseded start-run-dashboard-smoke-port card as ready to press, and production status explains why Off.
      - The open run-window projection either closes or shows the reason it remains open, and no press or merge occurs.
      - The reconciliation is recorded through the governed path, not by hand-editing pointers, Action status or queues.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1929"]
  - id: extend-held-action-skip-path-for-named-classes
    title: "Priority 1: extend the existing held-candidate skip path to the named Action-local stop classes so independent authorized work continues while one Action waits; needs Decision D1 answered before any class is widened."
    status: open
    responsibility: agent
    effort: session
    next_action: "Priority 1: extend the existing held-candidate skip path to the named Action-local stop classes so independent authorized work continues while one Action waits; needs Decision D1 answered before any class is widened."
    expected_artifact: Evidence satisfying Agent Ask extend-held-action-skip-path-for-named-classes
    clarification: clarified
    confidence: high
    source: Agent Ask plan-24x7-production-housekeeping-20261112
    why: "The existing three-kind review-repair skip path already exists; only explicitly classified Action-local classes should be added, so a showstopper is not silently bypassed."
    acceptance_criteria:
      - In a zero-model replay where Action A is held, independent Action B lands, and dependent Action C on A never launches, A stays unfinished with its candidate and counters retained.
      - After B's merge and settlement move the pointer, A can be revived and completes without an orphaned candidate or lost counter.
      - Global, unknown, sign-in, authority, STOP, storage and custody failures still stop the affected scope, and no run with parked work is reported as all merged or clean.
      - Widening the held classes is refused until Decision D1 is recorded, and the change is merged only by the operator through the authority-path gate.
    depends_on: [reconcile-no-go-card-and-run-window]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2492"]
  - id: close-coordinator-relay-gates-6-9-10-11
    title: "Priority 2: close coordinator relay gates 6, 9, 10 and 11 and the START interlock so an approved Rowan or Signal successor takes custody without an operator paste; needs Decision D5 and operator merge."
    status: open
    responsibility: agent
    effort: session
    next_action: "Priority 2: close coordinator relay gates 6, 9, 10 and 11 and the START interlock so an approved Rowan or Signal successor takes custody without an operator paste; needs Decision D5 and operator merge."
    expected_artifact: Evidence satisfying Agent Ask close-coordinator-relay-gates-6-9-10-11
    clarification: clarified
    confidence: high
    source: Agent Ask plan-24x7-production-housekeeping-20261112
    why: "Authority under 0191 A exists only for a conditional successor launch; the relay code is present but these gates remain open."
    acceptance_criteria:
      - First registration and correction are bound to a verified Session identity through an approved route, and predecessor stand-down is recorded before successor custody is accepted.
      - A repeated tick cannot launch a duplicate successor, and a successor launch is refused while a START press is in progress.
      - Each separately approved probe P1 and P2 delivers the exact brief and records the actual provider, model and effort.
      - One real Rowan successor and one real Signal successor each accept custody, verify inherited duties, and stop the predecessor, with no operator step.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2500", "https://github.com/pmark/arcadia/issues/2501"]
  - id: stock-bounded-supply-and-start-plan-scope-assertions
    title: "Priority 3: stock one bounded batch of worthwhile independent Actions in an accepted scope and add strict start-plan scope assertions; needs Decision D4 only if restocking is later automated."
    status: open
    responsibility: agent
    effort: session
    next_action: "Priority 3: stock one bounded batch of worthwhile independent Actions in an accepted scope and add strict start-plan scope assertions; needs Decision D4 only if restocking is later automated."
    expected_artifact: Evidence satisfying Agent Ask stock-bounded-supply-and-start-plan-scope-assertions
    clarification: clarified
    confidence: high
    source: Agent Ask plan-24x7-production-housekeeping-20261112
    why: "Production needs permitted, non-filler work; the existing start-run pins, gate-check and executor are reused rather than waiting for the full start-plan product."
    acceptance_criteria:
      - Read-only readiness output lists every ready Action across accepted Plans, gives a reason for each other Action, and shows at least two worthwhile independent Actions in one accepted scope or states the shortfall.
      - Each proposed Action cites a verified Issue or evidence; no tests-only or docs-only label alone makes an Action eligible.
      - Strict replay assertions prove scope derivation and that an unaccepted Plan or out-of-scope Action is never admitted.
      - The batch remains a proposal until the operator accepts it, and no Plan is accepted and no START is granted by this Action.
    depends_on: []
    decisions: []
    references: []
  - id: split-environment-parity-ci-diagnosis-and-port-broker
    title: "Priority 4: land the three environment-parity slices: tmux installed for attributable CI execution (#2515), diagnosis of the stub-provider failures (#2517, research), and a loopback port-broker prototype (#2521); authority and environment-boundary changes wait for operator merge."
    status: open
    responsibility: agent
    effort: session
    next_action: "Priority 4: land the three environment-parity slices: tmux installed for attributable CI execution (#2515), diagnosis of the stub-provider failures (#2517, research), and a loopback port-broker prototype (#2521); authority and environment-boundary changes wait for operator merge."
    expected_artifact: Evidence satisfying Agent Ask split-environment-parity-ci-diagnosis-and-port-broker
    clarification: clarified
    confidence: high
    source: Agent Ask plan-24x7-production-housekeeping-20261112
    why: "Environment parity is the reason held validation fails; the three causes are distinct and must not be unified without proof."
    acceptance_criteria:
      - "The unit CI job installs tmux, and an attributable run shows the tmux-dependent tests executed rather than skipped (#2515)."
      - "The #2517 diagnosis reproduces the failure and records which competing explanation the evidence supports, or lists what remains unproved; it does not merge #2519 into #2517 without proof."
      - "The #2521 prototype proves on a tiny fixture that a session reaches its owned port and is denied an unrelated host service; no broker is rolled out to production."
      - "The #2520 text classifier is not broadened to accept arbitrary AssertionError or exit-1 failures."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2515", "https://github.com/pmark/arcadia/issues/2517", "https://github.com/pmark/arcadia/issues/2519", "https://github.com/pmark/arcadia/issues/2521"]
  - id: start-keeper-automatically-from-existing-keeper-cli
    title: "Priority 5: adapt the existing keeper start and stop CLI to activation and Off hooks, enforcing tier, effort, cap, singleton and supervisor transfer; needs Decisions D5 and D6 (D6 only for work while Off)."
    status: open
    responsibility: agent
    effort: session
    next_action: "Priority 5: adapt the existing keeper start and stop CLI to activation and Off hooks, enforcing tier, effort, cap, singleton and supervisor transfer; needs Decisions D5 and D6 (D6 only for work while Off)."
    expected_artifact: Evidence satisfying Agent Ask start-keeper-automatically-from-existing-keeper-cli
    clarification: clarified
    confidence: high
    source: Agent Ask plan-24x7-production-housekeeping-20261112
    why: "Automatic keeper launch under 0190 is conditional on the relay launcher and probes; the existing background launcher is reused where D5 records it."
    acceptance_criteria:
      - A replayed activation records a keeper launch with model, effort and cap, and a second activation does not launch a second keeper.
      - A custody change re-points the keeper supervisor, and the old keeper stops; the keeper stops at Off unless Decision D6 permits bounded service duty.
      - A heartbeat is observed after launch; a launch record without delivered prompt and heartbeat is reported as failed, not as success.
    depends_on: [close-coordinator-relay-gates-6-9-10-11]
    decisions: []
    references: []
  - id: launch-helpers-from-role-briefs-and-stop-exact-identity
    title: "Priority 6: add custodian-requested helper launch and stop from role briefs using existing launch machinery; needs Decision D3 for autonomous replacement beyond existing assigned-help authority."
    status: open
    responsibility: agent
    effort: session
    next_action: "Priority 6: add custodian-requested helper launch and stop from role briefs using existing launch machinery; needs Decision D3 for autonomous replacement beyond existing assigned-help authority."
    expected_artifact: Evidence satisfying Agent Ask launch-helpers-from-role-briefs-and-stop-exact-identity
    clarification: clarified
    confidence: high
    source: Agent Ask plan-24x7-production-housekeeping-20261112
    why: "Helpers need launch and stop without a host step; reviewer and QA remain separate independent Sessions under 0114."
    acceptance_criteria:
      - A custodian starts and stops one light helper from its role brief with no host step, and the stop targets the exact recorded session identity.
      - "The launch receipt reports the actual model and effort, and a wrong-model helper is reported as a mismatch (#2501)."
      - A refused permission produces a refusal receipt rather than a bypass, and no helper dispatches a further helper.
    depends_on: [close-coordinator-relay-gates-6-9-10-11]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2500", "https://github.com/pmark/arcadia/issues/2501"]
  - id: compose-scope-safe-fallback-across-accepted-plans
    title: "Priority 7: record the Decision 0122 fallback preference and compose a scope-safe transition to a second accepted Plan; needs Decision D2 for any wider run or day envelope."
    status: open
    responsibility: agent
    effort: session
    next_action: "Priority 7: record the Decision 0122 fallback preference and compose a scope-safe transition to a second accepted Plan; needs Decision D2 for any wider run or day envelope."
    expected_artifact: Evidence satisfying Agent Ask compose-scope-safe-fallback-across-accepted-plans
    clarification: clarified
    confidence: high
    source: Agent Ask plan-24x7-production-housekeeping-20261112
    why: "Plan boundaries should not idle eligible work, but a preference alone is not admission and must not widen any approval."
    acceptance_criteria:
      - A two-Plan fixture with an explicit accepted order finishes Plan 1 and admits Plan 2's first Action without a new press.
      - No unapproved Plan or out-of-scope Action launches, including when a preference changes mid-run.
      - Preference writes require operator presence, and a preference selection alone does not admit work.
    depends_on: [stock-bounded-supply-and-start-plan-scope-assertions]
    decisions: []
    references: []
  - id: add-duty-alarms-and-idle-reporting-with-guidance
    title: "Priority 8: update guidance as behavior lands and add bounded duty alarms and idle reporting to the existing timer and read model; guidance and timer authority paths need operator merge."
    status: open
    responsibility: agent
    effort: session
    next_action: "Priority 8: update guidance as behavior lands and add bounded duty alarms and idle reporting to the existing timer and read model; guidance and timer authority paths need operator merge."
    expected_artifact: Evidence satisfying Agent Ask add-duty-alarms-and-idle-reporting-with-guidance
    clarification: clarified
    confidence: high
    source: Agent Ask plan-24x7-production-housekeeping-20261112
    why: "Idle time must be loud and attributable, but alarms must not become the production engine or repeat per incident."
    acceptance_criteria:
      - Duty alarms fire once per root idle episode when the ready count is below the floor, when Off has nothing eligible, or when no custodian is live for ten minutes, and a healthy long Action is not reported as idle.
      - Idle duration is recorded by cause with owner and next event, and delivery and acknowledgment are recorded separately.
      - "An installed revision and one real wake receipt are recorded, and aggregate #2501 performance telemetry is deferred until enough real launch receipts exist."
    depends_on: []
    decisions: []
    references: []
questions: []
decisions: []
---

# Create a complete inactive draft Plan titled 24/7 production housekeeping that orders the Codex-corrected housekeeping list (priorities 0 to 8) for operator acceptance.

Created as an inactive draft from accepted Agent Ask plan-24x7-production-housekeeping-20261112; creation changed no pointer. Current activation is recorded in frontmatter.
