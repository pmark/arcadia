---
name: next-action-grader
description: Grade one proposed next action and its done-condition against fixed criteria, as a judge separate from the generator that proposed it. Use when deciding whether a clarified next action is actionable; returns pass, or fail with exactly one information request.
---

# Next-action grader

A generator proposes a next action and a done-condition for a captured Action.
This grader is a different instruction and a different call, so the generator
never marks its own work. It grants no authority and writes nothing: it returns
a grade, and Arcadia's `clarify` command records the result.

## Inputs and independence

You receive the candidate (next action, done-condition, the actor who would do
it) and the source material the generator was shown (title, raw input, current
next action, expected artifact, the earlier question and the operator's answer).
You never receive the generator's confidence or its stated justification; do
not ask for them and do not infer them. Judge only what is written.

Independence is by prompt. `clarify` requests the grader on the `standard`
local text profile, a different profile id from the generator's `fast`. By
default both profiles resolve to the same local model alias, so the checked-in
claim is prompt independence only. A distinct model is used when the local
route configuration points the `standard` profile at a different alias.

## Criteria

The block between the markers is the single source of the grading criteria.
`src/clarify/grader.ts` carries the same text and a test fails when the
two differ, so edit both together.

<!-- grader-criteria:start -->
1. concrete-verb: The next action opens with one concrete imperative verb naming a single physical act, such as Add, Run, Write, Call or Open. Vague verbs such as think about, look into, handle, sort out, figure out or improve fail.
2. startable-first-step: The first physical step can be started by the named actor in under 15 minutes with what that actor already has. A step that first needs another person, an access grant, a decision or a missing input fails.
3. observable-done: The done-condition names an output, a file, a command result or a state that a third party could check. A feeling, an intention or a restatement of the next action fails.
4. no-invented-facts: The next action and done-condition rely on no file path, identifier, name, number, tool or fact that is absent from the source material.
5. one-missing-item: When any criterion above fails because information is missing, the request asks for exactly that one item as a single question. A list of questions, advice or a restated criterion fails.
<!-- grader-criteria:end -->

## Output

Return one JSON object:

- `grade`: `pass` only when every criterion holds; otherwise `fail`.
- `failedCriteria`: the ids of the criteria that failed, empty on a pass.
- `reason`: one sentence naming the evidence for the grade.
- `request`: on a fail, the single question that asks for exactly the one missing
  item; omit it on a pass.
- `gapType`: on a fail, one of `missing-decision`, `missing-external-input`,
  `missing-definition`, `missing-success-criteria`.

Never invent facts to rescue a candidate, and never refer to the operator by a
personal name; say "the operator".

## What clarify does with the grade

- `pass` records the item `clarified`.
- `fail` records `question_open` and opens one clarification Decision whose
  question is `request`, so the question appears in `arcadia todo`.
- Grader unreachable or unusable leaves the item exactly as it was and reports
  it as skipped. Grading never escalates to a paid model.
- Each grade is stored as a receipt on a `clarify.grader.verdict` event with the
  grader identity (resolved route), the prompt sha256, the input sha256 and the
  verdict.

## Contract for a deterministic replacement

`tests/fixtures/clarify-golden/` is the contract any future deterministic grader
must pass. See its README.

## Related

- `src/clarify/lint.ts`: the deterministic pre-check that runs before this grader.
- `src/clarify/grader.ts`: builds the request, normalizes the grade, writes the receipt fields.
