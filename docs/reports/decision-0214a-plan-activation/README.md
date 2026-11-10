# Decision 0214 A Plan activation preparation

These are review snapshots of a shared-runner `arcadia-plan-activation-v1` action, not another runner. After review and merge, the live ignored library (`artifacts/generated/operator-scripts/`) receives these exact bytes. Generating, describing or publishing them activates nothing; the press is the operator's.

- **Operator words (record, Rowan 5's chat):** "Yes, activate it" (`opint_b88e0e2323fa40eb91`) for the inactive Plan merged by #2453.
- **Contract:** #2455 (Issue #2454) lets activation follow a finished previous Plan. `record-run-unattended-test-pins-20261107-part-2` is `complete` and stays `complete`.
- **The press:** selects `implement-a-classifier-coverage-audit` at standard / medium and places the queue segment (`implement-a-classifier-coverage-audit`, then `implement-decision-0214-a-in-src`) at the top. It appends one Mission Log entry, archives the Ask and pushes the canonical settlement commit.
- **What it never does:** start a Session, Run or production policy; raise concurrency; grant spend, credentials or merge authority. Each Action's PR stays the operator's merge.
- **Validation:**
  - The descriptor was generated from the live before-images at `afd3e85e2` and passes `validateOperatorScriptContract` with the canonical `planAmendmentLauncher` script.
  - The Ask normalizes as `intent: plan`, targets this Plan, and carries no Actions or Plan metadata.
- **Production:** observed Inactive · Idle, revision 123, epoch 66. This is no future grant.
