---
arcadia: v1
type: decision
id: "0298"
slug: clarify-decision-0297-s-any-touch-from-you-after-the-press-record-the-operator
project: arcadia
status: approved
question: "Clarify Decision 0297's \"any touch from you after the press\": record the operator's answer \"2A\", under which his answers about other work while a run is going do not count as touches on that run."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "A. 2A: no, answers about other work during a run are not touches on it"
options:
  - label: "A. 2A: no, answers about other work during a run are not touches on it"
    consequence: "A touch means acting on that run itself: its jobs, its PRs, or switching production. Answers about other work while it runs don't count. Track 3 card A stays clean with one mechanical agent re-run, so 4 qualifying runs. The strict count is unchanged."
    recommended: true
  - label: "B. 2B: yes, any answer from the operator during a run counts"
    consequence: Any answer from the operator during a run counts. Track 3 card A isn't clean, so 3 qualifying runs; milestone 1 is still met. He would then need to stay silent during future runs. The strict count is unchanged.
    recommended: false
confidence: high
plan: track-3-standby-test-pins-20261125
updated: 2026-11-25
answer: "A. 2A: no, answers about other work during a run are not touches on it"
decided: 2026-11-25
---

# Decision 0298: Clarify Decision 0297's "any touch from you after the press": record the operator's answer "2A", under which his answers about other work while a run is going do not count as touches on that run.

## Options

- **A. 2A: no, answers about other work during a run are not touches on it** (recommended): A touch means acting on that run itself: its jobs, its PRs, or switching production. Answers about other work while it runs don't count. Track 3 card A stays clean with one mechanical agent re-run, so 4 qualifying runs. The strict count is unchanged.
- **B. 2B: yes, any answer from the operator during a run counts**: Any answer from the operator during a run counts. Track 3 card A isn't clean, so 3 qualifying runs; milestone 1 is still met. He would then need to stay silent during future runs. The strict count is unchanged.

## Rationale

Operator words, verified per Decision 0229 A by Rowan g9 (read-only) from Signal 20's session transcript e1a83b65-af47-4256-b2f1-b001ded2f2a7. QUESTION, the only source of this record's terms: the assistant message at file line 3476, 2026-11-26T04:22:02.927Z, uuid 873c0237-c038-48fd-9515-95b4548c1d09, question 2, verbatim with Markdown emphasis removed and list items joined by ' / ': '2. Do your answers about other work count as touches on a run? While tonight's run was going, you approved the job 4 wording, answered "1A 2A" and okayed merging #3095. None of those acted on tonight's 3 jobs. Your rule says "any touch from you after the press" isn't clean. / A (recommended): no. A touch means acting on that run itself: its jobs, its PRs, or switching production. Answers about other work while it runs don't count. Tonight stays clean with one mechanical agent re-run, so 4 qualifying runs. / B: yes. Any answer from you during a run counts. Tonight isn't clean, so 3 qualifying runs; milestone 1 is still met. You'd then need to stay silent during future runs. The strict count, where nobody touched anything, is unchanged either way.' RESTATED at file line 3587, 2026-11-26T04:28:25.848Z, uuid 4e397401-5c55-4a2e-b03d-9c412954db0d: '2. Do your answers about other work during a run count as run touches? A means no, B means yes.' ANSWER: the operator's own human-origin user message at file line 3593, 2026-11-26T04:28:43.055Z (8:28 PM PST Wed 11-25), uuid 818c614b-cc32-4393-8083-95178a2d4f64, verbatim: "1A 2A". Its "1A" answered question 1 (merge #3100, done as 282a27586, renumbered to Decision 0297 by #3106); its "2A" answers question 2. RECORDED MEANING (option A), only in line 3476's words: "A touch means acting on that run itself: its jobs, its PRs, or switching production. Answers about other work while it runs don't count." The strict count, where nobody touched anything, is unchanged. UNCHANGED: every other term of Decisions 0288 and 0297; declaring any Milestone reached stays the operator's alone. Decision 0297 is not edited. NOT ADOPTED: this record adds no term line 3476 did not show. It does not say what counts as "other work" beyond his example (the job 4 wording, "1A 2A", the #3095 merge), and it does not change how an agent's governance step mid-run (such as a mid-run settlement) counts. Any wider term needs a separate question. This draft grants nothing and approves nothing. Only the answer recorded through arcadia decision approve, and the operator's merge of its record PR, put it in force.

Proposed by Agent Ask rowan-g9-0297-c5-other-work-answers-20261125.
