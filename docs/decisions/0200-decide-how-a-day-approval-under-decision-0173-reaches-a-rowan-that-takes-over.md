---
arcadia: v1
type: decision
id: "0200"
slug: decide-how-a-day-approval-under-decision-0173-reaches-a-rowan-that-takes-over
project: arcadia
status: open
question: Decide how a day approval under Decision 0173 reaches a Rowan that takes over during that day, so a handoff does not need you to retype the approval.
gap_type: missing-decision
gate_question: reasonable_disagreement
recommendation: A. Let a Rowan taking over try one press on your pressed day approval
options:
  - label: A. Let a Rowan taking over try one press on your pressed day approval
    consequence: "This reads 0173 so that your day approval, once pressed on /actions, covers any Rowan taking over that day, not only the one running when you approved. Nothing new is built apart from a small reviewed note in the custody steps. A successor presses once without you retyping. If your computer refuses that press, Decision 0163 says the day's delegation ends: you approve a new day, and the successor does not retry or route around it. Cost: one small reviewed change. Risk: a refusal costs you the rest of that day. Your typed approval in a chat would no longer restart a day ended this way; you press a new one."
    recommended: true
  - label: B. Keep retyping, and record that today's approval is in force
    consequence: Every Rowan taking over reads that today's approval exists, then asks you to type it in its own chat before pressing. No press is attempted without your words, so a refusal can't end the day. A handoff while you sleep stops the work until you wake, which is the wait you asked to remove.
    recommended: false
  - label: C. Same as A, and you change your own permission settings for the press
    consequence: "You change your own permission settings so the press call to START cards is allowed without asking. Only you can change that setting; no agent will touch it, and Rowan does not recommend this today. Effect: on an approved day nobody is asked per press, so the day approval, the card's own checks and Rowan's pre-mortem are the only safeguards on that call. Risk: a wrongly prepared card gets no last-moment permission prompt. Unknown: whether a rule can match only that one call, so it may be broader than intended."
    recommended: false
confidence: high
plan: record-run-unattended-test-pins-20261107-part-2
updated: 2026-11-09
---

# Decision 0200: Decide how a day approval under Decision 0173 reaches a Rowan that takes over during that day, so a handoff does not need you to retype the approval.

## Options

- **A. Let a Rowan taking over try one press on your pressed day approval** (recommended): This reads 0173 so that your day approval, once pressed on /actions, covers any Rowan taking over that day, not only the one running when you approved. Nothing new is built apart from a small reviewed note in the custody steps. A successor presses once without you retyping. If your computer refuses that press, Decision 0163 says the day's delegation ends: you approve a new day, and the successor does not retry or route around it. Cost: one small reviewed change. Risk: a refusal costs you the rest of that day. Your typed approval in a chat would no longer restart a day ended this way; you press a new one.
- **B. Keep retyping, and record that today's approval is in force**: Every Rowan taking over reads that today's approval exists, then asks you to type it in its own chat before pressing. No press is attempted without your words, so a refusal can't end the day. A handoff while you sleep stops the work until you wake, which is the wait you asked to remove.
- **C. Same as A, and you change your own permission settings for the press**: You change your own permission settings so the press call to START cards is allowed without asking. Only you can change that setting; no agent will touch it, and Rowan does not recommend this today. Effect: on an approved day nobody is asked per press, so the day approval, the card's own checks and Rowan's pre-mortem are the only safeguards on that call. Risk: a wrongly prepared card gets no last-moment permission prompt. Unknown: whether a rule can match only that one call, so it may be broader than intended.

## Rationale

A day approval pressed on /actions leaves a receipt that any Rowan's START card checks (scripts/start-run.sh). An approval typed in chat leaves nothing a script can check, and chat approval does not pass from one session to the next. Your day-grant-20261108a was pressed on /actions, so its receipt exists. What blocks a successor is your computer's permission check on the press itself. From Rowan's own sessions, not a checked-in record: on Nov 8 PST that check refused Rowan 2's first press and passed the same call once your words were in that chat, and at 10:44 PM PST on Nov 8 Rowan 3's press passed with your words in its chat, with no attempt made without them. That is thin evidence about what the check needs. Decisions 0163 and 0173 say a refused host permission ends the day's delegation. The code does not enforce that, and under it Rowan 2's refused press arguably ended that delegation before your typed words; this Decision also settles that reading. Rowan recommends A because it is the only way to learn whether a successor can press without new words, and because waiting for your words stops work until you wake in either case. Nothing here changes what a day allows; 0173's limits stay.

Proposed by Agent Ask decide-day-grant-readable-by-successor-20261109.
