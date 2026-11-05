---
arcadia: v1
type: decision
id: "0176"
slug: decide-whether-reviewed-changes-that-only-tighten-a-prompt-plan-text-or-bound
project: arcadia
status: approved
question: Decide whether reviewed changes that only tighten a prompt, plan text or bound may merge without the operator's word, or whether the word stays and only the wait is reduced.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. Keep the word, remove the wait
options:
  - label: A. Keep the word, remove the wait
    consequence: "The operator still decides which gated pull requests merge, by either of two routes. (1) *One tap.* Once a pull request has passed independent review of its current head and its required checks are green, Rowan prepares the existing batch-merge card (#1284), pinned to that head, and pings Discord with the exact title and Tailnet link. One press merges the listed pull requests at those heads, and a new push voids the entry. **This needs code first.** The card reads GitHub reviews, so #2090, reviewed independently, reads `review_missing`; it also shows #2090 as \"no authority boundary\". The operator merges that fix, and the route needs one proving use. (2) *Named in advance.* The operator may name pull requests by number in chat, valid for 24 hours. Rowan merges each once the Decisions 0060 and 0080 conditions hold on its final head, and quotes the instruction on the pull request. The reviewer must also say whether that head loosens any gate; a yes or an unclear answer returns it to the operator. A push outside the named head's paths voids the name. Never during a run window. Naming in advance never covers a pull request the Constitution keeps with the operator, one that opens or carries an important Decision or changes what agents are authorized to do; those need the word on their final head. *Authority moves in two ways.* Naming lets Rowan merge blast-marked pull requests that Decision 0173 bars. And keeping these merges with the operator tightens `docs/agent-guidance/pull-requests.md`, which today allows \"merge by hand, or leave for the operator\" for these paths. No path list changes. *Consequences.* It needs a procedure edit, which the operator merges. A tap does nothing while the operator is away, unless the pull request was named first. With a name, the operator has not seen the final head, so a reviewer's miss lands with no human look until later."
    recommended: true
  - label: "B. Narrow the lists by path: test files and settlement records"
    consequence: "Test files and settlement records under gated paths stop counting as gated, unless the pull request opens or carries a Decision. A deterministic check can tell these from source files. It frees real time: #2036 and #2089 were gated by settlement records only (#2036 also carried a test), 66 of the 160 critical-path minutes. A weakened test helper can still weaken a proof, so shared helpers stay gated. A wrong settlement record can misstate an Action's state, so review and the settlement validator become that record's only checks."
    recommended: false
  - label: C. Replay-gated prompt class, later
    consequence: A named list of prompt and plan-text files becomes a class that Rowan may merge when every changed path is on that list or is a test, independent review has no blocking finding, checks are green, the merge is clean, and real-reviewer replay on that exact head still fails every captured must-fail case and passes every must-pass case. That replay measures behaviour, which a path classifier cannot. Answering this rules that such a change does not by itself change what agents are authorized to do; if the operator reads the Constitution otherwise, it needs an amendment. It lifts Decision 0173's bar for that class and adds a gate to reviewer prompts in `src/qa/`, which have none today. It grants nothing until replay exists, its variance is measured and published, and the operator has merged the implementing pull request, so it probably does not help before attempt 3. The corpus only catches weakening it has seen; a new kind passes.
    recommended: false
  - label: D. Reviewer judges "only tightens"
    consequence: "Rowan may merge a gated pull request when independent review says it only tightens. This lifts Decision 0173's bar. It is the fastest option and the one the question first asks about. It hands the gate to a judgement that has failed in draft: #2091's first head was written as a tightening and told QA that checks had run which had not. Review caught that one, but a miss looks exactly like a pass, and on a reviewer prompt the reviewer is judging its own instructions. A weakened gate landing before attempt 3 could spoil the last attempt or produce a false clean. It also needs the operator's ruling on the Constitution's wording. Not recommended."
    recommended: false
  - label: E. Nothing changes
    consequence: The operator's word and the current wait stay as they are.
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-11-05
answer: A. Keep the word, remove the wait
decided: 2026-11-05
---

# Decision 0176: Decide whether reviewed changes that only tighten a prompt, plan text or bound may merge without the operator's word, or whether the word stays and only the wait is reduced.

## Options

- **A. Keep the word, remove the wait** (recommended): The operator still decides which gated pull requests merge, by either of two routes. (1) *One tap.* Once a pull request has passed independent review of its current head and its required checks are green, Rowan prepares the existing batch-merge card (#1284), pinned to that head, and pings Discord with the exact title and Tailnet link. One press merges the listed pull requests at those heads, and a new push voids the entry. **This needs code first.** The card reads GitHub reviews, so #2090, reviewed independently, reads `review_missing`; it also shows #2090 as "no authority boundary". The operator merges that fix, and the route needs one proving use. (2) *Named in advance.* The operator may name pull requests by number in chat, valid for 24 hours. Rowan merges each once the Decisions 0060 and 0080 conditions hold on its final head, and quotes the instruction on the pull request. The reviewer must also say whether that head loosens any gate; a yes or an unclear answer returns it to the operator. A push outside the named head's paths voids the name. Never during a run window. Naming in advance never covers a pull request the Constitution keeps with the operator, one that opens or carries an important Decision or changes what agents are authorized to do; those need the word on their final head. *Authority moves in two ways.* Naming lets Rowan merge blast-marked pull requests that Decision 0173 bars. And keeping these merges with the operator tightens `docs/agent-guidance/pull-requests.md`, which today allows "merge by hand, or leave for the operator" for these paths. No path list changes. *Consequences.* It needs a procedure edit, which the operator merges. A tap does nothing while the operator is away, unless the pull request was named first. With a name, the operator has not seen the final head, so a reviewer's miss lands with no human look until later.
- **B. Narrow the lists by path: test files and settlement records**: Test files and settlement records under gated paths stop counting as gated, unless the pull request opens or carries a Decision. A deterministic check can tell these from source files. It frees real time: #2036 and #2089 were gated by settlement records only (#2036 also carried a test), 66 of the 160 critical-path minutes. A weakened test helper can still weaken a proof, so shared helpers stay gated. A wrong settlement record can misstate an Action's state, so review and the settlement validator become that record's only checks.
- **C. Replay-gated prompt class, later**: A named list of prompt and plan-text files becomes a class that Rowan may merge when every changed path is on that list or is a test, independent review has no blocking finding, checks are green, the merge is clean, and real-reviewer replay on that exact head still fails every captured must-fail case and passes every must-pass case. That replay measures behaviour, which a path classifier cannot. Answering this rules that such a change does not by itself change what agents are authorized to do; if the operator reads the Constitution otherwise, it needs an amendment. It lifts Decision 0173's bar for that class and adds a gate to reviewer prompts in `src/qa/`, which have none today. It grants nothing until replay exists, its variance is measured and published, and the operator has merged the implementing pull request, so it probably does not help before attempt 3. The corpus only catches weakening it has seen; a new kind passes.
- **D. Reviewer judges "only tightens"**: Rowan may merge a gated pull request when independent review says it only tightens. This lifts Decision 0173's bar. It is the fastest option and the one the question first asks about. It hands the gate to a judgement that has failed in draft: #2091's first head was written as a tightening and told QA that checks had run which had not. Review caught that one, but a miss looks exactly like a pass, and on a reviewer prompt the reviewer is judging its own instructions. A weakened gate landing before attempt 3 could spoil the last attempt or produce a false clean. It also needs the operator's ruling on the Constitution's wording. Not recommended.
- **E. Nothing changes**: The operator's word and the current wait stay as they are.

## Rationale

What no option can do. The Constitution keeps with the operator any pull request that "opens or carries an important Decision or changes what agents are authorized to do". No option here moves that; doing so needs a Constitution amendment. No option changes the worker's own merge allowlist (`isWorkerMergeSafePath`), which stays tests and ordinary docs.

**The record, 2026-11-04 00:00 to 2026-11-05 05:20 UTC (29h 20m), last required check finished to merged:**

| Group | Pull requests | Total | Note |
|---|---|---|---|
| Opens or carries a Decision | 5 | 104 min | Cannot be split under any option |
| Gated paths, no Decision | 12 | 648 min | #2082 alone is 329, of which 150 is attempt 2's window; the other eleven have a median of 16.8 min |
| Not on the gated list | 6 | 451 min | #2060 alone is 296, waiting on a run hold, not on this gate |

Of the gated minutes, the critical-path ones (my judgement: #2036, #2071, #2072, #2074, #2076, #2089) total 160 minutes, about 9% of the window. All of these are upper bounds: the span includes independent review, and every merge shows `pmark`, so the record cannot separate the operator's merges from Rowan's.

**The 72% figure is a different wait.** Mira's 6h 14m of 8h 36m on 2026-11-04 was a host-only remedy for a held run. Decision 0173 addressed it, and it is not this gate. The gated lists cost hours a day at most and rarely on the critical path, which does not justify handing the judgement to a reviewer with one attempt left.

**Who decides "only tightens".** A path or a diff cannot say what a prompt means. There are three real answers: the operator, a behavioural replay, or a reviewer. Option A keeps the first, option C builds the second, and option D is the third.

**Three lists gate today, not one:** the Constitution's exclusion; `classifyAuthorityPaths` (`src/decisions/batchMerge.ts:204`), which the procedure uses; and the blast-radius patterns (`src/stewardship/prBlastRadius.ts:15`), which Decision 0173 and the worker use. #2090 is gated only by the third, and #2091 by the second and third.

**Separate finding, not part of this Decision.** Neither list includes `src/qa/`, so reviewer-prompt changes such as #2047 and #2060 already fall under the standing gate with no operator word, while plan text in `src/sessions/` needs it. That split follows directories, not risk, and it runs backwards. It should be filed as its own Issue.

**Revival trigger for option C or a wider split:** the critical-path wait for an operator tap has a median above 30 minutes across a working day, measured after one-tap merge is in use, or replay ships with measured variance.

Proposed by Agent Ask decide-merge-gate-split-20261105-r2.
