# Pinned Plan-amendment Operator actions

`arcadia-plan-amendment-v1` is the shared contract for an operator click that
amends one existing Plan Action. The implementation is
`src/operatorActions/planAmendment.ts`; `scripts/run-plan-amendment.mjs` bounds
its complete preview, apply, and publication invocation to four minutes.
Generated executable scripts only pass their descriptor and `run` or
`--describe` to that shared launcher. They contain no settlement flags, parsing,
fingerprints, or retry logic.

This is required by `AGENTS.md`, not an optional example. Prepare an exact
`planAmendment` descriptor and generate its five-line executable with
`planAmendmentLauncher(id)` from `src/operatorActions/libraryContract.ts`.
That pure function supplies the one accepted launcher shape. Run
`mise exec -- pnpm check:operator-scripts` before publishing; the CI lint job
checks **every** library pair with the same validator `/runs` uses before launch.
Extra executable commands, cross-wired descriptors, unsupported flags and
repeatable approvals are refused. The checker reads files only: no button,
workspace or settlement is executed.

Other Agent Ask operator scripts declare `agentAsk` with exactly `proposal`,
`intent`, and `targetRef`. Inactive draft-Plan creation uses `intent: plan` and
`targetRef: null`; an existing Plan target requires the shared runner instead.
The detached dashboard runner preserves its operator execution context. The
canonical settlement path checks the actual proposal before preview, apply or
receipt replay, so falsely declaring draft creation cannot authorize an
amendment. Only the shared runner's synchronous in-process scope satisfies
that fence; there is no CLI flag or environment value granting runner authority.
Ordinary manual/candidate settlement keeps its existing approval rules.

These are deterministic guards for the supported operator-action paths, not a
sandbox against malicious host code that deliberately strips context or rewrites
the checker. Such bypasses are forbidden by `AGENTS.md` and remain subject to
review. The runner still supports only its declared single-Action envelope;
unsupported amendments need a capability proposal instead of custom logic.

A descriptor's `planAmendment` pins the primary checkout, origin, branch,
reviewed ancestor, exact Ask bytes and proposal id, settlement request id, and
publication destination. Its envelope pins Project and Plan no-change fields,
the complete Action before and after, and an explicit list of preserved Action
fields. It contains no publication-time preview fingerprint. Version 1 refuses
extra settlement options: responsibility, activation, placement, and queue
revision flags cannot slip into the generated command.

On a click, the runner validates the checkout, source and workspace, previews
only the named proposal through the real Agent Ask settlement command, and
checks its fingerprint-bound structured document and queue effects. The only
allowed document effects are the pinned Action replacement, the canonical
Plan update date, and byte-identical archival of that Ask. All other Action
fields, Plan fields and body text, other Actions, and the queue remain unchanged.
The runner applies with exactly those settlement flags and that fresh
fingerprint. It rechecks source bytes, descriptor, Project, document before
images and queue under the canonical workspace write interlock before mutation.

A timestamped `runs/<timestamp-pid>/` folder preserves preview, canonical
settlement receipt, result, log and failure handoff. The atomic
`runs/receipts/<id>.json` is the dashboard projection, with a stable reason,
plain-language changed field and recovery step. `/runs` only launches the
executable and displays this receipt; it performs no settlement interpretation.
Old run folders and dashboard one-shot success state remain the audit trail.

A failed precondition changes no governance. A publication failure leaves the
canonical settlement commit local and reports `PUBLICATION_FAILED`. The same
request verifies its committed diff, archived Ask and current target, then
publishes that exact commit without another apply. It refuses unrelated local
commits or remote divergence. Dead process locks are reclaimable under a shared local SQLite write interlock,
with an ownership recheck before removal; live claims
refuse duplicate clicks. An invocation that dies before recording its result
gets a launcher failure receipt and preserves any existing canonical receipt.

Validate candidate descriptors before publishing their buttons:

```sh
mise exec -- pnpm exec vitest run tests/plan-amendment-runner.test.ts \
  apps/dashboard/app/api/operator-script/accept-close-ask-traceability-scope.test.ts \
  apps/dashboard/lib/operatorScriptReceipt.test.ts
```

These tests execute the generated action against a real temporary workspace
and local bare origin. They use the real preview/apply implementation and no
network, model, production Grant, or live operator amendment. CI includes them
in the normal unit shards. The migrated traceability action is inspected and
only described in tests; it is never executed against the live checkout.
