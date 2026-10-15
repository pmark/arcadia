---
id: scalar-amendment-orphaned-values
cost: unmeasured
fix: canonical scalar-preservation and malformed-result regression tests
status: repaired in candidate; operator merge pending
---

The canonical amendment writer replaced only a scalar header, leaving old continuation text behind. Criteria-only amendment unnecessarily rewrote unchanged instructions, and missing criteria insertion could split a scalar title. Existing #1031 owns this failure; #1213 also covers literal replacement tokens.

The pre-fix tests failed 29 cases. A separate synthetic title-scalar case reproduced the insertion failure. Whole-value replacement, skipped unchanged instructions, insertion before title and resulting-Plan validation now have positive/refusal/apply/retry regressions in `tests/agent-ask-settlement.test.ts`; literal split/dependency preservation is proved in `tests/agent-ask-split.test.ts`. Final focused suites pass 200 tests. The earlier CRLF expectation error was fixed in the test, preserving correct source behavior.

The additional dashboard diagnostic fails identically on clean base and candidate (#1395); no dashboard repair was added. Rehearsal's two asserted environment-wall messages remain misclassified by the existing matcher (#1322). These records are evidence and intake, not new authority or queue changes.
