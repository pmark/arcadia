---
arcadia: v1
type: plan
slug: draft-an-inactive-plan-of-five-bounded-actions-that-replace-the-daily-start
project: arcadia
status: active
milestone: Draft an inactive Plan of five bounded Actions that replace the daily START approval with one standing grant the operator presses once, so production on the chosen Plan moves on its own and asks the operator only for decisive action
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-16
actions:
  - id: decide-standing-start-grant
    title: Submit one operator Decision that replaces the daily approval of Decision 0173 with a standing START grant, with the four lettered options recorded here, and stay blocked until the operator answers.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-decide-standing-start-grant-20261115; no further action.
    expected_artifact: Evidence satisfying Agent Ask decide-standing-start-grant
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-standing-autonomy-20261115d
    why: "The daily window is a Decision 0173 rule, so only a new operator Decision can remove it; the code in the later Actions refuses until that answer is on main."
    acceptance_criteria:
      - "A decision-intent Agent Ask is submitted whose question is: 'May one standing START grant replace the daily approval of Decision 0173, so that unattended production on the Plan you chose continues without a daily press or your words in any chat?'"
      - "The Ask records option 'A. Standing grant for each Plan you choose' (recommended) with this consequence: 'You press one standing-grant card on /actions. It has no 24-hour end. It covers the Plan you activated and each later Plan you choose in your own verified words (Decisions 0229 and 0232). Arcadia then mints and presses every successor START card itself at concurrency one, up to 12 Actions per card, with no words in any chat. After a clean batch the per-card check is the deterministic replay and preflight; an independent pre-mortem is required only after a failed batch. It ends on your STOP card, your own Off, a revoke card or a refused host permission. You are still asked for: choosing or activating a Plan, every Decision, a merge that carries a Decision or changes authority, spend, credentials, paid fallback, deploy or publish, and a second failed batch on the same cause. Risk: a wrongly prepared card runs before you see it, bounded by concurrency one, exact-head review before every worker merge and the failed-batch stop of Decisions 0181 and 0187. No Constitution change. The AGENTS.md line Production stays Off pending separate START approval is reworded to name this grant as that approval.'"
      - "The Ask records option 'B. Standing grant across Plans' with this consequence: 'Everything in A, and when a Plan completes Rowan activates the next accepted draft Plan in recorded order. No touch between Plans. You no longer choose what runs next; you are told afterwards.'"
      - "The Ask records option 'C. Weekly grant' with this consequence: 'Decision 0173 stays as it is except that one press lasts 7 days instead of 24 hours, and Rowan presses under the receipt without your words. One press a week. Smallest change. Every card still waits for a live Rowan and an independent pre-mortem, so a gap between batches can still wait on a session.'"
      - "The Ask records option 'D. Keep the daily grant, fix the defects only' with this consequence: 'One press a day stays. Rowan stops asking for words in its chat and a malformed Off id no longer ends your day. The daily press and the overnight wait remain.'"
      - The Decision record on main shows no answer written by an agent, and this Action reports blocked, not complete, until the operator's answer is recorded.
    depends_on: []
    decisions: []
    references: ["CONSTITUTION.md", "docs/agents-context.md", "docs/decisions/0173-decide-what-authority-rowan-holds-for-a-day-at-a-time-over-unattended-work-on.md", "docs/decisions/0200-decide-how-a-day-approval-under-decision-0173-reaches-a-rowan-that-takes-over.md", "docs/decisions/0232-new-decision-may-the-coordinator-rowan-itself-execute-a-published-arcadia-plan.md"]
  - id: guard-rowan-off-request-id
    title: "Make Rowan's own Off impossible to mislabel: the CLI composes the rowan-off id, and a malformed request id is refused before production policy changes."
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-guard-rowan-off-request-id-b0c87a1dcb33; no further action.
    expected_artifact: Evidence satisfying Agent Ask guard-rowan-off-request-id
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-standing-autonomy-20261115d
    why: "On 2026-11-15 an Off with request id `.-plan3-pins-13-15-complete-20261115` was accepted and then read as an operator Off, ending the day grant and costing a second press. It needs no Decision and can ship first."
    acceptance_criteria:
      - Confirm in code before editing that `arcadia production deactivate` accepts request id `.-x` and that line 441 of startRunDayGrant.ts refuses the day for it; if either premise is false, stop and report.
      - A failing-first test shows `arcadia production deactivate --request-id .-plan3-pins-13-15-complete-20261115` exits non-zero with a named refusal code and leaves the policy revision unchanged.
      - A test shows `arcadia production deactivate --rowan-off plan3-pins-13-15-complete-20261115` records the request id `rowan-off-plan3-pins-13-15-complete-20261115`, and that the day-grant check accepts that Off without DAY_ENDED_BY_OPERATOR.
      - A test shows an operator STOP card press and a `dashboard-toggle-*` Off still end the day with DAY_ENDED_BY_OPERATOR.
      - docs/agent-guidance/operator-actions.md names `--rowan-off <slug>` as the only route for Rowan's Off, and docs/notes-to-self.md records that `rg -r` is --replace and printed the pattern as `^.-`.
      - Focused vitest for the touched suites, lint and tsc pass.
    depends_on: []
    decisions: []
    references: ["src/operatorActions/startRunDayGrant.ts", "src/production/policy.ts", "scripts/start-run.sh", "docs/agent-guidance/operator-actions.md", "docs/notes-to-self.md"]
  - id: verify-standing-grant-receipt
    title: Add a standing-grant card and its read-only check beside the day grant, with no 24-hour window, refused unless the standing-grant Decision is answered A or B on the pinned main.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-verify-standing-grant-receipt-327ca5dcc54d; no further action.
    expected_artifact: Evidence satisfying Agent Ask verify-standing-grant-receipt
    clarification: clarified
    confidence: high
    source: Agent Ask mira-card-integrity-20261115-e
    why: "The 24-hour window in startRunDayGrant.ts is what turns one approval into a daily press; the grant must be a durable receipt any session or timer can verify without chat words."
    acceptance_criteria:
      - A test shows a START card pinned from a standing-grant receipt pressed 30 days earlier passes the grant check, while the same card pinned from a day-grant receipt older than 24 hours is still refused.
      - A test shows the standing-grant check refuses when the Decision found by its slug is unanswered or answered C or D on the pinned main, and passes when it is answered A, B or E, with a refusal code that names the Decision.
      - A test shows the standing-grant press is refused unless it comes from the /actions page at a non-loopback address with no delegated marker, the same proof the day grant requires.
      - A test shows an operator STOP card press, an operator-issued Off and a press of the revoke card each end the grant, and that an Off whose request id matches rowan-off does not.
      - A test shows the check refuses a card whose Plan differs from the Plan recorded as the operator's choice, and a card with concurrency other than 1.
      - "`arcadia start-run grant-status --json` exists, mutates nothing, and reports the fields `open`, `plan`, `approvalRun`, `endedBy`, shown by a test."
      - The failed-batch rules of Decisions 0181 and 0187 and the two re-press limit apply unchanged under a standing grant, shown by the existing day-grant tests run against a standing receipt.
    depends_on: []
    decisions: []
    references: ["src/operatorActions/startRunDayGrant.ts", "src/operatorActions/startRunPins.ts", "scripts/start-run.sh", "scripts/day-grant.sh", "docs/agent-guidance/operator-actions.md"]
  - id: press-successor-cards-from-the-host-timer
    title: While a standing grant is open, the host timer mints, checks and presses the next START card itself after each clean batch, so no card waits unpressed and no agent turn is needed between batches.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: While a standing grant is open, the host timer mints, checks and presses the next START card itself after each clean batch, so no card waits unpressed and no agent turn is needed between batches.
    expected_artifact: Evidence satisfying Agent Ask press-successor-cards-from-the-host-timer
    clarification: clarified
    confidence: high
    source: Agent Ask mira-card-integrity-20261115-e
    why: "Today each successor card needs a live Rowan, an agent pre-mortem and a press, and a card left waiting expires; four of today's touches came from that gap."
    acceptance_criteria:
      - A fixture test shows two consecutive batches on one Plan run to scope complete with exactly 1 operator press recorded, the standing grant, and both START presses recorded as delegated.
      - A test shows the timer step mints a card for the next unfinished Actions in queue order, at most 12, and presses it in the same run, so the library never holds a delegated card older than 10 minutes unpressed.
      - A test shows the step presses only when production is Off, the previous batch reads clean, main's required checks are green and no card hold exists, and otherwise records one named skip reason and presses nothing.
      - A test shows that after a clean batch the card's manifest carries the replay receipt as its pre-press check and the press passes, while after a failed batch the press is refused until an independent pre-mortem pointer and a merged fix for the named cause are recorded.
      - A test shows a refused press sends exactly one operator ping naming the refusal code, ends the step for that grant, and a replay of the step adds no second press and no second ping.
      - A test shows the step issues the Off at scope complete through the rowan-off route and that this Off does not end the grant.
      - The step runs from the existing timer, never inside an agent session, and the PR description lists every authority-path edit.
    depends_on: [verify-standing-grant-receipt, refuse-press-unless-card-rederives, bind-replay-and-authority-scope-to-the-derived-card]
    decisions: []
    references: ["src/production/tick.ts", "src/production/dutyAlarms.ts", "src/operatorActions/startRunPins.ts", "scripts/start-run.sh", "scripts/production-replay.ts", "docs/agent-guidance/operator-actions.md"]
  - id: read-the-grant-in-rowan-and-signal-guidance
    title: Rowan's and Signal's skills, start prompts and ping rules read press authority from the grant receipt, and Signal pings the operator only for the decisive items the Decision lists.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Rowan's and Signal's skills, start prompts and ping rules read press authority from the grant receipt, and Signal pings the operator only for the decisive items the Decision lists.
    expected_artifact: Evidence satisfying Agent Ask read-the-grant-in-rowan-and-signal-guidance
    clarification: clarified
    confidence: high
    source: Agent Ask mira-card-integrity-20261115-e
    why: "Rowan 17 refused a permitted press because an uncommitted start prompt said never press START, and Signal's ping rule turned every card and every chat sentence into an interruption."
    acceptance_criteria:
      - The Signal and release-manager skills state that press authority is read from `arcadia start-run grant-status` and from no chat message, and the copies under .agents/skills and .claude/skills contain identical text, shown by a byte comparison.
      - A checked-in start-prompt template for Rowan and for Signal exists, contains no blanket ban on pressing START, and tells the session to read grant-status at start; a repository check fails when a skill or template contains the phrase 'never press START'.
      - "The Signal skill lists the real-time ping causes as exactly these: a Decision to answer, a Plan to choose, a merge that carries a Decision or changes authority, a spend or credential step, a second failed batch on one cause, a refused press, and an ended grant; every other event is recorded for the digest."
      - A test shows that with a standing grant open the events card ready, batch complete and successor pressed send 0 real-time pings, and that a refused press sends one.
      - docs/agents-context.md names the standing grant as the separate START approval and AGENTS.md is regenerated from it, with the instruction-budget check passing; this edit is made only after the operator's answer is A, B or E (E was recorded for Decision 0241 on 2026-11-15).
      - The pull request is labelled as changing what agents are authorized to do, and its description lists each changed authority sentence beside the Decision option that permits it.
    depends_on: [decide-standing-start-grant, verify-standing-grant-receipt]
    decisions: []
    references: [".agents/skills/arcadia-signal/SKILL.md", ".claude/skills/arcadia-signal/SKILL.md", ".agents/skills/arcadia-release-manager/SKILL.md", ".claude/skills/arcadia-release-manager/SKILL.md", "docs/agent-guidance/operator-actions.md", "docs/agent-guidance/coordinator-handoff-design.md", "docs/agents-context.md"]
  - id: derive-start-card-from-main
    title: Add one pure function and a read-only command `arcadia start-run derive` that compute the whole standing-grant START card (descriptor, launcher and reviewed manifest bytes) from origin main, the governed queue, the production policy, the open standing-grant receipt and fixed constants, with no agent-supplied field.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-derive-start-card-from-main-657e3b2c2339; no further action.
    expected_artifact: Evidence satisfying Agent Ask derive-start-card-from-main
    clarification: clarified
    confidence: high
    source: Agent Ask mira-card-integrity-20261115-e
    why: "Every card defect of 2026-11-15 entered through a value an agent typed: the Action list and its count, the expiry hours, the named cause, the hand-copied descriptor and the hand-written reviewed manifest. A card with no typed value cannot carry a typed mistake."
    acceptance_criteria:
      - A test shows `arcadia start-run derive --json` accepts no option for Plan, Actions, Action count, provider, concurrency, expiry, cause, Decision or card id, and exits non-zero with a named refusal when any such option is passed.
      - A test shows the derived Plan is the Plan the open standing-grant receipt and the approved work queue name, and the derived Actions are exactly the first unfinished ready Actions of that Plan at the top of the governed queue in queue order, at most 12, stopping before the first Action that is not ready.
      - A test shows two derivations from the same main revision, queue revision, production revision and epoch, receipt set and clock minute are byte-identical, and that the card id is a function of those inputs.
      - A test shows the card lifetime is a single exported constant of 10 minutes and the previous-press block is read from the production record (clean batch, failed attempt or no session) with no free-text field.
      - A test shows the derived reviewed manifest holds the sha256 of the derived launcher, descriptor and executor, and that the derived descriptor passes validateStartRunPins and validateDescriptor unchanged.
      - A property test over at least 200 generated Plan and queue fixtures shows every derived card pins only open Actions of the receipt's Plan, in queue order, with concurrency 1 and provider claude-code-cli, or derives nothing and reports one named reason.
      - "The command mutates nothing: a test shows the library, the workspace database and the checkout are byte-identical before and after it runs."
      - Focused vitest for the touched suites, lint and tsc pass.
    depends_on: [verify-standing-grant-receipt]
    decisions: []
    references: ["src/commands/startRun.ts", "src/operatorActions/startRunPins.ts", "src/operatorActions/libraryContract.ts", "src/docs/dispatch.ts", "docs/agent-guidance/operator-actions.md"]
  - id: refuse-press-unless-card-rederives
    title: Make scripts/start-run.sh refuse a standing-grant press unless the card on disk is byte-identical to a fresh derivation, checked at P0 and again immediately before the one-shot allowance is consumed, so a hand-written or hand-edited standing-grant card can never run.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Make scripts/start-run.sh refuse a standing-grant press unless the card on disk is byte-identical to a fresh derivation, checked at P0 and again immediately before the one-shot allowance is consumed, so a hand-written or hand-edited standing-grant card can never run.
    expected_artifact: Evidence satisfying Agent Ask refuse-press-unless-card-rederives
    clarification: clarified
    confidence: high
    source: Agent Ask mira-card-integrity-20261115-e
    why: "A generator alone leaves the old hand route open: any agent can still write a descriptor into the library and press it. Only a press-time recomputation by the executor closes that route, and it also turns a stale card into a refusal."
    acceptance_criteria:
      - A mutation test changes each key of START_RUN_KEYS, the delegation block, expires_at, the title and the launcher in turn on an otherwise derived card, and every one of those presses exits non-zero with the refusal code CARD_NOT_DERIVED before any mutation, naming the differing field.
      - A test shows a derived card is refused with CARD_NOT_DERIVED after origin main, the queue revision, the production revision or the receipt set changes between derivation and press, and that no allowance is consumed.
      - A test shows the comparison runs in P0 and again in P3 before the consumed marker is written, and that a card swapped between the two is refused at P3.
      - A test shows a card that names the standing-grant Decision in its delegation block but was not produced by the deriver (hand-written manifest, extra planActivation block, or a narrower Action list) is refused.
      - A test shows operator-pressed cards under Decisions 0156 and 0157 and day-grant cards under Decision 0173 behave exactly as before.
      - The delegated press route refuses a standing-grant press whose card id is not the id the deriver returns for the current state, shown by a test.
      - The PR description lists every authority-path edit, and focused vitest, the start-run shell suites, lint and tsc pass.
    depends_on: [derive-start-card-from-main]
    decisions: []
    references: ["scripts/start-run.sh", "src/operatorActions/startRunPins.ts", "src/operatorActions/startRunDayGrant.ts", "src/operatorActions/operatorExecution.ts", "docs/agent-guidance/operator-actions.md"]
  - id: bind-replay-and-authority-scope-to-the-derived-card
    title: "Make the pre-press replay a proof about this exact card, and keep Actions that need the operator out of a derived card: the press refuses unless a replay receipt names the card's descriptor sha256 and its pinned revisions and predicts a launch for every pinned Action, and the deriver stops the card before any Action that cites an open Decision or names an authority path."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make the pre-press replay a proof about this exact card, and keep Actions that need the operator out of a derived card: the press refuses unless a replay receipt names the card's descriptor sha256 and its pinned revisions and predicts a launch for every pinned Action, and the deriver stops the card before any Action that cites an open Decision or names an authority path."
    expected_artifact: Evidence satisfying Agent Ask bind-replay-and-authority-scope-to-the-derived-card
    clarification: clarified
    confidence: high
    source: Agent Ask mira-card-integrity-20261115-e
    why: "Today production-replay --card states it is no evidence the card would pass its own preconditions, nothing ties a replay to the card's bytes, and an Action that edits authority paths is found only at the worker merge after the work is done."
    acceptance_criteria:
      - A test shows production-replay --card writes a receipt carrying the card descriptor's sha256, reviewedRevision, queue revision, production revision and epoch, and one predicted outcome per pinned Action.
      - A test shows a standing-grant press is refused with REPLAY_REQUIRED when no such receipt exists, with REPLAY_MISMATCH when any of those five values differs from the card, and with REPLAY_PREDICTS_NO_LAUNCH when any pinned Action's predicted outcome is not a launch.
      - A test shows the replay builds its activation through the same function the executor's P6 uses for scope, provider, transitions, concurrency and grant hours, so the two cannot be given different inputs; a fixture that changes one of them in only one place fails the test.
      - A test shows the deriver ends the card before the first Action whose `decisions` names an unanswered Decision or whose `references` include a path classifyAuthorityPaths classifies, records that Action as one operator item, and derives nothing when that Action is first in the queue.
      - A test shows the worker-merge authority gate of candidateChangeGate is unchanged, so an Action that touches an authority path it did not declare is still held at merge.
      - docs/agent-guidance/operator-actions.md states that a replay receipt is a prediction bound to one card, not proof of the run's result.
      - Focused vitest for the touched suites, lint and tsc pass.
    depends_on: [derive-start-card-from-main, refuse-press-unless-card-rederives]
    decisions: []
    references: ["scripts/production-replay.ts", "scripts/start-run.sh", "src/decisions/batchMerge.ts", "src/production/candidateChangeGate.ts", "src/production/workerMerge.ts", "src/docs/operatorGate.ts"]
  - id: prove-card-integrity-against-recorded-defects
    title: Add a checked-in regression suite that replays each START card defect recorded on 2026-11-15 against the derived-card path and shows it is either unrepresentable or refused, add a repository check that keeps the deriver free of agent-supplied inputs, and record the residual risks with their bounds in the operator guidance.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Add a checked-in regression suite that replays each START card defect recorded on 2026-11-15 against the derived-card path and shows it is either unrepresentable or refused, add a repository check that keeps the deriver free of agent-supplied inputs, and record the residual risks with their bounds in the operator guidance.
    expected_artifact: Evidence satisfying Agent Ask prove-card-integrity-against-recorded-defects
    clarification: clarified
    confidence: high
    source: Agent Ask mira-card-integrity-20261115-e
    why: "The operator asked to trust that cards are prepared properly. That trust needs a standing proof that fails loudly when a later change reopens a hand-typed field, and an honest list of what a derived card still cannot rule out."
    acceptance_criteria:
      - "A test named for each recorded defect passes: a card minted and left 8 hours cannot exist because derivation and press are one step with a 10-minute lifetime; an Off with request id `.-plan3-pins-13-15-complete-20261115` is refused; a card with a hand-edited pin is refused with CARD_NOT_DERIVED; a standing-grant press after a clean batch needs no hand-written pre-mortem pointer and after a failed batch is refused without one."
      - A repository check fails when the deriver's exported function gains a parameter outside the fixed input set (main revision, Plan frontmatter, queue, production policy, receipts, clock) or when START_RUN_KEYS gains a key the deriver does not compute.
      - A test shows classifyAuthorityPaths classifies the deriver module, scripts/start-run.sh, src/operatorActions/startRunPins.ts and scripts/production-replay.ts, so a change to any of them cannot merge on a worker merge.
      - "docs/agent-guidance/operator-actions.md lists the residual risks with their bounds: the content of an approved Plan (the operator's queue approval and exact-head review before every merge), a defect in the deriver or executor (this suite, the property test and the operator-held merge of those files), a run that differs from its replay (concurrency one and the failed-batch stop of Decisions 0181 and 0187), and a host or credential fault (preflight P2 and P4)."
      - The guidance states that operator-pressed cards under Decisions 0156 and 0157 are still prepared by an agent and reviewed before the operator presses them.
      - Focused vitest for the touched suites, lint and tsc pass.
    depends_on: [refuse-press-unless-card-rederives, bind-replay-and-authority-scope-to-the-derived-card, guard-rowan-off-request-id]
    decisions: []
    references: ["src/commands/startRun.ts", "scripts/start-run.sh", "src/decisions/batchMerge.ts", "tests", "docs/agent-guidance/operator-actions.md", "docs/decisions/0241-may-one-standing-start-grant-replace-the-daily-approval-of-decision-0173-so.md"]
questions: []
decisions: []
current_action: read-the-grant-in-rowan-and-signal-guidance
recommended_model: standard
recommended_reasoning_effort: medium
---

# Draft an inactive Plan of five bounded Actions that replace the daily START approval with one standing grant the operator presses once, so production on the chosen Plan moves on its own and asks the operator only for decisive action

Created as an inactive draft from accepted Agent Ask ellis-standing-autonomy-20261115d; creation changed no pointer. Current activation is recorded in frontmatter.
