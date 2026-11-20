---
arcadia: v1
type: plan
slug: draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production
project: arcadia
status: active
milestone: "Draft an inactive Plan of five bounded Actions that keep unattended production running between batches without a person: survive the operator's merges to main, repair mechanically red candidates, start the next approved Plan, and stop Decision-number collisions"
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-20
actions:
  - id: retry-successor-press-when-main-moves
    title: When main moves while the host timer is between derive and press, the timer retires that card and derives a fresh one on a later tick instead of ending the standing grant's loop, so the operator can merge to main freely while production runs.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-retry-successor-press-when-main-moves-73b81bde0aac; no further action.
    expected_artifact: Evidence satisfying Agent Ask retry-successor-press-when-main-moves
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-review-findings-20261117
    why: "Since #2765 a merge during the up-to-40-minute replay and preflight window ends the unattended loop for the whole grant and pings; the operator wants to merge freely."
    acceptance_criteria:
      - A failing-first test shows that a main move between derive and press retires the card with a receipt naming the old and new main revisions, does not end the step, and leads to a fresh derivation at the new main on a later tick.
      - A refusal (origin-moved, or CARD_NOT_DERIVED at replay, preflight or press) is retryable only when the card's pinned main revision differs from origin main read at the failing check. A CARD_NOT_DERIVED with an unchanged main (for example a differing field or NO_READY_ACTIONS) keeps today's sticky end; tests cover both cases.
      - Consecutive main-moved retries are bounded by a named constant. Exceeding it ends the step with exactly one ping naming the cause; a test covers both sides of the bound.
      - Every other refusal code keeps today's sticky behavior, shown by the existing successor-press tests passing unchanged.
      - A derived card's lifetime is at least the replay timeout plus the preflight timeout, enforced by a test that fails if either constant changes without the other.
      - The freeze guidance (rehearsal-freeze-window.md and operator-actions.md) states the retry bound's value and says that while a standing grant is open a merge to main voids nothing and delays the next press by at most that many derivations, after which the step ends with one ping. The work merge-check message stops telling the operator not to merge for a timer-derived card.
    depends_on: []
    decisions: []
    references: ["src/production/successorPress.ts", "src/commands/productionSuccessor.ts", "src/operatorActions/startRunDerive.ts", "scripts/start-run.sh", "docs/agent-guidance/rehearsal-freeze-window.md", "docs/agent-guidance/operator-actions.md", "docs/decisions/0241-may-one-standing-start-grant-replace-the-daily-approval-of-decision-0173-so.md"]
  - id: repair-mechanical-check-failures-deterministically
    title: When a production candidate's required checks fail only on mechanical classes (lint auto-fixable rules, a stale guidance fingerprint, current_action left behind after a base merge), production applies the class's existing generator to the candidate, pushes a new production-owned head and lets it be reviewed afresh, with no model call and no person.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: A tested leaf library, src/production/mechanicalRepair.ts, classifies mechanically red required checks and decides which existing generator runs, for at most one deterministic round per candidate head, with no model call. Its wiring into production is carried by wire-mechanical-repair-into-production.
    expected_artifact: Evidence satisfying Agent Ask repair-mechanical-check-failures-deterministically
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-six-bugs-and-2777-20261117e-alt2
    why: "Seven of seven candidates since 2026-11-15 stopped for a hand fix, and every fix was mechanical; Decision 0247 E says deterministic fixes come first."
    acceptance_criteria:
      - "A pure classifier maps a failing required check's log to one of: lint-autofixable, guidance-fingerprint, stale-current-action, or unknown. Fixture tests use the recorded failures of #2752, #2758, #2765 and #2766 and classify each one correctly."
      - "For each known class the repair runs only that class's existing generator, never a hand edit: eslint --fix limited to the candidate's changed files, the fingerprint generator for guidance documents the candidate itself changed, and the governed pointer advance. A test shows a fingerprint is never refreshed for a document outside the candidate's diff."
      - Repair is bounded to one deterministic round per candidate head. An unknown class or a still-red check after the round hands off to the bounded repair Session of the next Action and never loops; tests show both.
      - Unit tests in tests/mechanical-repair.test.ts at c7d7fba5f cover the production-owned-head rule and the once-per-episode notice as library functions; their wiring into the tick, the review and the alert path is carried by Action wire-mechanical-repair-into-production.
    depends_on: []
    decisions: []
    references: ["src/production/tick.ts", "src/production/workerMerge.ts", "src/production/independentReview.ts", "docs/agent-guidance/fingerprints.json", "docs/decisions/0247-should-production-repair-a-candidate-that-fails-lint-budget-fingerprint-or.md", "docs/notes-to-self.md"]
  - id: repair-red-candidates-with-a-bounded-session
    title: When a candidate stays red after the deterministic round, production launches one bounded coding-agent repair Session on that candidate, briefed with the failing check logs, which produces a new reviewed head or parks the candidate with one ping that meets the operator-attention criteria.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: When a candidate stays red after the deterministic round, production launches one bounded coding-agent repair Session on that candidate, briefed with the failing check logs, which produces a new reviewed head or parks the candidate with one ping that meets the operator-attention criteria.
    expected_artifact: Evidence satisfying Agent Ask repair-red-candidates-with-a-bounded-session
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-six-bugs-and-2777-20261117e-alt2
    why: "Decision 0247 E: after deterministic fixes, a coding-agent repair Session produces a new reviewed head; the operator is pinged only when the attention criteria are met. Classification and fixture failures need judgment, not a generator."
    acceptance_criteria:
      - "The repair Session's brief contains the failing required checks' log excerpts and the classifier's verdict. A test asserts the brief text for the recorded #2744 lint-and-classification failure."
      - A new module that the authority or command classification lists do not cover is classified most-restrictive (authority-adjacent) by default, so the repair can never weaken a guard. A test shows a repair that would classify a module as less restrictive is refused.
      - The repair runs on the light tier first, makes at most one attempt per candidate head, uses no paid fallback and stays inside the existing repair budget. A test shows a refused spend or capacity check launches nothing and leaves a receipt.
      - A successful repair's head is reviewed afresh by the worker and merges only under the 0060/0080 gate. A failed repair parks the candidate and sends exactly one ping that names the failing check, the attempted fix and the operator-attention criterion it meets.
      - A fixture run replays one recorded red candidate through both repair rounds to a green, reviewed head with zero operator touches, and the run record lists the touches as none.
    depends_on: [repair-mechanical-check-failures-deterministically, wire-mechanical-repair-into-production, finish-wire-repair-verdict-case-and-absorb-proposal]
    decisions: []
    references: ["src/production/tick.ts", "src/production/independentReview.ts", "src/decisions/batchMerge.ts", "docs/decisions/0247-should-production-repair-a-candidate-that-fails-lint-budget-fingerprint-or.md", "docs/decisions/0181-decide-what-unattended-production-does-after-attempt-3-s-clean-run-re-deciding.md", "docs/decisions/0187-decide-what-unattended-production-does-after-a-delegated-batch-fails-under-the.md", "CONSTITUTION.md"]
  - id: queue-approved-plans-and-start-the-next
    title: A governed record on main holds the ordered list of Plans the operator approved for production, and when the standing grant's current Plan reaches scope complete the host timer activates the next queued Plan and continues pressing its cards, instead of turning production Off and waiting.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: A governed record on main holds the ordered list of Plans the operator approved for production, and when the standing grant's current Plan reaches scope complete the host timer activates the next queued Plan and continues pressing its cards, instead of turning production Off and waiting.
    expected_artifact: Evidence satisfying Agent Ask queue-approved-plans-and-start-the-next
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-lanes-20261119
    why: "Decision 0241 E: the operator stacks Plans on the work queue and expects Arcadia to work through each. Today no record holds that stack and the timer stops at scope complete."
    acceptance_criteria:
      - A checked-in Plan-queue record per Project lists approved Plan slugs in order. Only a settled Agent Ask carrying the operator's approval can add, remove or reorder entries; a test shows any other write path is refused.
      - A read-only command prints the Plan queue with each Plan's status and readiness. A Plan is ready when every remaining Action has observable acceptance and none cites an open Decision or names an authority path the deriver stops at. Tests cover a ready Plan and two not-ready ones.
      - The deriver (src/operatorActions/startRunDerive.ts) accepts a Plan under an open standing grant only if it is the grant's pinned Plan or the Project's active Plan and an entry of the approved Plan-queue record at the same origin main revision. Any other Plan refuses with a named code, and the grant's end conditions are unchanged. Tests cover the pinned Plan, a queued activated Plan, and an active Plan missing from the record.
      - When the active Plan completes while production is Active, the worker activates the next ready approved Plan through the governed pointer transition and admits its first Action, with no card shown to anyone; a not-ready next Plan, or an empty queue, turns production Off with exactly one ping naming the reason. Tests cover all three.
      - The derived card for a newly activated Plan passes the existing replay and press checks; the card-integrity suite from prove-card-integrity-against-recorded-defects still passes, extended with a fixture for a queued-Plan card.
      - Plan let-the-operator-change-what-production-queues-from-the-production-project records, through a governed amendment, that its single-Project ordering is delivered here and that its multi-Project preference Actions remain, with a revival trigger.
      - production-replay gains a Plan-to-Plan scenario (the last Action of one Plan merges, the next approved Plan activates, its first Action is admitted) and it passes before any continuous night.
      - "The queue has two lanes across every operator-approved Plan: an operator lane for an Action whose declared change paths touch the shared gate set, docs/decisions, an agent_permissions path or CONSTITUTION.md, and an autonomous lane for every other Action; a test classifies a fixture of Plan F's and Plan G's 2026-11-19 Actions into the expected lanes."
      - "Admission draws the next ready Action across all approved Plans, not only the active one: autonomous-lane Actions at any hour; operator-lane Actions only inside a configured operator window (default 7 AM-9 PM Pacific), or built at night and parked for the morning batch with dependents held once park-and-continue is live. Tests cover each case."
      - An expedited approved Action takes the next slot in its lane under the same gates and never preempts running work; a test covers it.
      - "At merge the diff decides: an autonomous-lane PR whose diff touches the gate set or a hard class parks; a test shows it."
      - The 48h ready view and the 8 AM report split each slot into DAY (operator lane) and NIGHT (autonomous lane) and flag a night with no eligible autonomous work; a test asserts the flag on the 2026-11-19 fixture.
      - "Plan-completion check moved from require-pre-pr-before-every-pull-request (its criterion 3, which P5 cannot meet by itself, per the review at https://github.com/pmark/arcadia/pull/2852#issuecomment-7015286763): before Plan F is recorded complete, the first production candidate PR merged after P5 shows pnpm pre-pr output in its description, and that PR is cited."
    depends_on: [retry-successor-press-when-main-moves, wire-mechanical-repair-into-production, publish-governance-commits-from-the-clone, require-proof-for-every-met-criterion, show-the-resulting-queue-order-in-settle-preview, finish-wire-repair-verdict-case-and-absorb-proposal]
    decisions: []
    references: ["src/production/successorPress.ts", "src/dispatch/queue.ts", "src/dispatch/pointer.ts", "src/plans/nextPlanSelector.ts", "src/operatorActions/planQueue.ts", "src/ask/agentAsk.ts", "docs/decisions/0241-may-one-standing-start-grant-replace-the-daily-approval-of-decision-0173-so.md", "docs/plans/let-the-operator-change-what-production-queues-from-the-production-project.md"]
  - id: allocate-decision-numbers-on-main-and-refuse-duplicates
    title: Decision numbers are allocated against origin main at settle or mint time, and a required check fails any pull request that adds a Decision id its base already has, so two Decisions never share a number again.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask rowan25-split-allocate-criteria-4-and-6-20261119; no further action.
    expected_artifact: Evidence satisfying Agent Ask allocate-decision-numbers-on-main-and-refuse-duplicates
    clarification: clarified
    confidence: high
    source: Agent Ask rowan25-split-allocate-criteria-4-and-6-20261119
    why: "Operator, 2026-11-17: 'This needs to never happen again.' Collisions recurred on 0240 and 0250, and every START press now mints a Decision on main."
    acceptance_criteria:
      - A test reproduces the 0250 race (an Ask settle candidate chooses N while a START sign-in mints N on main) and shows the second writer receives N+1 or refuses. No two Decision files on main share an id.
      - A required CI check fails a pull request that adds a docs/decisions file whose id already exists on its base, naming both files. The four historical pairs are grandfathered by an explicit list, and a test shows a fifth pair fails.
      - Every Arcadia merge path (the worker merge and the operator batch-merge card) re-runs the duplicate check against current origin main immediately before merging and refuses on a duplicate. A test with two pull requests that each add id N against the same base shows the second is refused after the first merges.
      - START sign-in usage-check Decisions take their id at the moment they are written to main, from origin main, and a test shows a concurrent open PR's Decision does not block or collide with them.
    depends_on: []
    split_into: [finish-allocate-push-ping-and-supersede-older-action]
    decisions: []
    references: ["src/docs/sync.ts", "src/docs/types.ts", "src/docs/operatorGate.ts", "src/production/startRunSignIn.ts", "src/production/workerClaudeUsageDiagnostic.ts", "docs/plans/seven-verified-settlement-queue-and-preservation-integrity-bugs-are-fixed-and.md"]
  - id: run-successor-press-from-a-current-timer-release
    title: The checked-in services.sh liveness step installs a release from current main that contains successorPress, including the main-moved retry, and writes --successor-press into the liveness plist, so the host timer can press successor cards once a standing grant is open.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-run-successor-press-from-a-current-timer-release-0f512640e40a; no further action.
    expected_artifact: Evidence satisfying Agent Ask run-successor-press-from-a-current-timer-release
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-six-bugs-and-2777-20261117e-alt2
    why: "Issue #2778: the timer runs release 6ff679ba5 with no successorPress code and no --successor-press flag, while docs/agent-guidance/operator-actions.md:383 says it is wired. A standing grant would press nothing."
    acceptance_criteria:
      - A test of the liveness step's generated plist shows its ProgramArguments contain production liveness-check and --successor-press, and no other checked-in source writes the liveness plist.
      - The step refuses to point the timer at a release that does not contain the successor-press retry (commit ddfae2b62 or a descendant), naming the release and the missing commit; a test covers refusal and acceptance.
      - The step installs only while production is Off, refusing with a named reason otherwise; a test covers both states.
      - docs/agent-guidance/operator-actions.md describes the timer's flag and release exactly as the step sets them, and states that no standing-grant press is expected until the live proof Action is done.
      - Proposal agentask_2a475e6ceff828199d is recorded as absorbed by this Action and the next, with its receipt id cited in this Action's completion evidence.
    depends_on: []
    decisions: []
    references: ["scripts/services.sh", "src/commands/productionLiveness.ts", "src/production/successorPress.ts", "docs/agent-guidance/operator-actions.md"]
  - id: refuse-agent-merges-while-a-card-is-pinned
    title: "While a per-run START or activation card is pinned and unpressed, every Arcadia agent merge path refuses a merge to main with 'merge freeze: card <id> pinned to <sha>', so another session's merge can no longer void the operator's press."
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-refuse-agent-merges-while-a-card-is-pinned-d75fd7dd8c6b; no further action.
    expected_artifact: Evidence satisfying Agent Ask refuse-agent-merges-while-a-card-is-pinned
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-six-bugs-and-2777-20261117e-alt2
    why: "Issue #2779: Flynn's Field Notes merges voided card E on 2026-11-17, and Field Notes merges moved main under a pinned batch D card. The freeze existed only in chat between Rowan and Signal."
    acceptance_criteria:
      - "With a per-run START or activation card pinned and unpressed, an agent merge of an unrelated PR through each Arcadia merge path (the worker merge, the batch-merge card script, and the merge step the nightshift and arcadia-signal skills call, which Momentum Keeper sessions also follow) fails with 'merge freeze: card <id> pinned to <sha>', and the card survives; tests cover each path."
      - The freeze lifts on press, expiry or Off, and a merge the run itself makes is never refused; tests cover each.
      - A timer-derived standing-grant card and a running batch do not freeze merges (they re-derive or tolerate a forward main move); tests show both.
      - "An explicit operator override, recorded with a receipt naming the card and the PR, lets one merge through; nothing in this Action blocks the operator's own GitHub merges or changes branch protection, and the guidance says so with a revival trigger: an agent merge that bypasses the gate and voids a card."
      - The nightshift and arcadia-signal skills, and the Momentum Keeper brief in docs/agent-guidance/session-roles-and-briefs.md, call the gate before any merge. Each skill keeps one SKILL.md source, discoverable at the .agents/skills and .claude/skills paths for Codex, Claude Code and OpenCode; a skill check covers all three discovery paths.
    depends_on: []
    decisions: []
    references: ["src/workMonitoring/runWindow.ts", "src/commands/workMonitor.ts", "src/production/workerMerge.ts", "scripts/merge-decision-card-batch.ts", "docs/agent-guidance/rehearsal-freeze-window.md", "docs/agent-guidance/session-roles-and-briefs.md"]
  - id: prove-the-timer-runs-the-successor-press-live
    title: "On the live host, after production's Off, the liveness timer runs a release containing the successor-press retry with --successor-press, shown by recorded evidence, under the operator's approval recorded in Issue #2778."
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-prove-the-timer-runs-the-successor-press-live-20261118; no further action.
    expected_artifact: Evidence satisfying Agent Ask prove-the-timer-runs-the-successor-press-live
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-six-bugs-and-2777-20261117e-alt2
    why: "Issue #2778's acceptance is a live check; until it passes, no standing-grant press."
    acceptance_criteria:
      - With production Off, the services.sh liveness step from the merged build Action is run once on the live host, and its output is saved as a receipt.
      - plutil -p of the liveness plist shows --successor-press, and the release it names contains commit ddfae2b62 (git merge-base --is-ancestor), both saved in the receipt.
      - One liveness tick after the install logs the successor step's named skip (GRANT_NOT_OPEN while no standing grant is open), proving the installed job runs the step; the log line is saved in the receipt.
      - "Issue #2778 is closed citing the receipt."
    depends_on: [run-successor-press-from-a-current-timer-release]
    decisions: []
    references: ["scripts/services.sh", "docs/agent-guidance/operator-actions.md"]
  - id: reconcile-current-action-after-a-base-merge
    title: Merging main into a batch candidate, or merging two sibling batch candidates in either order, always leaves exactly one valid current Action with no hand edit, through a deterministic governed reconcile.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Merging main into a batch candidate, or merging two sibling batch candidates in either order, always leaves exactly one valid current Action with no hand edit, through a deterministic governed reconcile.
    expected_artifact: Evidence satisfying Agent Ask reconcile-current-action-after-a-base-merge
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-target-migration-20261119-aplus3b
    why: "Issue #2780: after #2745 merged, #2746's base merge kept a current_action that #2746 had marked done, failing the managed-documents contract and stalling the batch about 5 hours; the host refused the two-line hand fix."
    acceptance_criteria:
      - A test merges two sibling batch candidates in either order and shows main ends with a single valid current Action, with no manual edit.
      - The reconcile is the same governed implementation the stale-current-action repair class of repair-mechanical-check-failures-deterministically uses; a test or code reference shows there is one implementation, not two.
      - "A recorded fixture of the #2746 state (c23c38232 merged with main) passes tests/managed-documents-contract.test.ts after the reconcile."
      - No agent or operator hand-edits a pointer; the guidance names the governed command or settlement step that performs the reconcile.
    depends_on: [repair-mechanical-check-failures-deterministically, verify-overnight-merges-at-8am]
    decisions: []
    references: ["src/ask/settlement.ts", "src/dispatch/pointer.ts", "tests/managed-documents-contract.test.ts"]
  - id: keep-pointer-commits-mergeable-across-a-date-change
    title: "Unpushed production pointer commits on local main reconcile with a remote commit that changed only PROJECT.md's updated: date, without a hand merge and without blocking START, and arcadia go's no-resolve boundary (#2023) is unchanged."
    status: deferred
    responsibility: agent
    execution: build
    effort: session
    next_action: "Unpushed production pointer commits on local main reconcile with a remote commit that changed only PROJECT.md's updated: date, without a hand merge and without blocking START, and arcadia go's no-resolve boundary (#2023) is unchanged."
    expected_artifact: Evidence satisfying Agent Ask keep-pointer-commits-mergeable-across-a-date-change
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-handoff-and-pre-pr-20261118-a
    why: "Issue #2029: a date rollover makes updated: (next to current_action in PROJECT.md) conflict even when both sides agree on the pointer, leaving local main ahead and behind and blocking make-next and START."
    acceptance_criteria:
      - "A test reproduces the recorded shape (local main ahead and behind, with the only conflict being updated: in PROJECT.md across a date change while both sides name the same current_action) and shows the reconcile completes without a hand merge."
      - "The fix is the smaller one Issue #2029 names: settlement or pointer commits stop producing a conflicting updated: next to current_action, or the existing reviewed resolver runs as a validated host step. arcadia go still never resolves a conflict itself, shown by its existing tests passing unchanged."
      - "If neither smaller fix satisfies the first criterion, the Action stops and submits a proposal for an operator Decision about the #2023 boundary instead of changing it."
      - "Issue #2029 is closed citing the merged PR."
    depends_on: [require-pre-pr-before-every-pull-request]
    decisions: []
    references: ["src/git/pointerReconcile.ts", "src/ask/settlement.ts", "src/production/tick.ts"]
  - id: accept-registration-after-a-recorded-stand-down
    title: arcadia coordinator register accepts the successor immediately after a verified stand-down, or a TAKE CUSTODY ACK naming the successor, even if the predecessor's transcript is written afterwards.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-accept-registration-after-a-recorded-stand-down-r26; no further action.
    expected_artifact: Evidence satisfying Agent Ask accept-registration-after-a-recorded-stand-down
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-handoff-and-pre-pr-20261118-a
    why: "Issue #2781: Rowan 20's registration kept refusing because cross-session messages kept writing Rowan 19's transcript inside the freshness window, and the operator had to archive Rowan 19 by hand."
    acceptance_criteria:
      - A test shows register succeeds immediately after a recorded stand-down even when the predecessor's transcript is written within the freshness window afterwards.
      - A test shows a TAKE CUSTODY ACK naming the successor has the same effect, and an ACK naming a different session does not.
      - Without a recorded stand-down or a matching ACK, the existing custodian_session_live refusal is unchanged; the existing coordinator tests pass.
      - "Issue #2781 is closed citing the merged PR."
    depends_on: [require-pre-pr-before-every-pull-request]
    decisions: []
    references: ["src/commands/coordinator.ts", "src/coordinator/generations.ts", "src/coordinator/state.ts"]
  - id: explain-the-ping-length-limit
    title: arcadia ping send with a message over the 500-character limit fails with a one-line error naming the message length and the limit, instead of a bare exit 2.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-explain-the-ping-length-limit-r27; no further action.
    expected_artifact: Evidence satisfying Agent Ask explain-the-ping-length-limit
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-handoff-and-pre-pr-20261118-a
    why: "Issue #2782: an evening digest over 500 characters failed with only '[ELIFECYCLE] Command failed with exit code 2'."
    acceptance_criteria:
      - A test shows a 501-character message exits non-zero with exactly one stderr line of the form 'message is 501 characters; the limit is 500', and nothing is queued.
      - A test shows a 500-character message is accepted unchanged; the message is never silently truncated.
      - "Issue #2782 is closed citing the merged PR."
    depends_on: [require-pre-pr-before-every-pull-request]
    decisions: []
    references: ["src/commands/ping.ts", "src/ping/operatorPing.ts"]
  - id: wire-mechanical-repair-into-production
    title: "The worker tick runs the deterministic repair round of src/production/mechanicalRepair.ts on every candidate whose required checks fail, the independent review treats its push as a new production-owned head, and the live red-alert path raises repair alerts once per episode, so the library merged in #2777 actually repairs candidates."
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask rowan25-split-wire-repair-20261119b; no further action.
    expected_artifact: Evidence satisfying Agent Ask wire-mechanical-repair-into-production
    clarification: clarified
    confidence: high
    source: Agent Ask rowan25-split-wire-repair-20261119b
    why: "#2777 merged mechanicalRepair.ts with no caller outside the module, yet its Action was marked done; the operator chose option B on 2026-11-17 to wire it in this amendment."
    acceptance_criteria:
      - The live red-alert path raises repair_gated and repair_budget_repeat once per episode. An integration test through the tick shows one raise per episode, and the episode's seen-count does not grow on later ticks.
      - A repository test fails if src/production/mechanicalRepair.ts has no caller outside tests, so an unwired repair library cannot be marked done again.
    depends_on: [treat-fingerprint-fold-ins-as-governance-records, require-pre-pr-before-every-pull-request]
    split_into: [finish-wire-repair-verdict-case-and-absorb-proposal]
    decisions: []
    references: ["src/production/tick.ts", "src/production/independentReview.ts", "src/production/mechanicalRepair.ts", "tests/mechanical-repair.test.ts", "docs/decisions/0247-should-production-repair-a-candidate-that-fails-lint-budget-fingerprint-or.md"]
  - id: launch-past-a-merged-handoff
    title: Preparing a new Action's Session is no longer refused by an incomplete resumable handoff of a different Action whose branch is already merged into the base; that handoff is superseded instead, while an unmerged handoff still blocks.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-launch-past-a-merged-handoff-fed4ee348532; no further action.
    expected_artifact: Evidence satisfying Agent Ask launch-past-a-merged-handoff
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-handoff-and-pre-pr-20261118-a
    why: "src/sessions/index.ts:694 refuses Action B while Action A's handoff worktree exists, even after A's branch merged, which stops a serial night between Actions (Mira, 2026-11-18)."
    acceptance_criteria:
      - A test with an incomplete_resumable handoff for Action A whose branch is an ancestor of, or patch-equivalent to, the base, with its worktree still present, shows preparing Action B succeeds and the handoff is superseded through the existing supersede path with a receipt naming the merge evidence.
      - A control test with an unmerged branch and its worktree present still refuses with today's message.
      - Patch equivalence is decided deterministically from git (ancestry or patch-id), and a test covers a merge-commit and a squash-merged branch.
    depends_on: []
    decisions: []
    references: ["src/sessions/index.ts"]
  - id: supersede-an-older-pending-completion-ask
    title: When a later completion Ask for the same Action settles or its evidence completes, an older pending completion Ask for that Action is recorded as superseded, so it no longer holds the Action at operator_gate_pending ahead of auto-settle.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-supersede-an-older-pending-completion-ask-e1146162af36; no further action.
    expected_artifact: Evidence satisfying Agent Ask supersede-an-older-pending-completion-ask
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-handoff-and-pre-pr-20261118-a
    why: "An older pending complete Ask gates the Action as operator_gate_pending (src/docs/operatorGate.ts:115, src/sessions/index.ts:435-468) before auto-settle runs (src/production/tick.ts:2908); this extends #2786."
    acceptance_criteria:
      - A test with two pending complete proposals for one Action, the older failing criteria and the newer clean, shows auto-settle settles the newer, records the older as superseded with a receipt, and the Action no longer reads operator_gate_pending.
      - A control test with a single pending complete Ask that fails criteria still gates the Action exactly as today.
      - Asks that open or carry a Decision, and non-completion intents, are never superseded by this rule; a test shows both.
      - "#2786 is cited in the PR and updated with the merged change."
    depends_on: []
    decisions: []
    references: ["src/docs/operatorGate.ts", "src/sessions/index.ts", "src/production/tick.ts", "src/ask/autoSettleBeforeDispatch.ts"]
  - id: treat-fingerprint-fold-ins-as-governance-records
    title: A fold-in commit that changes only docs/agent-guidance/fingerprints.json after a completion Ask's candidate revision no longer makes auto-settle return AUTO_SETTLE_REVISION_CHANGED, while any change to a guidance document still does.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-treat-fingerprint-fold-ins-as-governance-records-3e38bb0d032b; no further action.
    expected_artifact: Evidence satisfying Agent Ask treat-fingerprint-fold-ins-as-governance-records
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-handoff-and-pre-pr-20261118-a
    why: "GOVERNANCE_RECORD_PATHS in src/ask/autoSettleBeforeDispatch.ts omits fingerprints.json, so every fingerprint-only fold-in, including each mechanical repair round, blocks auto-settle."
    acceptance_criteria:
      - GOVERNANCE_RECORD_PATHS includes docs/agent-guidance/fingerprints.json, and a test shows a commit that changes only that file after the candidate revision settles cleanly.
      - A test shows a commit that changes any guidance document, or fingerprints.json together with any other non-record path, still returns AUTO_SETTLE_REVISION_CHANGED.
      - The worker still reviews and merges only at the exact final head; the existing independent-review tests pass unchanged.
    depends_on: []
    decisions: []
    references: ["src/ask/autoSettleBeforeDispatch.ts", "docs/agent-guidance/fingerprints.json"]
  - id: add-a-guidance-refresh-command
    title: "A `pnpm guidance:refresh` command refreshes the fingerprint of named or all stale guidance documents with the same fingerprint function the guidance check uses, so a stale-fingerprint failure has a one-line fix and nobody hand-edits fingerprints.json."
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-add-a-guidance-refresh-command-a17d54c1a89b; no further action.
    expected_artifact: Evidence satisfying Agent Ask add-a-guidance-refresh-command
    clarification: clarified
    confidence: high
    source: Agent Ask amend-p1-ascii-ellipsis-20261118
    why: "A stale docs/agent-guidance/fingerprints.json entry was a hand fix on #2766, #2776 and others; notes-to-self says never hand-edit fingerprints."
    acceptance_criteria:
      - "`pnpm guidance:refresh [<doc>...]` rewrites only the fingerprints of the named stale documents (or all stale ones with no argument), using the fingerprint function that check:agent-guidance uses; a test shows its output then passes check:agent-guidance."
      - It reuses that function and the refresh logic of src/production/mechanicalRepair.ts (refreshCandidateGuidanceFingerprints) rather than a second implementation; a test or code reference shows the shared function.
      - It changes nothing when no fingerprint is stale and exits zero; a test covers it.
    depends_on: []
    decisions: []
    references: ["src/projects/agentGuidance.ts", "src/production/mechanicalRepair.ts", "docs/agent-guidance/fingerprints.json", "package.json"]
  - id: add-a-pre-pr-check-that-mirrors-ci
    title: "`pnpm pre-pr` runs, fail-fast and locally, the CI-equivalent checks that have turned production candidates red, and prints for each failure the exact command or edit that fixes it."
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-add-a-pre-pr-check-that-mirrors-ci-a83d02965eb2; no further action.
    expected_artifact: Evidence satisfying Agent Ask add-a-pre-pr-check-that-mirrors-ci
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-handoff-and-pre-pr-20261118-a
    why: "Eight of eight production candidates since 2026-11-15 went red on checks a local run would have caught, each costing a hand fix and a CI cycle."
    acceptance_criteria:
      - "scripts/pre-pr.ts and a package.json \"pre-pr\" script run, in order and stopping at the first failure: check:agent-guidance (fingerprints and the bootstrap and default-loading instruction caps), eslint on the files changed against origin/main, tsc --noEmit, tests/authority-classifier-coverage.test.ts, check:operator-scripts, check:plan-close-outs and check:frozen-records."
      - "Each failure prints one fix line: `pnpm guidance:refresh <doc>` for a stale fingerprint; the cap, the measured bytes and the file for an instruction-cap overflow; `pnpm exec eslint --fix <files>` for auto-fixable lint; file:line for type errors; and, for a new src file missing from src/decisions/batchMerge.ts, the file and a most-restrictive classification entry to add."
      - tests/pre-pr.test.ts builds a temporary repository fixture with an edited guidance document and an unclassified new src file. pre-pr fails naming both with their fix commands, and after applying those commands it passes.
      - "The recorded failures of #2752 (lint), #2766 (guidance fingerprint) and #2744 (classification) each reproduce as a pre-pr failure with the correct fix line, shown by fixtures."
    depends_on: [add-a-guidance-refresh-command]
    decisions: []
    references: ["package.json", "scripts/check-agent-guidance.ts", "scripts/check-operator-scripts.ts", "scripts/check-plan-close-outs.ts", "scripts/check-frozen-records.ts", "tests/authority-classifier-coverage.test.ts", "src/decisions/batchMerge.ts"]
  - id: inspect-stale-completion-candidate-revision
    title: Determine whether an auto-settled completion Ask keeps a stale candidate_revision when a hand fix moves the candidate head, and either fix it so the recorded revision is the merged head or record with evidence that it does not occur.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-inspect-stale-completion-candidate-revision-1a427caa3e07; no further action.
    expected_artifact: Evidence satisfying Agent Ask inspect-stale-completion-candidate-revision
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-handoff-and-pre-pr-20261118-a
    why: "Hypothesis from Mira's 2026-11-17 review: completion Asks are settled at the pre-fix head (e.g. 574a2327c before fix 82b87b043), which may misstate what was completed."
    acceptance_criteria:
      - "A fixture replays #2777's sequence (auto-settle at the preserved candidate, then a fix commit, then merge) and shows which revision the completion record names."
      - If the record names a pre-fix head, a failing-first test then passes with the completion record naming the merged head, or with a recorded refresh when the head moves; otherwise the finding and the fixture are recorded in docs/notes-to-self.md and no code changes.
      - Either outcome is cited on a new or existing Issue.
    depends_on: []
    decisions: []
    references: ["src/ask/settlement.ts", "src/production/tick.ts", "MISSION_LOG.md"]
  - id: correct-usage-refresh-and-assert-capacity-freshness
    title: docs/managed-production-readiness.md states truthfully that the worker refreshes Claude usage before admission, and the START press runbook asserts after activation that the worker's capacity reading is newer than the press.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-correct-usage-refresh-and-assert-capacity-freshness-c1a1c3ace0c8; no further action.
    expected_artifact: Evidence satisfying Agent Ask correct-usage-refresh-and-assert-capacity-freshness
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-handoff-and-pre-pr-20261118-a
    why: "docs/managed-production-readiness.md:515 says the worker never refreshes Claude usage before admission, but src/commands/worker.ts:1122 calls refreshClaudeUsageBeforeAdmission."
    acceptance_criteria:
      - docs/managed-production-readiness.md no longer says the worker never refreshes Claude usage before admission, and cites src/commands/worker.ts preAdmission (refreshClaudeUsageBeforeAdmission).
      - "The START press runbook in docs/agent-guidance/operator-actions.md gains one post-activation step: confirm the worker's Claude usage reading is newer than the press time, naming the command that shows it, and what to do when it is not."
      - "Guidance fingerprints and instruction caps pass check:agent-guidance after the edit."
    depends_on: []
    decisions: []
    references: ["docs/managed-production-readiness.md", "src/commands/worker.ts", "docs/agent-guidance/operator-actions.md"]
  - id: require-pre-pr-before-every-pull-request
    title: Every build Session's brief and the pull-request procedure require `pnpm pre-pr` to pass before a pull request is opened or pushed, with its output cited in the PR description.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Every build Session's brief and the pull-request procedure require `pnpm pre-pr` to pass before a pull request is opened or pushed, with its output cited in the PR description.
    expected_artifact: Evidence satisfying Agent Ask require-pre-pr-before-every-pull-request
    clarification: clarified
    confidence: high
    source: Agent Ask rowan24-drop-p5-ordering-edges-20261119
    why: "A local check only helps if the build Session runs it before the PR; today the brief and procedure do not ask for it."
    acceptance_criteria:
      - The build Session brief composed for a production candidate contains one line requiring `pnpm pre-pr` before opening or pushing a PR; a test asserts the line in a composed brief.
      - "docs/agent-guidance/pull-requests.md gains a criterion requiring a passing `pnpm pre-pr` with its output cited in the PR description, and its index entry and fingerprint are refreshed with `pnpm guidance:refresh`; check:agent-guidance, including the bootstrap cap, passes."
    depends_on: [add-a-pre-pr-check-that-mirrors-ci]
    decisions: []
    references: ["src/codex/packets.ts", "docs/agent-guidance/pull-requests.md", "docs/agent-guidance/index.json"]
  - id: show-the-resulting-queue-order-in-settle-preview
    title: Previewing a Plan amendment Ask prints the resulting activation order of the target Plan's remaining Actions and the stored queue order after settlement, and refuses at preview time an anchor that settlement cannot use.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Previewing a Plan amendment Ask prints the resulting activation order of the target Plan's remaining Actions and the stored queue order after settlement, and refuses at preview time an anchor that settlement cannot use.
    expected_artifact: Evidence satisfying Agent Ask show-the-resulting-queue-order-in-settle-preview
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-target-migration-20261119-aplus3b
    why: "Plan F's 2026-11-17 amendment took about seven versions because '--before' inside the active Plan and the Plan-file dependency order were discovered only at settle."
    acceptance_criteria:
      - agent-ask preview of a plan-intent Ask prints, for the target Plan, the dependency-ordered remaining Actions as dependencyOrderedActionIds would compute them after settlement, and the stored queue order for each placement it accepts; a test uses a fixture of Plan F's 2026-11-17 state and the e and e-alt amendments and shows both orders.
      - A '--before' or '--after' anchor that settlement would reject (for example an Action inside the active Plan's own segment) is refused by preview with the same reason settlement gives; a test covers it.
      - When the stored queue order and the Plan-file dependency order disagree, preview names the first differing position; a test covers it.
    depends_on: [allocate-decision-numbers-on-main-and-refuse-duplicates, finish-allocate-push-ping-and-supersede-older-action]
    decisions: []
    references: ["src/ask/settlement.ts", "src/dispatch/actionOrder.ts", "src/commands/agentAsk.ts"]
  - id: require-proof-for-every-met-criterion
    title: A completion Ask is auto-settled only when every 'met' criterion's evidence note names a proof that exists at the candidate revision (a test name and file, a receipt path or a commit), and a repository check fails when a new production module has no caller outside tests.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: A completion Ask is auto-settled only when every 'met' criterion's evidence note names a proof that exists at the candidate revision (a test name and file, a receipt path or a commit), and a repository check fails when a new production module has no caller outside tests.
    expected_artifact: Evidence satisfying Agent Ask require-proof-for-every-met-criterion
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-gap-actions-20261118-b
    why: "#2777 was auto-settled with six criteria 'met' and empty evidence notes while its library had no caller, so 'done' did not mean wired in."
    acceptance_criteria:
      - "A test replays #2777's completion Ask (criteria 'met', no evidence notes) and shows auto-settle refuses it with a reason naming each criterion that lacks a proof."
      - A test shows a completion whose every 'met' note names a test file and test name, a receipt path or a commit that exists at the candidate revision settles as today; a note naming a missing file is refused.
      - A repository check fails when a module added under src/production, src/sessions or src/ask has no importer outside tests, naming the module, with an explicit allowlist for intentional entry points; a fixture shows it would have failed on c7d7fba5f.
      - The build Session brief asks for one proof per criterion in the completion evidence notes; a test asserts the line in a composed brief.
    depends_on: [allocate-decision-numbers-on-main-and-refuse-duplicates, finish-allocate-push-ping-and-supersede-older-action]
    decisions: []
    references: ["src/ask/autoSettleBeforeDispatch.ts", "src/ask/agentAsk.ts", "src/ask/settlement.ts", "src/codex/packets.ts"]
  - id: check-tonights-card-at-noon
    title: Once a day at a configured local time (default noon Pacific), the existing liveness timer checks read-only whether tonight's per-run START card for the top of the active Plan's queue could be minted, and pings the operator once only when it could not, naming each blocker.
    status: deferred
    responsibility: agent
    execution: build
    effort: session
    next_action: Once a day at a configured local time (default noon Pacific), the existing liveness timer checks read-only whether tonight's per-run START card for the top of the active Plan's queue could be minted, and pings the operator once only when it could not, naming each blocker.
    expected_artifact: Evidence satisfying Agent Ask check-tonights-card-at-noon
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-gap-actions-20261118-b
    why: "Card blockers (a batch not yet merged, production not Off, main CI red, an unready or authority-stopped Action, unpushed local commits) were found at mint time in the evening instead of at noon."
    acceptance_criteria:
      - "A pure function reports, for the next N ready Actions of the active Plan, every blocker to minting a per-run card tonight: production not Off or with live admissions, main's required checks not green, an invalid or unpositioned queue, an Action not ready, local main ahead of or diverged from origin, and an open failed-batch stop. Fixture tests cover each blocker and a clean case."
      - The liveness timer runs it once per day at the configured local time, mints, presses and writes nothing, and sends at most one ping per day only when a blocker exists. Tests show no ping on a clean day and one ping naming every blocker otherwise.
      - docs/agent-guidance/operator-actions.md describes the noon check and its single ping.
    depends_on: [allocate-decision-numbers-on-main-and-refuse-duplicates, finish-allocate-push-ping-and-supersede-older-action]
    decisions: []
    references: ["src/commands/productionLiveness.ts", "src/operatorActions/libraryContract.ts", "src/operatorActions/startRunDerive.ts", "src/ping/operatorPing.ts"]
  - id: derive-by-change-not-reference
    title: The START card deriver no longer stops before an Action because its references name an authority path; it still stops before an Action citing an unanswered Decision, and authority is judged at merge time by the diff.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-derive-by-change-not-reference-bc39151077fd; no further action.
    expected_artifact: Evidence satisfying Agent Ask derive-by-change-not-reference
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-target-migration-20261119-aplus3b
    why: "All 34 open F/G/H Actions trip the reference-based stop (startRunDerive.ts operatorReasons), so the standing grant derives nothing."
    acceptance_criteria:
      - A test shows an Action whose references name operator_authority or production_policy paths is derived, and an Action citing an unanswered Decision still stops the card.
      - The merge-time diff gate (candidateChangeGate and workerMerge authority_adjacent) is unchanged; its existing tests pass.
      - The card-integrity suite from prove-card-integrity-against-recorded-defects still passes.
    depends_on: []
    decisions: []
    references: ["src/operatorActions/startRunDerive.ts", "src/production/candidateChangeGate.ts", "src/decisions/batchMerge.ts"]
  - id: define-the-gate-set
    title: One checked-in gate-set list names the gate modules, their first-order imports, spend/ and the hard classes; one loader serves it to every reader; a drift test fails when a gate module gains a first-order import outside the list, and the list, loader and test are themselves in the list.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-define-the-gate-set-56ec0a38fd0c; no further action.
    expected_artifact: Evidence satisfying Agent Ask define-the-gate-set
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-target-migration-20261119-aplus3b
    why: "Steps 1 and 4 must read one shared protected set; the transitive closure of workerMerge.ts alone is 209 files, so the set is the gate modules plus first-order imports."
    acceptance_criteria:
      - "A checked-in list names: workerMerge, independentReview, batchMerge, startRunDerive, autoSettleBeforeDispatch, candidateChangeGate, mechanicalRepair, scripts/start-run.sh; their first-order imports as of the merge commit; spend/; the hard classes (decisions, agent_permissions, CONSTITUTION.md, governance files); and the list file, its loader and the drift test."
      - A drift test fails, naming the module and import, when any listed gate module gains a first-order import outside the list; a fixture adds one and shows the failure.
      - One loader is the only reader of the list; a repository check fails if another module reads the list file directly.
      - Unmapped files under the listed paths classify as protected (fail closed); a test covers an unmapped new file.
      - The list is keyed by project (and repository), so each Project carries its own gate list; Arcadia's is the first entry, and a second project's absence is reported, not assumed.
    depends_on: [derive-by-change-not-reference]
    decisions: []
    references: ["src/decisions/batchMerge.ts", "src/production/workerMerge.ts", "src/production/independentReview.ts", "src/operatorActions/startRunDerive.ts", "src/ask/autoSettleBeforeDispatch.ts", "src/production/candidateChangeGate.ts"]
  - id: run-production-in-its-own-clone
    title: "Production works in a workspace-owned clone: the policy's repository path is that clone, candidates branch from its origin/main, the tick never writes to the primary checkout, and admission and merge refuse when the installed release differs from the clone's origin/main on gate-set paths."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Production works in a workspace-owned clone: the policy's repository path is that clone, candidates branch from its origin/main, the tick never writes to the primary checkout, and admission and merge refuse when the installed release differs from the clone's origin/main on gate-set paths."
    expected_artifact: Evidence satisfying Agent Ask run-production-in-its-own-clone
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-target-migration-20261119-aplus3b
    why: "On 2026-11-18 the shared primary checkout diverged (base_not_synced), needed a hand pointer commit under an operator exception (982e14733) and an operator-approved reset."
    acceptance_criteria:
      - A fixture replays the 2026-11-18 divergence against a clone-configured policy and shows the primary checkout unchanged and no base_not_synced; a human commit on the primary checkout no longer affects production.
      - "Currency compares only gate-set paths (via the shared loader) between the installed release and the clone's origin/main: test A merges a docs-only change and admission continues; test B merges a gate-path change and admission and merge refuse."
      - The PR lists every consumer repointed to the clone or to origin/main (dashboard, /runs library, arcadia go, liveness), and a check shows none still reads the primary checkout for production state.
      - Active refuses, with one page, unless keep-awake is on and free disk is above a named threshold; turning keep-awake on stays an operator host setting.
      - Each production receipt records the release sha. The live host step (pointing the installed policy at the clone) is a separate operator-approved step after this merges.
      - The clone path is per project and repository (workspace/clones/<project>/<repo>), and every production receipt records project, repository and attempt id explicitly, so the global concurrency limit of 1 is a setting, not an assumption in paths or receipts.
    depends_on: [define-the-gate-set]
    decisions: []
    references: ["scripts/services.sh", "src/production/policy.ts", "src/production/tick.ts", "src/production/runtimeCurrency.ts", "src/git/pointerReconcile.ts"]
  - id: worker-applies-standing-merge-conditions
    title: The worker merges an in-run PR only when conditions C1-C5 hold on its exact head, writes the receipt before --match-head-commit, and parks it otherwise; C1 is bound to the Plan revision or Action-id list the operator approved; protection comes from the shared gate set.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: The worker merges an in-run PR only when conditions C1-C5 hold on its exact head, writes the receipt before --match-head-commit, and parks it otherwise; C1 is bound to the Plan revision or Action-id list the operator approved; protection comes from the shared gate set.
    expected_artifact: Evidence satisfying Agent Ask worker-applies-standing-merge-conditions
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-target-migration-20261119-aplus3b
    why: "Decision 0260 made C1-C5 the in-run merge rule; today Rowan applies them by hand, and the operator wants conditions checked by Arcadia, not re-decided."
    acceptance_criteria:
      - Fixture tests cover a pass and a fail for each of C1-C5, and an unreadable input, which parks.
      - C1 passes only for an Action whose requirement content (desired_result, acceptance and references) and version match what the operator approved, recorded at approval as a content hash per Action. Added scope (a new Action), changed acceptance or a newly named authority path voids that approval and parks the Action until the operator re-approves; wording-only and order-only edits do not. Tests cover each case.
      - A PR whose diff touches the shared gate set or a hard class parks for the operator; a test covers each.
      - The receipt comment (card or run id, head sha, review marker URL, 'Loosens a gate' line, check conclusions, merge state, classes, release sha) is posted before the merge call.
      - The worker applies these only while an operator Decision authorizing in-run merges for that run is answered on main; otherwise behavior is unchanged (authority-adjacent PRs wait).
    depends_on: [define-the-gate-set]
    decisions: []
    references: ["src/production/workerMerge.ts", "src/production/independentReview.ts", "src/decisions/batchMerge.ts", "docs/decisions/0260-may-rowan-merge-during-tonight-s-run-window-the-pull-requests-of-the-actions.md"]
  - id: park-and-continue
    title: A failed condition parks only that Action with a receipt and admission continues with the next Action that does not depend on it, under a night breaker that turns production Off and pages.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: A failed condition parks only that Action with a receipt and admission continues with the next Action that does not depend on it, under a night breaker that turns production Off and pages.
    expected_artifact: Evidence satisfying Agent Ask park-and-continue
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-target-migration-20261119-aplus3b
    why: "Today one parked PR ends the night (card 2 on 2026-11-18 stopped at 11:27 PM awaiting a merge)."
    acceptance_criteria:
      - A park records (action, condition, cause) and leaves the Action open; admission skips its dependents and admits the next independent Action; a fixture shows both.
      - The breaker pauses the affected lane or project, and pages, at 3 parks, at 3 merges on a lane's first 24 hours (6 after), or at the token ceiling (40M input tokens summed over the lane's Sessions, or the Claude 5-hour window at 70%, read through capacityPreAdmission). All counts are over a rolling 24 hours per project and lane, and tests cover each. Production-wide Off is kept for main going red and for the same cause twice (Decisions 0181 and 0187).
      - Sign-in holds, capacity holds and outages are holds, not parks; a second park with the same cause, or main going red, stops production.
      - A park older than one night is re-reviewed at its current head and never merged as recorded.
      - "A park accepts an operator-cancel cause: cancel stops admission of that Action now, vetoes any pending merge, preserves the work as a draft and records the reason; a test covers it."
    depends_on: [worker-applies-standing-merge-conditions]
    decisions: []
    references: ["src/production/tick.ts", "src/dispatch/actionOrder.ts", "src/production/capacityPreAdmission.ts"]
  - id: verify-overnight-merges-at-8am
    title: An 8 AM report re-verifies every overnight merge independently from GitHub, classifies each diff with the classifier pinned at the run's first-admission release sha, and leads with heartbeat age.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: An 8 AM report re-verifies every overnight merge independently from GitHub, classifies each diff with the classifier pinned at the run's first-admission release sha, and leads with heartbeat age.
    expected_artifact: Evidence satisfying Agent Ask verify-overnight-merges-at-8am
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-target-migration-20261119-aplus3b
    why: "The operator decides once and Arcadia verifies that conditions matched reality; the re-check must not trust the night's own receipts."
    acceptance_criteria:
      - The report's first line is heartbeat age; it states that host death is detected only at 8 AM.
      - For each merge it re-reads head sha, check runs, review marker and file list from GitHub and classifies the diff with src/decisions/batchMerge.ts at the release sha recorded at the run's first admission; a fixture of a recorded night reproduces Rowan's hand report.
      - It lists parks with lettered options, merges, idle hours with causes and token burn.
      - A fixture test shows the liveness timer sends exactly one page after N hours Active with no merge and no park, and none before N hours; the page text appears in the PR description.
    depends_on: [worker-applies-standing-merge-conditions]
    decisions: []
    references: ["src/digests/composer.ts", "src/commands/productionLiveness.ts", "src/coordinator/sources.ts", "src/decisions/batchMerge.ts"]
  - id: publish-governance-commits-from-the-clone
    title: The Decision 0261 publisher fast-forward publishes governance-record-only Arcadia Controller commits from production's clone, under 0261's five conditions, refusing otherwise with one ping.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: The Decision 0261 publisher fast-forward publishes governance-record-only Arcadia Controller commits from production's clone, under 0261's five conditions, refusing otherwise with one ping.
    expected_artifact: Evidence satisfying Agent Ask publish-governance-commits-from-the-clone
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-target-migration-20261119-aplus3b
    why: "Auto-settle commits stay local (Issue #2802); Decision 0261 authorized checked publication, now sourced from the clone."
    acceptance_criteria:
      - Fixture tests show a publish only when all five 0261 conditions hold (controller identity, governance-record paths only, origin ancestor re-checked before a plain push, no pinned unpressed card, receipt), with a fail case for each.
      - A fixture test shows a refused publish leaves origin unchanged and records exactly one ping per refusal episode.
      - "A fixture of Issue #2802's state ends with the clone and origin equal; #2802 cites the merged PR."
    depends_on: [run-production-in-its-own-clone]
    decisions: []
    references: ["src/git/pointerReconcile.ts", "src/production/startRunSignIn.ts", "src/production/tick.ts", "docs/decisions/0261-may-arcadia-fast-forward-publish-to-origin-main-the-arcadia-controller-s.md"]
  - id: finish-allocate-push-ping-and-supersede-older-action
    title: "A check on every push to main sends exactly one ping naming both files when a duplicate Decision id reaches main by any route, and the older settlement-queue Action is closed as superseded with Issues #2369 and #1275 citing the merged PR."
    status: open
    responsibility: agent
    effort: session
    next_action: "A check on every push to main sends exactly one ping naming both files when a duplicate Decision id reaches main by any route, and the older settlement-queue Action is closed as superseded with Issues #2369 and #1275 citing the merged PR."
    expected_artifact: Evidence satisfying Agent Ask finish-allocate-push-ping-and-supersede-older-action
    clarification: clarified
    confidence: high
    source: Agent Ask rowan25-split-allocate-criteria-4-and-6-20261119
    acceptance_criteria:
      - A check on every push to main fails loudly, with one ping naming both files, if a duplicate id reaches main by any other route.
      - "Action allocate-decision-numbers-from-origin-and-refuse-duplicates in Plan seven-verified-settlement-queue-and-preservation-integrity-bugs-are-fixed-and is closed as superseded by this Action through a governed amendment, and Issues #2369 and #1275 cite the merged PR."
    depends_on: []
    decisions: []
    references: ["scripts/check-decision-ids.ts", ".github/workflows/ci.yml", "docs/plans/seven-verified-settlement-queue-and-preservation-integrity-bugs-are-fixed-and.md", "https://github.com/pmark/arcadia/pull/2880"]
  - id: finish-wire-repair-verdict-case-and-absorb-proposal
    title: "Finish the wired mechanical repair: an integration test through the worker tick shows #2766's fingerprint refresh run, commit and push a production-owned head for a candidate that changed the named guidance document; a test records a verdict on the old head first and shows the production-owned repair push is reviewed as a new head; proposal agentask_abd3a5e65938083517 is recorded as absorbed with its receipt id cited; and each criterion's evidence names the integration test, the repository test or the receipt that proves it."
    status: open
    responsibility: agent
    effort: session
    next_action: "Finish the wired mechanical repair: an integration test through the worker tick shows #2766's fingerprint refresh run, commit and push a production-owned head for a candidate that changed the named guidance document; a test records a verdict on the old head first and shows the production-owned repair push is reviewed as a new head; proposal agentask_abd3a5e65938083517 is recorded as absorbed with its receipt id cited; and each criterion's evidence names the integration test, the repository test or the receipt that proves it."
    expected_artifact: Evidence satisfying Agent Ask finish-wire-repair-verdict-case-and-absorb-proposal
    clarification: clarified
    confidence: high
    source: Agent Ask rowan25-split-wire-repair-20261119b
    acceptance_criteria:
      - "An integration test drives the worker tick (not the library alone) with the recorded #2752 and #2766 check failures and shows one deterministic round runs, commits and pushes a production-owned head to the candidate branch. With the recorded #2758 and #2765 failures, the same test shows a hand-off to repair-red-candidates-with-a-bounded-session without running any generator."
      - src/production/independentReview.ts treats a production-owned repair push after a recorded verdict as a new head to review, not review_head_moved; an integration test through the review path shows it, and any other moved head is still review_head_moved.
      - Proposal agentask_abd3a5e65938083517 is recorded as absorbed, with its receipt id cited in this Action's completion evidence.
      - Each criterion's completion evidence names the integration test, the repository test or the receipt that proves it, not a unit test of the library.
    depends_on: []
    decisions: []
    references: ["src/production/independentReview.ts", "src/production/mechanicalRepairWiring.ts", "tests/mechanical-repair-wiring.test.ts", "https://github.com/pmark/arcadia/pull/2887"]
questions: []
decisions: []
current_action: finish-allocate-push-ping-and-supersede-older-action
recommended_model: standard
recommended_reasoning_effort: medium
---

# Draft an inactive Plan of five bounded Actions that keep unattended production running between batches without a person: survive the operator's merges to main, repair mechanically red candidates, start the next approved Plan, and stop Decision-number collisions

Created as an inactive draft from accepted Agent Ask ellis-next-batch-f-keep-the-loop-alive-20261117b; creation changed no pointer. Current activation is recorded in frontmatter.
