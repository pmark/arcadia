---
arcadia: v1
type: decision
id: "0296"
slug: amend-decision-0288-rule-2-record-the-operator-s-answer-1a-2a-which-defines-a
project: arcadia
status: open
question: "Amend Decision 0288 rule 2: record the operator's answer \"1A 2A\", which defines a clean run by Nadia's C0-C5 intervention taxonomy (logged C1 or C2 agent help stays clean; the strict untouched count is always reported beside it) and counts Track 3 as the same shape as Track 2."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "A. 1A 2A: adopt the intervention taxonomy, and Track 3 counts as Track 2's shape"
options:
  - label: "A. 1A 2A: adopt the intervention taxonomy, and Track 3 counts as Track 2's shape"
    consequence: "A clean run allows logged C1 or C2 agent help and no operator touch after the press, with the strict untouched count reported beside it; recurring causes must be fixed by their third occurrence. Track 2 card B counts (C1, #3073), so Track 2 cards A, B and C make three clean runs of one shape, and Track 3 runs join the same tally (card A would be a fourth). Milestone 1's test may then pass; declaring it reached stays the operator's."
    recommended: true
  - label: "B. 1A 2B: adopt the intervention taxonomy, but Track 3 is a new shape"
    consequence: "Track 2 card B counts (C1, #3073), so Track 2 cards A, B and C make three clean runs of one shape; Track 3 starts its own count at 0 and tonight's run counts only toward it."
    recommended: false
  - label: "C. 1B 2A: keep the strict untouched rule; Track 3 counts as Track 2's shape"
    consequence: Any agent help makes a run not clean; Track 2 card B does not count, and Track 3 card A (one C1 so far) would not count either; the tally stays at two strict-clean runs.
    recommended: false
  - label: "D. 1B 2B: keep the strict untouched rule; Track 3 is a new shape"
    consequence: Any agent help makes a run not clean; Track 2's shape stays at two strict-clean runs and Track 3 starts its own count at 0.
    recommended: false
confidence: high
plan: track-3-standby-test-pins-20261125
updated: 2026-11-26
---

# Decision 0296: Amend Decision 0288 rule 2: record the operator's answer "1A 2A", which defines a clean run by Nadia's C0-C5 intervention taxonomy (logged C1 or C2 agent help stays clean; the strict untouched count is always reported beside it) and counts Track 3 as the same shape as Track 2.

## Options

- **A. 1A 2A: adopt the intervention taxonomy, and Track 3 counts as Track 2's shape** (recommended): A clean run allows logged C1 or C2 agent help and no operator touch after the press, with the strict untouched count reported beside it; recurring causes must be fixed by their third occurrence. Track 2 card B counts (C1, #3073), so Track 2 cards A, B and C make three clean runs of one shape, and Track 3 runs join the same tally (card A would be a fourth). Milestone 1's test may then pass; declaring it reached stays the operator's.
- **B. 1A 2B: adopt the intervention taxonomy, but Track 3 is a new shape**: Track 2 card B counts (C1, #3073), so Track 2 cards A, B and C make three clean runs of one shape; Track 3 starts its own count at 0 and tonight's run counts only toward it.
- **C. 1B 2A: keep the strict untouched rule; Track 3 counts as Track 2's shape**: Any agent help makes a run not clean; Track 2 card B does not count, and Track 3 card A (one C1 so far) would not count either; the tally stays at two strict-clean runs.
- **D. 1B 2B: keep the strict untouched rule; Track 3 is a new shape**: Any agent help makes a run not clean; Track 2's shape stays at two strict-clean runs and Track 3 starts its own count at 0.

## Rationale

Operator words, verified per Decision 0229 A by Rowan g8 and re-read read-only by Claudia Atlas (planner helper under Rowan g8) from Signal 20's session transcript e1a83b65-af47-4256-b2f1-b001ded2f2a7. Question: assistant message at file line 3168, 2026-11-26T03:38:27Z, uuid d8c6133a-714e-4e6e-aa8e-74cb53edce7f, headed "Two questions on your agent-help reframe.", offering "1. The rule - A (recommended): adopt it. A clean run means no touch from you after the press, with any agent help being only the logged mechanical kinds. Every report also shows the strict, nobody-touched count beside it, so nothing is hidden. Your words here start a governed change to the clean-run rule and the milestone wording. B: keep the strict 'nobody touched it' rule." and "2. Is Track 3 the same kind of run as Track 2? - A (recommended): yes. Same card path, test-only jobs, one at a time, so milestone 1 is likely ready to celebrate. B: no. Track 3 counts as a new kind and starts its own count at 0.", ending "Reply with two letters, e.g. \"1A 2A\", or \"1B\" to keep the strict rule." Answer: the operator's own human-origin user message at file line 3174, 2026-11-26T03:43:49.019Z (7:43 PM PST Wed 11-25), uuid bbfd3966-736f-4e3c-b48a-0c7361e15cb8, verbatim: "1A 2A". Recorded meaning (option A). 1A: Decision 0288 rule 2's "clean" now means: scope complete; zero operator touches after the press; no escalation that needs the operator; and every agent intervention is class C1 or C2, logged with its class, cause Issue and minutes. The strict untouched count is always reported beside the clean count. Classes: C0 worker self-recovery (clean); C1 mechanical retry on the same head where all tests passed or the failure was an infrastructure cancel, at most once per head (clean-as-assisted); C2 host repair with no repository or governed-record change (clean-as-assisted); C3 content or code repair (not clean); C4 mid-run governance, where a scheduled Off at scope complete is procedure and not C4 (not clean); C5 any operator touch after the press (not clean). Learning rule: a cause that recurs twice needs a source fix or an Issue with a revival trigger, and a third occurrence without a fix is not clean (today the CI timeout cause #3073 has recurred twice; its fix is the 15-minute limit in #3095). 2A: Track 3 has Track 2's shape (same card path, test-only pins, concurrency 1), so its runs count toward the same rule-2 tally, and Track 2 card B now counts retroactively as clean-as-assisted (C1, cause #3073). Unchanged: Decision 0288 rule 1; rule 2's definition of one shape (same press path, same kind of work, concurrency 1); the three-run threshold; exceptions only by the operator's word in chat; declaring any Milestone reached stays the operator's alone. Decision 0288 is not edited. Evidence: workspaces/checkpoint-inputs-20261125.md section 9 (Track 3 card A touch log); docs/milestones.md Milestones 1, 3, 9 and 10 change wording to match in the same candidate. This draft grants nothing and approves nothing; only the answer recorded through arcadia decision approve, and the operator's merge of its record PR, put it in force.

Proposed by Agent Ask rowan-g8-rule2-intervention-taxonomy-20261125.
