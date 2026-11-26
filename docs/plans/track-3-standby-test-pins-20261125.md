---
arcadia: v1
type: plan
slug: track-3-standby-test-pins-20261125
project: arcadia
status: active
milestone: Track 3 standby test pins 20261125
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-26
actions:
  - id: pin-predecessor-tolerance-window
    title: Pin how long START tolerates a handed-off predecessor after its successor accepts, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-predecessor-tolerance-window-7235d862c90b; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-predecessor-tolerance-window
    clarification: clarified
    confidence: high
    source: Agent Ask plan-track-3-standby-test-pins-20261125
    why: "predecessorToleranceWindow (src/coordinator/generations.ts:181-193) decides whether START tolerates a live handed-off predecessor (#3029 fix A, PR #3033), and no test file names it, so its 30-minute boundary and fail-closed unmeasurable cases are pinned only through the predecessor-stop timer."
    acceptance_criteria:
      - "tests/pin-predecessor-tolerance-window.test.ts is a new test file that imports predecessorToleranceWindow and PREDECESSOR_TOLERANCE_WINDOW_MS from ../src/coordinator/generations.js (lines 40 and 181-193) and, with now N, asserts PREDECESSOR_TOLERANCE_WINDOW_MS is 30 minutes, that accept times 0, 10 and exactly 30 minutes before N give { state: \"within\" } with minutes 0, 10 and 30, and that one 30 minutes and 1 millisecond before N gives { state: \"expired\", minutes: 30, detail: \"30 min after accept (limit 30)\" }."
      - "The same test file asserts it gives { state: \"unmeasurable\", minutes: null } for a null accept time (detail `the successor's accept time is not recorded, so the 30 min tolerance window cannot be measured`), for \"2026-11-25T11:50:00+00:00\", \"2026-11-25 11:50:00Z\", \"soon\" and \"\", and for an accept time 1 millisecond after N, whose detail says it is later than now."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-predecessor-tolerance-window.test.ts, a new test file of at most 50 lines that imports only vitest and src/coordinator/generations.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-duty-unknown-transitions
    title: Pin when the duty alarm's cannot-judge page opens, holds and closes, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-duty-unknown-transitions-3ced25dc18a2; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-duty-unknown-transitions
    clarification: clarified
    confidence: high
    source: Agent Ask plan-track-3-standby-test-pins-20261125
    why: "decideUnknown (src/production/dutyAlarms.ts:259-278) is the state table for the duty_unknown page, and no test file names it, so its one-page-per-episode and not-judged hold rules are pinned only through the duty alarm's callers."
    acceptance_criteria:
      - "tests/pin-duty-unknown-transitions.test.ts is a new test file that imports decideUnknown and the UnknownEpisode type from ../src/production/dutyAlarms.js (lines 110-116 and 259-278) and, with now N, asserts no prior episode with unknowns [\"a\"] gives transition \"open\" and a new episode { startedAt: N, key: \"duty_unknown since <N>\", reasons: [\"a\"], delivery: null }, a delivered episode with new reasons gives \"none\" with only its reasons replaced, a delivered episode with no unknowns gives \"close\" and next null, and no episode with no unknowns gives \"none\"."
      - The same test file asserts a recorded but undelivered episode gives "open" with cleared false while unknowns remain and "open" with cleared true once they are gone, and that while not judged a delivered episode gives "hold" unchanged and no episode gives "none", both with cleared false.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-duty-unknown-transitions.test.ts, a new test file of at most 50 lines that imports only vitest and src/production/dutyAlarms.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-duty-healthy-running-boundary
    title: Pin when a running Action counts as healthy and so silences the duty ready-floor alarm, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-duty-healthy-running-boundary-1a2edb3961d5; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-duty-healthy-running-boundary
    clarification: clarified
    confidence: high
    source: Agent Ask plan-track-3-standby-test-pins-20261125
    why: "isHealthyRunning (src/production/dutyAlarms.ts:182-184) decides whether a below-floor ready count pages, and no test file names it, so its 120-minute silence cap is pinned only through decideDuty."
    acceptance_criteria:
      - tests/pin-duty-healthy-running-boundary.test.ts is a new test file that imports isHealthyRunning and HEALTHY_MAX_SILENCE_MINUTES from ../src/production/dutyAlarms.js (lines 37 and 182-184) and, with now N and cap C of 120 minutes, asserts HEALTHY_MAX_SILENCE_MINUTES is 120 and that a running count of 1 or 2 whose last activity is at N, at N - C + 1 millisecond, or 1 minute after N is healthy.
      - The same test file asserts it is not healthy when the last activity is exactly N - C or N - C - 1 millisecond, when the count is 0, or when lastActivityAt is null.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-duty-healthy-running-boundary.test.ts, a new test file of at most 50 lines that imports only vitest and src/production/dutyAlarms.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-momentum-ping-fit
    title: Pin how momentum and duty pages render an age and fit the 500-character ping limit, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-momentum-ping-fit-5e332a7a6fc3; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-momentum-ping-fit
    clarification: clarified
    confidence: high
    source: Agent Ask amend-track-3-pin-momentum-ping-fit-ascii-20261125
    why: "formatAge and fitPing (src/production/momentumWatch.ts:184-188 and 228-233) shape every momentum, keeper and duty page, and no test file names either, so the cut that keeps each page's head and episode key is pinned only through whole messages."
    acceptance_criteria:
      - tests/pin-momentum-ping-fit.test.ts is a new test file that imports formatAge and fitPing from ../src/production/momentumWatch.js (lines 184-188 and 228-233) and asserts formatAge gives "0 min" for 0 and 29,999 ms, "1 min" for 30,000 ms, "59 min" for 59 minutes, "1 h 0 min" for 60 minutes and "2 h 5 min" for 125 minutes, and that fitPing returns "H", "-detail-", "T" whole and returns "HH", "dddddd", "TT" whole at a limit of exactly 10.
      - "The same test file asserts formatAge gives \"0 min\" for minus 5 minutes, and that fitPing cuts only the detail and marks the cut with the single character U+2026 (horizontal ellipsis), which the test writes as the JavaScript escape \\u2026: \"HEAD\", 600 d characters and \"TAIL\" give 500 characters made of HEAD, then 491 d characters, then U+2026, then TAIL; and \"HH\", \"dddddddd\", \"TT\" at a limit of 10 give HH, then 5 d characters, then U+2026, then TT."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-momentum-ping-fit.test.ts, a new test file of at most 50 lines that imports only vitest and src/production/momentumWatch.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/production/momentumWatch.ts"]
  - id: pin-momentum-slot-transitions
    title: Pin when a momentum alarm slot pages, closes or holds, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin when a momentum alarm slot pages, closes or holds, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-momentum-slot-transitions
    clarification: clarified
    confidence: high
    source: Agent Ask plan-track-3-standby-test-pins-20261125
    why: "decideSlot, idleSignal and keeperSignal (src/production/momentumWatch.ts:150-162) decide whether the idle and keeper alarms page, and no test file names them, so the rule that an unknown holds rather than clears is pinned only through the momentum timer."
    acceptance_criteria:
      - tests/pin-momentum-slot-transitions.test.ts is a new test file that imports decideSlot, idleSignal, keeperSignal and the AlertSlot type from ../src/production/momentumWatch.js (lines 47-51 and 150-162) and asserts decideSlot gives "alert" for an alarm on a closed slot and "close" for a clear on an open slot, that idleSignal maps idle to "alarm" and a window_closed clear to "clear", and that keeperSignal maps stale to "alarm" and not_required and fresh to "clear".
      - The same test file asserts decideSlot gives null for an alarm on an open slot, for a clear on a closed slot, and for a hold on either, and that idleSignal and keeperSignal map an unknown observation to "hold".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-momentum-slot-transitions.test.ts, a new test file of at most 50 lines that imports only vitest and src/production/momentumWatch.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-budget-exhausted-wording
    title: Pin the message and remedy recorded for a Session stopped at its input-token ceiling, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin the message and remedy recorded for a Session stopped at its input-token ceiling, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-budget-exhausted-wording
    clarification: clarified
    confidence: high
    source: Agent Ask plan-track-3-standby-test-pins-20261125
    why: "describeBudgetExhausted (src/production/sessionTokenCeiling.ts:113-120) writes the escalation the operator reads when the platform token ceiling stops a Session, and no test file names it, so its no-relaunch wording and fixed remedy are pinned only through fast-rehearsal Sessions."
    acceptance_criteria:
      - "tests/pin-budget-exhausted-wording.test.ts is a new test file that imports describeBudgetExhausted from ../src/production/sessionTokenCeiling.js (lines 113-120) and asserts that for Action arcadia:a1, a breach whose message is \"budget_exhausted: M.\" and no wall classes it returns { message: \"Budget exhausted for arcadia:a1: budget_exhausted: M. It will not be relaunched automatically.\", remedy }, with remedy exactly the current two-sentence text from \"Find the cause in the Session's log before spending again\" to \"from a prompt, brief or Action text.\"."
      - The same test file asserts the wall classes ["sandbox", "network"] append ` It also hit an environment wall (sandbox, network).` to the message, in order, and leave the remedy unchanged.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-budget-exhausted-wording.test.ts, a new test file of at most 50 lines that imports only vitest and src/production/sessionTokenCeiling.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-coordinator-note-pr-parse
    title: Pin which coordinator notes and pull request numbers the coordinator journal accepts, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin which coordinator notes and pull request numbers the coordinator journal accepts, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-coordinator-note-pr-parse
    clarification: clarified
    confidence: high
    source: Agent Ask plan-track-3-standby-test-pins-20261125
    why: "normalizeNoteText and parsePrNumbers (src/coordinator/state.ts:60-75) validate the text and --pr values `arcadia coordinator note` records in Rowan's journal, and no test file names either, so their fail-closed refusals are unpinned."
    acceptance_criteria:
      - "tests/pin-coordinator-note-pr-parse.test.ts is a new test file that imports normalizeNoteText, parsePrNumbers and NOTE_MAX_CHARS from ../src/coordinator/state.js (lines 13 and 60-75) and asserts NOTE_MAX_CHARS is 500, normalizeNoteText turns \"  waiting \\n on\\t#3073  \" into \"waiting on #3073\" and accepts exactly 500 characters, and parsePrNumbers reads [\"3073\", \"#3076\"] as [3073, 3076] and no values as []."
      - "The same test file asserts normalizeNoteText throws `A coordinator note needs text.` for whitespace only and `A coordinator note is at most 500 characters; put detail in a PR or Issue and reference it.` for 501 characters, and that parsePrNumbers throws `--pr must be a pull request number, not \"<value>\".` for each of \"0\", \"-1\", \"1.5\", \"abc\" and \"##7\"."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-coordinator-note-pr-parse.test.ts, a new test file of at most 50 lines that imports only vitest and src/coordinator/state.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-standing-grant-answered
    title: Pin which Decision frontmatter reads as an answered standing START grant, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin which Decision frontmatter reads as an answered standing START grant, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-standing-grant-answered
    clarification: clarified
    confidence: high
    source: Agent Ask plan-track-3-standby-test-pins-20261125
    why: "isStandingGrantAnswered (src/operatorActions/startRunDayGrant.ts:251-258) decides whether Decision 0241's standing START grant reads as answered, and no test file names it, so its frontmatter-only and exact-id rules are pinned only through the standing-grant chain."
    acceptance_criteria:
      - tests/pin-standing-grant-answered.test.ts is a new test file that imports isStandingGrantAnswered and STANDING_ANSWERS from ../src/operatorActions/startRunDayGrant.js (lines 97 and 251-258) and asserts STANDING_ANSWERS is exactly ["A. Standing grant", "B. Standing grant", "E. Standing grant"] and that frontmatter with the quoted id "0241", status approved and an answer starting "A. Standing grant" or "E. Standing grant" is answered for id "0241".
      - The same test file asserts it is not answered for the answer "C. Daily approval", for status proposed, for id "0240", for the unquoted id 0241 (which the YAML parser reads as the number 241), for an answer only in the body, and for text with no frontmatter.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-standing-grant-answered.test.ts, a new test file of at most 50 lines that imports only vitest and src/operatorActions/startRunDayGrant.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
questions: []
decisions: []
current_action: pin-momentum-slot-transitions
recommended_model: heavy
recommended_reasoning_effort: high
---

# Track 3 standby test pins 20261125

Created as an inactive draft from accepted Agent Ask plan-track-3-standby-test-pins-20261125; creation changed no pointer. Current activation is recorded in frontmatter.
