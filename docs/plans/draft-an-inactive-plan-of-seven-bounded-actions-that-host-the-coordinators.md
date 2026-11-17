---
arcadia: v1
type: plan
slug: draft-an-inactive-plan-of-seven-bounded-actions-that-host-the-coordinators
project: arcadia
status: draft
milestone: Draft an inactive Plan of seven bounded Actions that host the coordinators (Rowan, then Signal and Flynn) as Arcadia-launched tmux sessions under the relay, with one live handoff and one worker-merged source change as proof
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-17
actions:
  - id: fix-tmux-codex-start-alert-and-meter-reviews
    title: Fix or explain the 'tmux could not start the Codex Session' red alert with a reproducing test, bound alert re-fires, and record reviewer tokens and wall time per verdict.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Fix or explain the 'tmux could not start the Codex Session' red alert with a reproducing test, bound alert re-fires, and record reviewer tokens and wall time per verdict.
    expected_artifact: Evidence satisfying Agent Ask fix-tmux-codex-start-alert-and-meter-reviews
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-host-coordinators-20261115c
    why: "A recurring false or unexplained red alert and unmetered reviews are the cheapest failure modes to retire before hosting more sessions in tmux."
    acceptance_criteria:
      - Confirm the cause in code and in the recorded alert before editing; if the premise is false, stop and report. A failing-first test reproduces the tmux start failure path (injected tmux adapter) and shows either the corrected behaviour or an alert whose text names the actual cause.
      - A test shows an unchanged red alert episode fires once per episode (stable dedupe key) and replays add no ping.
      - Each independent-review verdict records reviewer tokens and wall time in its existing receipt, shown by a test; no schema is hand-edited and no new ping kind is added.
      - Focused vitest for the touched suites, lint and tsc pass; the PR description lists any authority-path edits.
    depends_on: []
    decisions: []
    references: ["src/production/redAlerts.ts", "src/production/redAlertDiagnosis.ts", "src/production/independentReview.ts", "src/sessions/launch.ts"]
  - id: settle-relay-probes-and-launch-decision
    title: Prepare and run relay probes P1 and P2 only under the operator's own per-probe approval, record their receipts, and present the relay-launch standing order (A yes pinned, B ask first, C no launches) as an Agent Ask proposal Decision.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Prepare and run relay probes P1 and P2 only under the operator's own per-probe approval, record their receipts, and present the relay-launch standing order (A yes pinned, B ask first, C no launches) as an Agent Ask proposal Decision.
    expected_artifact: Evidence satisfying Agent Ask settle-relay-probes-and-launch-decision
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-host-coordinators-20261115c
    why: "Decision 0191 makes real relay launch conditional on P1 and P2, and the standing order is the one new authority hosted Rowan needs."
    acceptance_criteria:
      - Probe plans for P1 and P2 are written with exact commands, bounds and expected receipts, and each waits for the operator's own approval in his chat or on a durable surface; no agent self-approves and no launch occurs without it.
      - After approval, P1 and P2 receipts are recorded in the repository evidence path, including whether a CLI session with --remote-control is visible and messageable; a failure is preserved and reported, not retried past its bound.
      - A Decision with options A, B and C and a consequence per option is submitted through an Agent Ask proposal; the Action stays blocked, not complete, until the operator answers.
    depends_on: []
    decisions: []
    references: ["docs/agent-guidance/coordinator-handoff-design.md", "docs/decisions/0191-authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-07-f9415ce1.md", "src/coordinator/relay.ts"]
  - id: idle-wake-for-hosted-rowan
    title: Implement the idle-coordinator wake from proposal agentask_8cb7d47cb80d86acbb so that a hosted Rowan resumes on a PR merge or a production state change.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Implement the idle-coordinator wake from proposal agentask_8cb7d47cb80d86acbb so that a hosted Rowan resumes on a PR merge or a production state change.
    expected_artifact: Evidence satisfying Agent Ask idle-wake-for-hosted-rowan
    clarification: clarified
    confidence: high
    source: Agent Ask claudia-host-coordinators-relay-tick-20261116
    why: "scripts/wait-for-event.sh wakes only the session that started it; an idle hosted coordinator needs an Arcadia-side wake."
    acceptance_criteria:
      - Read proposal agentask_8cb7d47cb80d86acbb and confirm gap G3 in code before editing; if the premise is false, stop and report.
      - A failing-first test with an injected tmux adapter shows an idle registered coordinator receives exactly one wake message when a watched PR leaves OPEN or production state changes, a non-custodian or standby never receives it, and replays add none.
      - The wake runs from the existing timer or tick, never inline in a way that can starve the heartbeat, and a send failure only logs and alerts once.
      - Focused vitest, lint and tsc pass.
    depends_on: [prove-two-live-rowan-handoffs]
    decisions: []
    references: ["scripts/wait-for-event.sh", "src/coordinator/relay.ts", "src/production/idleFront.ts", "src/sessions/launch.ts"]
  - id: fix-day-evidence-and-carry-day-grant
    title: "Fix Issue #2273 so a Plan's last-Action merge reads as done in `arcadia start-run day-evidence`, and make an existing Decision 0173 day grant reach a successor Rowan generation without retyped approval."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Fix Issue #2273 so a Plan's last-Action merge reads as done in `arcadia start-run day-evidence`, and make an existing Decision 0173 day grant reach a successor Rowan generation without retyped approval."
    expected_artifact: Evidence satisfying Agent Ask fix-day-evidence-and-carry-day-grant
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-host-coordinators-20261115c
    why: "The last batch read as failed and Rowan 2 to Rowan 3 needed the operator to retype approval; both are avoidable operator touches."
    acceptance_criteria:
      - "Confirm #2273 in code and in `start-run day-evidence` output before editing; if the premise is false, stop and report."
      - A failing-first test shows a final batch whose last merge landed and which leaves no current_action reads scopeComplete true, while a batch with an unmerged Action still reads incomplete.
      - The grant-carry change only lets a verified successor custodian read the approval Decision 0200 already recorded; it never creates, extends or renews a grant, and a test shows an expired or unrecorded grant is refused. If Decision 0200 does not permit the change, the Action stops and submits a proposal Decision instead.
      - Focused vitest, lint and tsc pass; authority-path edits are listed in the PR description.
    depends_on: []
    decisions: []
    references: ["docs/decisions/0173-decide-what-authority-rowan-holds-for-a-day-at-a-time-over-unattended-work-on.md", "docs/decisions/0200-decide-how-a-day-approval-under-decision-0173-reaches-a-rowan-that-takes-over.md", "docs/managed-production-readiness.md"]
  - id: prove-live-hosted-rowan-handoff
    title: "Observe one live Rowan-to-Rowan handoff through the relay with pending native mail and record the evidence, closing Issue #2697."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Observe one live Rowan-to-Rowan handoff through the relay with pending native mail and record the evidence, closing Issue #2697."
    expected_artifact: Evidence satisfying Agent Ask prove-live-hosted-rowan-handoff
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-host-coordinators-20261115c
    why: "Handoff is the failure that forces operator touches today; one observed live transfer is the proof the hosted model needs."
    acceptance_criteria:
      - Runs only after the operator's answer to the relay-launch Decision from the probes Action permits launching; otherwise the Action stops and reports the missing approval.
      - With native mail pending, a successor Rowan is launched in tmux by the relay, its first prompt delivery is verified, custody transfers, the predecessor stops, and the successor does not double-acknowledge its predecessor's mail; each step is a receipt in the evidence file.
      - "A failure is preserved with its receipt and reported with the exact boundary; Issue #2697 is closed only with the evidence."
    depends_on: [settle-relay-probes-and-launch-decision]
    decisions: []
    references: ["docs/agent-guidance/coordinator-handoff-design.md", "src/coordinator/relay.ts", "docs/evidence/rowan-attention-loop/README.md"]
  - id: host-signal-and-flynn-under-the-relay
    title: Register Signal and Flynn as relay roles hosted in tmux, so each survives a context renewal, only after the operator answers a supervision Decision.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Register Signal and Flynn as relay roles hosted in tmux, so each survives a context renewal, only after the operator answers a supervision Decision.
    expected_artifact: Evidence satisfying Agent Ask host-signal-and-flynn-under-the-relay
    clarification: clarified
    confidence: high
    source: Agent Ask claudia-host-coordinators-relay-tick-20261116
    why: "Signal is the operator's single contact and is still a Desktop session whose starts are often refused; hosting it removes that dependency."
    acceptance_criteria:
      - A Decision naming who supervises whom and whether Signal and Flynn are hosted under the relay exists on main with an operator answer (answered_at recorded) before the first commit of this Action's branch; `arcadia decision show <id>` and `git log` prove the order.
      - After approval, a test shows Signal and Flynn register as relay roles with separate custody rows and one renewal each in a fixture; START tolerance still refuses any unregistered session.
      - One live renewal of each is recorded as evidence, with the Rowan custody rules unchanged.
    depends_on: [prove-live-hosted-rowan-handoff, prove-two-live-rowan-handoffs]
    decisions: []
    references: ["docs/agent-guidance/signal.md", "docs/agent-guidance/coordinator-handoff-design.md", "src/coordinator/relay.ts"]
  - id: worker-merge-one-source-action-with-main-moving
    title: Run one small source-changing Action (unclassified src/**) through production at concurrency one, merged by the worker at exact-head review while main moves during the run.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Run one small source-changing Action (unclassified src/**) through production at concurrency one, merged by the worker at exact-head review while main moves during the run.
    expected_artifact: Evidence satisfying Agent Ask worker-merge-one-source-action-with-main-moving
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-host-coordinators-20261115c
    why: "Only test-only pins have been merged unattended; this is the smallest proof of the next envelope under Decision 0214 A."
    acceptance_criteria:
      - The chosen Action changes only src/** paths isWorkerMergeSafePath accepts, touches no gate-enforcing module, and its Plan card is approved by the operator or under a valid day grant; the allowlist is not widened.
      - A worker merge at the reviewed head lands with at least one unrelated commit on main during the run, and the run record lists every operator touch.
      - Any refusal is preserved with its code; this Action does not widen concurrency, merge rules or spend.
    depends_on: [prove-live-hosted-rowan-handoff]
    decisions: []
    references: ["src/production/workerMerge.ts", "docs/decisions/0214-which-merge-route-should-unattended-production-s-worker-use-for-candidate-pull.md", "docs/managed-production-readiness.md"]
  - id: wire-renew-into-liveness-tick
    title: Wire the relay's renew into the launchd liveness tick so a registered Rowan custodian that reads due or forced gets a successor launched with no operator touch.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Wire the relay's renew into the launchd liveness tick so a registered Rowan custodian that reads due or forced gets a successor launched with no operator touch.
    expected_artifact: Evidence satisfying Agent Ask wire-renew-into-liveness-tick
    clarification: clarified
    confidence: high
    source: Agent Ask claudia-host-coordinators-relay-tick-20261116
    why: "Nothing calls renew today (Issue #2286), so Decision 0191 A's relay never launches a successor; every handoff still needs the operator."
    acceptance_criteria:
      - The liveness check calls renew --repo <primary checkout> for a role only when the registered custodian's own session id reads due or forced, no generation is launching, and no START press is running; fixture tests show one launch per episode and none on replay.
      - Each refusal has a named skip reason, shown by a test; exactly one ping is sent when both launch attempts fail; a renew error never fails the worker heartbeat.
      - A title-matched but unregistered session never triggers a launch, shown by a test; focused vitest, lint and tsc pass and the PR description lists any authority-path edits.
    depends_on: []
    decisions: []
    references: ["docs/agent-guidance/coordinator-handoff-design.md", "src/coordinator/relay.ts", "src/commands/coordinatorBudget.ts", "docs/decisions/0191-may-arcadia-s-deterministic-relay-launch-successor-coordinator-sessions-signal.md", "docs/decisions/0245-where-does-the-relay-tick-work-wire-renew-into-the-liveness-tick-stand-down-for.md"]
  - id: stand-down-for-unresponsive-predecessor
    title: Let the relay record stand-down for a predecessor Rowan that never stands down, at forced 75% or after 20 minutes of transcript silence since the launch, so accept can pass.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Let the relay record stand-down for a predecessor Rowan that never stands down, at forced 75% or after 20 minutes of transcript silence since the launch, so accept can pass.
    expected_artifact: Evidence satisfying Agent Ask stand-down-for-unresponsive-predecessor
    clarification: clarified
    confidence: high
    source: Agent Ask claudia-host-coordinators-relay-tick-20261116
    why: "accept refuses until the predecessor itself records stand-down, so a Rowan that ran out of context deadlocks the transfer; Decision 0244 A (the operator's answer) authorizes the relay to stand it down."
    acceptance_criteria:
      - Decision 0244 is answered A on main (answer and decided recorded) before this Action's first commit; arcadia decision show 0244 and git log prove the order.
      - Tests show the relay records stand-down only at the Decision 0244 thresholds (forced 75% or 20 minutes of transcript silence since the launch), never for a predecessor with transcript activity inside the window, and writes a receipt naming the evidence.
      - A test shows accept then passes for that predecessor; focused vitest, lint and tsc pass and the PR description lists any authority-path edits.
    depends_on: []
    decisions: []
    references: ["docs/agent-guidance/coordinator-handoff-design.md", "src/coordinator/relay.ts", "docs/decisions/0244-when-the-relay-has-launched-a-successor-rowan-and-the-outgoing-rowan-never.md"]
  - id: prove-two-live-rowan-handoffs
    title: "Prove two live Rowan handoffs launched by the timer with zero operator touches (hop 1 desktop Rowan to tmux Rowan, hop 2 tmux to tmux) and record the evidence, closing Issue #2697."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Prove two live Rowan handoffs launched by the timer with zero operator touches (hop 1 desktop Rowan to tmux Rowan, hop 2 tmux to tmux) and record the evidence, closing Issue #2697."
    expected_artifact: Evidence satisfying Agent Ask prove-two-live-rowan-handoffs
    clarification: clarified
    confidence: high
    source: Agent Ask claudia-host-coordinators-relay-tick-20261116
    why: "Only fixtures exist today; two recorded automatic handoffs are the live proof, and the condition under which Decision 0246 A renews Decision 0191."
    acceptance_criteria:
      - Each hop is launched by the timer with the operator touching nothing; each hop's launch-proof has equal hashes at attempt 1, and its verify, accept and predecessor-stop receipts are filed.
      - A preflight START passes with the hosted Rowan live, and the run record lists operator touches as none; every unattended permission refusal during the proof is recorded.
      - "A failure is preserved with its receipt and reported with the exact boundary; Issue #2697 is closed only with the evidence."
    depends_on: [wire-renew-into-liveness-tick, stand-down-for-unresponsive-predecessor]
    decisions: []
    references: ["docs/agent-guidance/coordinator-handoff-design.md", "src/coordinator/relay.ts", "docs/decisions/0246-decision-0191-relay-launches-of-successor-coordinator-sessions-expires-2026-12.md"]
  - id: point-handoff-skills-at-the-relay
    title: "Point the arcadia-handoff, arcadia-signal and nightshift skills at the relay: at due the timer launches the successor, the predecessor journals, stands down and stops, and no paste prompt is asked of the operator."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Point the arcadia-handoff, arcadia-signal and nightshift skills at the relay: at due the timer launches the successor, the predecessor journals, stands down and stops, and no paste prompt is asked of the operator."
    expected_artifact: Evidence satisfying Agent Ask point-handoff-skills-at-the-relay
    clarification: clarified
    confidence: high
    source: Agent Ask claudia-host-coordinators-relay-tick-20261116
    why: "The three skills still describe the paste-a-prompt handoff, which contradicts the relay once it is live."
    acceptance_criteria:
      - Each of the three skills keeps one portable SKILL.md source with its required resources, exposed through the shared .agents/skills and Claude's .claude/skills discovery paths (repository or personal scope as appropriate), with existing installs preserved.
      - Discovery is verified on the Codex, Claude Code and OpenCode paths, with native checks reported separately from filesystem checks, and no skill installation grants execution authority.
      - No remaining instruction in the three skills asks the operator to start a successor Rowan.
    depends_on: [prove-two-live-rowan-handoffs]
    decisions: []
    references: ["docs/agent-guidance/coordinator-handoff-design.md"]
  - id: name-one-home-for-helper-launch
    title: "Name one home for helper launch: one Action id owns it, and the overlapping housekeeping and governed-roles Actions cite it as superseding or are marked deferred with a revival trigger."
    status: open
    responsibility: agent
    effort: session
    next_action: "Name one home for helper launch: one Action id owns it, and the overlapping housekeeping and governed-roles Actions cite it as superseding or are marked deferred with a revival trigger."
    expected_artifact: Evidence satisfying Agent Ask name-one-home-for-helper-launch
    clarification: clarified
    confidence: high
    source: Agent Ask claudia-host-coordinators-helper-launch-20261117
    why: "Three draft Plans touch helper launch; without one named owner the same work would be built twice."
    acceptance_criteria:
      - One Action id owns helper launch and no Action for it exists twice across the Plans.
      - The housekeeping Plan's launch-helpers-from-role-briefs-and-stop-exact-identity and the governed-roles Plan's broker-delegation-requests either cite this Plan's Action as superseding or are marked deferred with a named revival trigger, through the governed Agent Ask route; no Plan status or pointer is hand-edited.
    depends_on: [prove-two-live-rowan-handoffs]
    decisions: []
    references: ["docs/decisions/0253-record-the-operator-s-answer-on-how-much-of-rowan-as-team-lead-helper-launch-to.md", "docs/decisions/0225-d3-may-arcadia-start-helper-sessions-beyond-the-two-conditional-launch-decisions.md"]
  - id: launch-helpers-from-the-timer
    title: "Add arcadia helper request, list and stop: Rowan writes a request row and receipt, and the existing liveness tick launches each admitted request through the relay's launcher, extracted from relay.ts, with delivery proved by sha."
    status: open
    responsibility: agent
    effort: session
    next_action: "Add arcadia helper request, list and stop: Rowan writes a request row and receipt, and the existing liveness tick launches each admitted request through the relay's launcher, extracted from relay.ts, with delivery proved by sha."
    expected_artifact: Evidence satisfying Agent Ask launch-helpers-from-the-timer
    clarification: clarified
    confidence: high
    source: Agent Ask claudia-host-coordinators-helper-launch-20261117
    why: "Rowan can staff research, planning and repair work with nobody awake, without any agent starting a session itself, which the host refuses."
    acceptance_criteria:
      - Failing-first tests with an injected launcher show that a request from anyone but the registered custodian is refused, a helper's own request is refused (depth), and code-reviewer and qa roles are refused.
      - A spend, capacity or sign-in refusal launches nothing and leaves a receipt, and a missing spend or capacity envelope refuses (Decision 0225 A); a test shows two attempts then one ping.
      - A test shows the fixed daily cap of Decision 0256 A holds (about six launches a day, light tier first, no paid fallback), a replay adds no launch, and helper stop targets the exact recorded session id.
      - The receipt names the model actually running and flags a mismatch, a table of live helper sessions backs helper list, the coordinator path in relay.ts behaves as before, and focused vitest, lint and tsc pass with authority-path edits listed in the PR description.
    depends_on: [prove-two-live-rowan-handoffs, name-one-home-for-helper-launch]
    decisions: []
    references: ["src/coordinator/relay.ts", "src/coordinator/launchProof.ts", "src/commands/keeper.ts", "src/agentRoles/registry.ts", "src/agentRoles/brief.ts", "docs/decisions/0256-record-the-operator-s-answer-on-the-finite-helper-envelope-decision-0225-a.md"]
  - id: return-helper-results-by-mail
    title: Return helper results to Rowan by native mail with receipts, so the assignment is delivered in the launch prompt and a report goes only to the requesting Rowan.
    status: open
    responsibility: agent
    effort: session
    next_action: Return helper results to Rowan by native mail with receipts, so the assignment is delivered in the launch prompt and a report goes only to the requesting Rowan.
    expected_artifact: Evidence satisfying Agent Ask return-helper-results-by-mail
    clarification: clarified
    confidence: high
    source: Agent Ask claudia-host-coordinators-helper-launch-20261117
    why: "Decision 0255 A makes Rowan the only recipient; a reported result must be acknowledged or show as overdue."
    acceptance_criteria:
      - A fixture shows the assignment delivered (equal hashes), the report sent, exposed and acknowledged, each with a receipt.
      - An unacknowledged report appears as overdue after the window, and an idle Rowan receives exactly one wake.
      - A helper cannot address anyone but its requester, shown by a test; focused vitest, lint and tsc pass.
    depends_on: [launch-helpers-from-the-timer]
    decisions: []
    references: ["src/nativeMail/attention.ts", "docs/decisions/0255-record-the-operator-s-answer-on-who-may-message-whom-in-a-rowan-team.md"]
  - id: prove-one-live-helper-team
    title: "Prove one live helper team: a hosted Rowan requests one researcher and one implementer, the timer launches both, they report and are stopped, and the evidence is recorded."
    status: open
    responsibility: agent
    effort: session
    next_action: "Prove one live helper team: a hosted Rowan requests one researcher and one implementer, the timer launches both, they report and are stopped, and the evidence is recorded."
    expected_artifact: Evidence satisfying Agent Ask prove-one-live-helper-team
    clarification: clarified
    confidence: high
    source: Agent Ask claudia-host-coordinators-helper-launch-20261117
    why: "No timer-launched helper has run yet; one observed live team is the proof before any further team work."
    acceptance_criteria:
      - Both helpers are launched by the timer, report by mail and are stopped, with the operator touching nothing and every operator touch listed in the run record.
      - Tokens, minutes, model and tier are recorded per helper, and any refusal is preserved with its code.
      - A START preflight passes with the helpers stopped.
    depends_on: [return-helper-results-by-mail]
    decisions: []
    references: ["docs/decisions/0253-record-the-operator-s-answer-on-how-much-of-rowan-as-team-lead-helper-launch-to.md"]
questions: []
decisions: []
---

# Draft an inactive Plan of seven bounded Actions that host the coordinators (Rowan, then Signal and Flynn) as Arcadia-launched tmux sessions under the relay, with one live handoff and one worker-merged source change as proof

Created as an inactive draft from accepted Agent Ask ellis-host-coordinators-20261115c; creation changed no pointer. Current activation is recorded in frontmatter.
