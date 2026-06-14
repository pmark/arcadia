# Golden Request Suite Report

Current milestone: Golden Request Suite for deterministic Arcadia ask routing.
Next action: Add future dogfooding failures to `tests/goldenRequests.ts` before changing routing rules.
Work classification: code and regression tests.
Required artifacts: golden examples, deterministic parser updates, automated test evidence, this report.

## Golden Examples Added

Execution requests that must not route to Back Burner:

- `Implement Rebuster Pinterest publishing`
- `Add Pinterest support to Rebuster`
- `Build the Arcadia Discord review UX`
- `Prepare weekly Rebuster update`
- `Fix MIDI Opener loop desynchronization`
- `Create a new Rebuster experiment`
- `Write release notes for MIDI Opener 5.5`

Back Burner protection examples:

- `Pinterest might help Rebuster.`
- `Improve the Rebuster candidate review flow.`
- `Should Rebuster try Pinterest?`
- `Arcadia review noise is too high.`

Each example records input text, expected intake classification, expected resolved intent, expected project, expected routing outcome, and whether Back Burner capture is expected.

## Routing Improvements

- `CreateWork` parsing now supports `prepare`, `fix`, `create`, and `write` in addition to the existing work verbs.
- Project-first command bodies now resolve known project names inside the work phrase, such as `Fix MIDI Opener loop desynchronization`.
- Deterministically parsed execution intents classify as `ExecutionRequest` before generic bug-report wording is considered, so `Fix ...` requests enter review/approval instead of Back Burner.

## Verification

Automated verification:

```sh
pnpm vitest run tests/intake.test.ts tests/phase3.test.ts
pnpm test
```

Result: all focused tests passed, and the full suite passed with 9 test files and 158 tests.

## Remaining Known Failure Cases

No remaining known Golden Request failures after this pass. The suite is intentionally dogfooding-driven; add any future real-world intent miss to `tests/goldenRequests.ts` first, then update deterministic rules.
