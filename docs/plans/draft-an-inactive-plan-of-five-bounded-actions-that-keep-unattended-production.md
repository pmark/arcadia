---
arcadia: v1
type: plan
slug: draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production
project: arcadia
status: active
milestone: "Draft an inactive Plan of five bounded Actions that keep unattended production running between batches without a person: survive the operator's merges to main, repair mechanically red candidates, start the next approved Plan, and stop Decision-number collisions"
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-18
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
    depends_on: [repair-mechanical-check-failures-deterministically, wire-mechanical-repair-into-production]
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
    source: Agent Ask ellis-amend-plan-f-six-bugs-and-2777-20261117e-alt2
    why: "Decision 0241 E: the operator stacks Plans on the work queue and expects Arcadia to work through each. Today no record holds that stack and the timer stops at scope complete."
    acceptance_criteria:
      - A checked-in Plan-queue record per Project lists approved Plan slugs in order. Only a settled Agent Ask carrying the operator's approval can add, remove or reorder entries; a test shows any other write path is refused.
      - A read-only command prints the Plan queue with each Plan's status and readiness. A Plan is ready when every remaining Action has observable acceptance and none cites an open Decision or names an authority path the deriver stops at. Tests cover a ready Plan and two not-ready ones.
      - The deriver (src/operatorActions/startRunDerive.ts) accepts a Plan under an open standing grant only if it is the grant's pinned Plan or the Project's active Plan and an entry of the approved Plan-queue record at the same origin main revision. Any other Plan refuses with a named code, and the grant's end conditions are unchanged. Tests cover the pinned Plan, a queued activated Plan, and an active Plan missing from the record.
      - At scope complete with an open standing grant, the timer activates the next ready queued Plan through the governed pointer transition and derives its first card on a later tick. A not-ready next Plan, or an empty queue, turns production Off with exactly one ping naming the reason. Tests cover all three.
      - The derived card for a newly activated Plan passes the existing replay and press checks; the card-integrity suite from prove-card-integrity-against-recorded-defects still passes, extended with a fixture for a queued-Plan card.
      - Plan let-the-operator-change-what-production-queues-from-the-production-project records, through a governed amendment, that its single-Project ordering is delivered here and that its multi-Project preference Actions remain, with a revival trigger.
    depends_on: [retry-successor-press-when-main-moves, wire-mechanical-repair-into-production]
    decisions: []
    references: ["src/production/successorPress.ts", "src/dispatch/queue.ts", "src/dispatch/pointer.ts", "src/plans/nextPlanSelector.ts", "src/operatorActions/planQueue.ts", "src/ask/agentAsk.ts", "docs/decisions/0241-may-one-standing-start-grant-replace-the-daily-approval-of-decision-0173-so.md", "docs/plans/let-the-operator-change-what-production-queues-from-the-production-project.md"]
  - id: allocate-decision-numbers-on-main-and-refuse-duplicates
    title: Decision numbers are allocated against origin main at settle or mint time, and a required check fails any pull request that adds a Decision id its base already has, so two Decisions never share a number again.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Decision numbers are allocated against origin main at settle or mint time, and a required check fails any pull request that adds a Decision id its base already has, so two Decisions never share a number again.
    expected_artifact: Evidence satisfying Agent Ask allocate-decision-numbers-on-main-and-refuse-duplicates
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-six-bugs-and-2777-20261117e-alt2
    why: "Operator, 2026-11-17: 'This needs to never happen again.' Collisions recurred on 0240 and 0250, and every START press now mints a Decision on main."
    acceptance_criteria:
      - A test reproduces the 0250 race (an Ask settle candidate chooses N while a START sign-in mints N on main) and shows the second writer receives N+1 or refuses. No two Decision files on main share an id.
      - A required CI check fails a pull request that adds a docs/decisions file whose id already exists on its base, naming both files. The four historical pairs are grandfathered by an explicit list, and a test shows a fifth pair fails.
      - Every Arcadia merge path (the worker merge and the operator batch-merge card) re-runs the duplicate check against current origin main immediately before merging and refuses on a duplicate. A test with two pull requests that each add id N against the same base shows the second is refused after the first merges.
      - A check on every push to main fails loudly, with one ping naming both files, if a duplicate id reaches main by any other route.
      - START sign-in usage-check Decisions take their id at the moment they are written to main, from origin main, and a test shows a concurrent open PR's Decision does not block or collide with them.
      - "Action allocate-decision-numbers-from-origin-and-refuse-duplicates in Plan seven-verified-settlement-queue-and-preservation-integrity-bugs-are-fixed-and is closed as superseded by this Action through a governed amendment, and Issues #2369 and #1275 cite the merged PR."
    depends_on: [wire-mechanical-repair-into-production]
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
    source: Agent Ask ellis-amend-plan-f-six-bugs-and-2777-20261117e-alt2
    why: "Issue #2780: after #2745 merged, #2746's base merge kept a current_action that #2746 had marked done, failing the managed-documents contract and stalling the batch about 5 hours; the host refused the two-line hand fix."
    acceptance_criteria:
      - A test merges two sibling batch candidates in either order and shows main ends with a single valid current Action, with no manual edit.
      - The reconcile is the same governed implementation the stale-current-action repair class of repair-mechanical-check-failures-deterministically uses; a test or code reference shows there is one implementation, not two.
      - "A recorded fixture of the #2746 state (c23c38232 merged with main) passes tests/managed-documents-contract.test.ts after the reconcile."
      - No agent or operator hand-edits a pointer; the guidance names the governed command or settlement step that performs the reconcile.
    depends_on: [repair-mechanical-check-failures-deterministically]
    decisions: []
    references: ["src/ask/settlement.ts", "src/dispatch/pointer.ts", "tests/managed-documents-contract.test.ts"]
  - id: keep-pointer-commits-mergeable-across-a-date-change
    title: "Unpushed production pointer commits on local main reconcile with a remote commit that changed only PROJECT.md's updated: date, without a hand merge and without blocking START, and arcadia go's no-resolve boundary (#2023) is unchanged."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Unpushed production pointer commits on local main reconcile with a remote commit that changed only PROJECT.md's updated: date, without a hand merge and without blocking START, and arcadia go's no-resolve boundary (#2023) is unchanged."
    expected_artifact: Evidence satisfying Agent Ask keep-pointer-commits-mergeable-across-a-date-change
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-six-bugs-and-2777-20261117e-alt2
    why: "Issue #2029: a date rollover makes updated: (next to current_action in PROJECT.md) conflict even when both sides agree on the pointer, leaving local main ahead and behind and blocking make-next and START."
    acceptance_criteria:
      - "A test reproduces the recorded shape (local main ahead and behind, with the only conflict being updated: in PROJECT.md across a date change while both sides name the same current_action) and shows the reconcile completes without a hand merge."
      - "The fix is the smaller one Issue #2029 names: settlement or pointer commits stop producing a conflicting updated: next to current_action, or the existing reviewed resolver runs as a validated host step. arcadia go still never resolves a conflict itself, shown by its existing tests passing unchanged."
      - "If neither smaller fix satisfies the first criterion, the Action stops and submits a proposal for an operator Decision about the #2023 boundary instead of changing it."
      - "Issue #2029 is closed citing the merged PR."
    depends_on: []
    decisions: []
    references: ["src/git/pointerReconcile.ts", "src/ask/settlement.ts", "src/production/tick.ts"]
  - id: accept-registration-after-a-recorded-stand-down
    title: arcadia coordinator register accepts the successor immediately after a verified stand-down, or a TAKE CUSTODY ACK naming the successor, even if the predecessor's transcript is written afterwards.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: arcadia coordinator register accepts the successor immediately after a verified stand-down, or a TAKE CUSTODY ACK naming the successor, even if the predecessor's transcript is written afterwards.
    expected_artifact: Evidence satisfying Agent Ask accept-registration-after-a-recorded-stand-down
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-six-bugs-and-2777-20261117e-alt2
    why: "Issue #2781: Rowan 20's registration kept refusing because cross-session messages kept writing Rowan 19's transcript inside the freshness window, and the operator had to archive Rowan 19 by hand."
    acceptance_criteria:
      - A test shows register succeeds immediately after a recorded stand-down even when the predecessor's transcript is written within the freshness window afterwards.
      - A test shows a TAKE CUSTODY ACK naming the successor has the same effect, and an ACK naming a different session does not.
      - Without a recorded stand-down or a matching ACK, the existing custodian_session_live refusal is unchanged; the existing coordinator tests pass.
      - "Issue #2781 is closed citing the merged PR."
    depends_on: []
    decisions: []
    references: ["src/commands/coordinator.ts", "src/coordinator/generations.ts", "src/coordinator/state.ts"]
  - id: explain-the-ping-length-limit
    title: arcadia ping send with a message over the 500-character limit fails with a one-line error naming the message length and the limit, instead of a bare exit 2.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: arcadia ping send with a message over the 500-character limit fails with a one-line error naming the message length and the limit, instead of a bare exit 2.
    expected_artifact: Evidence satisfying Agent Ask explain-the-ping-length-limit
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-six-bugs-and-2777-20261117e-alt2
    why: "Issue #2782: an evening digest over 500 characters failed with only '[ELIFECYCLE] Command failed with exit code 2'."
    acceptance_criteria:
      - A test shows a 501-character message exits non-zero with exactly one stderr line of the form 'message is 501 characters; the limit is 500', and nothing is queued.
      - A test shows a 500-character message is accepted unchanged; the message is never silently truncated.
      - "Issue #2782 is closed citing the merged PR."
    depends_on: []
    decisions: []
    references: ["src/commands/ping.ts", "src/ping/operatorPing.ts"]
  - id: wire-mechanical-repair-into-production
    title: "The worker tick runs the deterministic repair round of src/production/mechanicalRepair.ts on every candidate whose required checks fail, the independent review treats its push as a new production-owned head, and the live red-alert path raises repair alerts once per episode, so the library merged in #2777 actually repairs candidates."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "The worker tick runs the deterministic repair round of src/production/mechanicalRepair.ts on every candidate whose required checks fail, the independent review treats its push as a new production-owned head, and the live red-alert path raises repair alerts once per episode, so the library merged in #2777 actually repairs candidates."
    expected_artifact: Evidence satisfying Agent Ask wire-mechanical-repair-into-production
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-six-bugs-and-2777-20261117e-alt2
    why: "#2777 merged mechanicalRepair.ts with no caller outside the module, yet its Action was marked done; the operator chose option B on 2026-11-17 to wire it in this amendment."
    acceptance_criteria:
      - "An integration test drives the worker tick (not the library alone) with the recorded #2752 and #2766 check failures and shows one deterministic round runs, commits and pushes a production-owned head to the candidate branch. With the recorded #2758 and #2765 failures, the same test shows a hand-off to repair-red-candidates-with-a-bounded-session without running any generator."
      - src/production/independentReview.ts treats a production-owned repair push after a recorded verdict as a new head to review, not review_head_moved; an integration test through the review path shows it, and any other moved head is still review_head_moved.
      - The live red-alert path raises repair_gated and repair_budget_repeat once per episode. An integration test through the tick shows one raise per episode, and the episode's seen-count does not grow on later ticks.
      - A repository test fails if src/production/mechanicalRepair.ts has no caller outside tests, so an unwired repair library cannot be marked done again.
      - Proposal agentask_abd3a5e65938083517 is recorded as absorbed, with its receipt id cited in this Action's completion evidence.
      - Each criterion's completion evidence names the integration test, the repository test or the receipt that proves it, not a unit test of the library.
    depends_on: []
    decisions: []
    references: ["src/production/tick.ts", "src/production/independentReview.ts", "src/production/mechanicalRepair.ts", "tests/mechanical-repair.test.ts", "docs/decisions/0247-should-production-repair-a-candidate-that-fails-lint-budget-fingerprint-or.md"]
questions: []
decisions: []
current_action: reconcile-current-action-after-a-base-merge
recommended_model: standard
recommended_reasoning_effort: medium
---

# Draft an inactive Plan of five bounded Actions that keep unattended production running between batches without a person: survive the operator's merges to main, repair mechanically red candidates, start the next approved Plan, and stop Decision-number collisions

Created as an inactive draft from accepted Agent Ask ellis-next-batch-f-keep-the-loop-alive-20261117b; creation changed no pointer. Current activation is recorded in frontmatter.
