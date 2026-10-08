# Clarify golden set

Hand-written cases for the two gates a clarified verdict must clear before it is
recorded: the deterministic lint (`src/clarify/lint.ts`) and the separate grader
(`.agents/skills/next-action-grader/SKILL.md`, `src/clarify/grader.ts`).

**This set is the contract a deterministic replacement grader must pass.** A
model grader is a stand-in for a process that will one day be a script. Any
replacement, whether a script, a smaller model or another prompt, is acceptable
only if it reproduces every `expected` below on these cases. Grader calibration
(adding or changing cases from operator corrections) is deferred until five
operator corrections disagree with the grader; until then this set only grows by
hand-written cases, never by model output.

## Layout

| Where | What | Gate that must reject it |
| --- | --- | --- |
| `pass-*.json` | A verb-led next action with a done-condition and sourced references. | None. Lint passes; the grader must grade pass. |
| `fail-*.json` | Form failures: missing done-condition, non-imperative opening, a path, Action id, Decision id or command absent from the source. | The lint. `expectedFindings` lists the codes. The grader is never called. |
| `grader-only/fail-*.json` | Lint-clean candidates that are still not actionable: vague verb, first step not startable, unobservable done-condition, invented person or number, restated done-condition. | The grader. It must grade fail, include every id in `failedCriteria`, and ask for exactly one item. `request` is an example, not a required string. |

## Case fields

- `nextAction`, `doneCondition`, `source` (title, rawInput, currentNextAction,
  expectedArtifact, priorQuestion, priorAnswer), and for grader cases `actor`.
- `expected`: `pass` or `fail`.
- `reason`: why, in one sentence.
- `expectedFindings`: lint codes (lint cases).
- `failedCriteria`, `request`: criterion ids from SKILL.md and one example
  single question (grader-only cases).

## What a replacement must satisfy

1. Every `pass-*` case: pass.
2. Every `fail-*` case, in either directory: fail. The `fail-*` lint cases are
   already rejected by the lint, so a replacement needs only the grader-only
   cases to be correct and must still not pass a lint case if it is ever run on
   one.
3. On a fail, return exactly one information request and never a list.
4. Never read the generator's confidence or justification.

Tests: `tests/clarifyLint.test.ts` runs the lint cases;
`tests/clarifyGrader.test.ts` checks the grader-only cases are lint-clean, drives
a stubbed grader through `clarify`, and keeps SKILL.md and the grader prompt in
step.
