---
arcadia: v1
type: plan
slug: draft-an-inactive-plan-of-five-bounded-actions-that-replace-the-daily-start
project: arcadia
status: draft
milestone: Draft an inactive Plan of five bounded Actions that replace the daily START approval with one standing grant the operator presses once, so production on the chosen Plan moves on its own and asks the operator only for decisive action
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-15
actions:
  - id: decide-standing-start-grant
    title: Submit one operator Decision that replaces the daily approval of Decision 0173 with a standing START grant, with the four lettered options recorded here, and stay blocked until the operator answers.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Submit one operator Decision that replaces the daily approval of Decision 0173 with a standing START grant, with the four lettered options recorded here, and stay blocked until the operator answers.
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
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make Rowan's own Off impossible to mislabel: the CLI composes the rowan-off id, and a malformed request id is refused before production policy changes."
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
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Add a standing-grant card and its read-only check beside the day grant, with no 24-hour window, refused unless the standing-grant Decision is answered A or B on the pinned main.
    expected_artifact: Evidence satisfying Agent Ask verify-standing-grant-receipt
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-standing-autonomy-20261115d
    why: "The 24-hour window in startRunDayGrant.ts is what turns one approval into a daily press; the grant must be a durable receipt any session or timer can verify without chat words."
    acceptance_criteria:
      - A test shows a START card pinned from a standing-grant receipt pressed 30 days earlier passes the grant check, while the same card pinned from a day-grant receipt older than 24 hours is still refused.
      - A test shows the standing-grant check refuses when the Decision found by its slug is unanswered or answered C or D on the pinned main, with a refusal code that names the Decision.
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
    source: Agent Ask ellis-standing-autonomy-20261115d
    why: "Today each successor card needs a live Rowan, an agent pre-mortem and a press, and a card left waiting expires; four of today's touches came from that gap."
    acceptance_criteria:
      - A fixture test shows two consecutive batches on one Plan run to scope complete with exactly 1 operator press recorded, the standing grant, and both START presses recorded as delegated.
      - A test shows the timer step mints a card for the next unfinished Actions in queue order, at most 12, and presses it in the same run, so the library never holds a delegated card older than 10 minutes unpressed.
      - A test shows the step presses only when production is Off, the previous batch reads clean, main's required checks are green and no card hold exists, and otherwise records one named skip reason and presses nothing.
      - A test shows that after a clean batch the card's manifest carries the replay receipt as its pre-press check and the press passes, while after a failed batch the press is refused until an independent pre-mortem pointer and a merged fix for the named cause are recorded.
      - A test shows a refused press sends exactly one operator ping naming the refusal code, ends the step for that grant, and a replay of the step adds no second press and no second ping.
      - A test shows the step issues the Off at scope complete through the rowan-off route and that this Off does not end the grant.
      - The step runs from the existing timer, never inside an agent session, and the PR description lists every authority-path edit.
    depends_on: [verify-standing-grant-receipt]
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
    source: Agent Ask ellis-standing-autonomy-20261115d
    why: "Rowan 17 refused a permitted press because an uncommitted start prompt said never press START, and Signal's ping rule turned every card and every chat sentence into an interruption."
    acceptance_criteria:
      - The Signal and release-manager skills state that press authority is read from `arcadia start-run grant-status` and from no chat message, and the copies under .agents/skills and .claude/skills contain identical text, shown by a byte comparison.
      - A checked-in start-prompt template for Rowan and for Signal exists, contains no blanket ban on pressing START, and tells the session to read grant-status at start; a repository check fails when a skill or template contains the phrase 'never press START'.
      - "The Signal skill lists the real-time ping causes as exactly these: a Decision to answer, a Plan to choose, a merge that carries a Decision or changes authority, a spend or credential step, a second failed batch on one cause, a refused press, and an ended grant; every other event is recorded for the digest."
      - A test shows that with a standing grant open the events card ready, batch complete and successor pressed send 0 real-time pings, and that a refused press sends one.
      - docs/agents-context.md names the standing grant as the separate START approval and AGENTS.md is regenerated from it, with the instruction-budget check passing; this edit is made only after the operator's answer is A or B.
      - The pull request is labelled as changing what agents are authorized to do, and its description lists each changed authority sentence beside the Decision option that permits it.
    depends_on: [decide-standing-start-grant, verify-standing-grant-receipt]
    decisions: []
    references: [".agents/skills/arcadia-signal/SKILL.md", ".claude/skills/arcadia-signal/SKILL.md", ".agents/skills/arcadia-release-manager/SKILL.md", ".claude/skills/arcadia-release-manager/SKILL.md", "docs/agent-guidance/operator-actions.md", "docs/agent-guidance/coordinator-handoff-design.md", "docs/agents-context.md"]
questions: []
decisions: []
---

# Draft an inactive Plan of five bounded Actions that replace the daily START approval with one standing grant the operator presses once, so production on the chosen Plan moves on its own and asks the operator only for decisive action

Created as an inactive draft from accepted Agent Ask ellis-standing-autonomy-20261115d; creation changed no pointer. Current activation is recorded in frontmatter.
