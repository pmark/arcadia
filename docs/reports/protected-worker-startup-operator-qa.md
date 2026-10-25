# Protected compiled-worker startup — source-only QA

Operator instruction: “Approve merging PR1737. Keep production Off and continue making progress on the critical path.” Issue1740 records this source-only prerequisite; no governed Action is claimed. The active unified enrollment Action and its owner remain separate.

This candidate prepares the existing startup/package contract for a later reviewed adoption. No runtime is installed or started and no credential operation, production admission or START is approved. There is no live demonstration target for this source preparation. The operator procedure is also the end-user procedure.

1. Review the focused fake launch/package tests and independent current-head report linked from the PR. The existing source launch remains the default; a valid registered compiled release selects its exact manifest runtime and compiled CLI with the correct release root.
2. Check negative fixtures: altered/unregistered manifest or runtime, missing package defaults and ambiguous/conflicting worker custody must refuse before a fake install/launch effect. No test may invoke live launchctl, worker services, provider credentials or a real host installation.
3. Confirm focused tests, lint, TypeScript and required exact-head CI pass. These are source proofs only; a future adopted process must still prove actual loaded binding, ownership and fresh preservation/Go routes.
4. Keep production Off and preserve heldPR1662/attempt/recovery gates. Runtime adoption requires a separately reviewed bounded remote operator action and explicit approval; live Claude usage and START require their own authority. Do not use the consumed recovery card or ask the operator to run terminal commands.

The agent records the following verification commands in the PR; operator review uses GitHub’s Files changed and Checks surfaces and requires no host terminal:

```sh
pnpm exec vitest run tests/protected-worker-startup.test.ts tests/go-broker-release-packaging.test.ts tests/worker-claude-usage-diagnostic.test.ts
pnpm exec tsc --noEmit -p tsconfig.json
pnpm lint
```

Final results and independent review are recorded in the PR before handoff. Future adoption must pin the actual merge of this source correction, not the earlier PR1737 base; no executable adoption card is supplied by this preparation.
