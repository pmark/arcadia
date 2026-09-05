# Flight Deck corrections and production handoff proof

## Scope and boundary

This Candidate corrects the merged board projection and adds one operator-settled
draft-Plan activation to the existing Agent Ask writer. It starts no Session,
marks no Action done, and creates no production daemon. Activation preserves the
previous Plan's unfinished Actions as draft work and logs the transition.

The operator requested the next session build managed plan production. The
bootstrap Ask is [19](./19-managed-production-bootstrap-ask.yaml), followed by the
separate activation Ask [22](./22-activate-production-bootstrap-ask.yaml). The
completion transition remains a named prerequisite in
`advance-approved-production-work`; no unattended feeder may bypass it.

## Deterministic proof

- `pnpm vitest run apps/dashboard/lib/flight-deck.test.ts tests/dashboard-snapshot.test.ts tests/agent-ask-settlement.test.ts tests/agent-ask-contract.test.ts`
  covers database/document identity, project isolation, deduplication, status
  derivation, old active Runs, preview binding, dependency refusal, queue isolation,
  replay and Git-commit-failure recovery.
- `pnpm test` covers the complete regression suite. Provider/process behavior in
  fixtures is simulated, not live unattended production proof.
- `pnpm build` checks core and Discord TypeScript; `pnpm dashboard:build`
  compiles the dashboard and its Flight Deck route.
- Browser smoke at `http://127.0.0.1:3031/flight-deck` observed all five headings,
  111 rendered cards, explicit completed-Run and draft-Artifact labels, and no
  page errors. Counts are a snapshot, not a fixed acceptance threshold.

## Operator procedure

| Service / target | Reachability | Start or recovery command | Exact URL | Expected change |
| --- | --- | --- | --- | --- |
| Dashboard Candidate | Verified local-only; no LAN/phone claim | From this checkout: `pnpm dashboard:build`, then `pnpm --dir apps/dashboard exec next start -H 127.0.0.1 -p 3031` | http://127.0.0.1:3031/flight-deck | Honest state labels and stable Project/Plan relationships |
| Agent Ask activation | Local CLI; no HTTP surface | `pnpm arcadia agent-ask settle --help` | Not applicable; repository CLI | Explicit activation/Action/model/effort choices with exact-preview apply |

1. Open the Candidate URL. Verify Needs You, Ready to dispatch, Running, Proving,
   and Landed; find an Unattached lane and its “No derivable Plan” explanation.
2. Inspect evidence: a completed Run belongs in Proving, a drafted Artifact is
   not Landed, and the page explicitly distinguishes Artifact state from Action
   acceptance or merge.
3. Follow Now, Work Queue and Decisions links, then return and Refresh. Expected:
   working navigation and a bounded loading state, without state mutation.
4. Run the focused test command above. Expected: all fixtures pass without
   changing the real workspace or launching a coding agent.
5. After the explicitly approved canonical activation, run
   `pnpm arcadia next --project arcadia`. Expected: active Plan
   `bootstrap-managed-production-to-build-flight-deck`, Action
   `define-managed-production-policy`, with Astra/high guidance. Plan creation
   alone must leave the previous pointer unchanged. Do not apply settlement as
   an exploratory QA step against a real workspace.

End-user procedure: same as the operator procedure for the read-only board.
Canonical settlement remains an operator-authorized operation.

## Handoff acceptance

The handoff is not complete merely because this file exists or tests pass.
Require published code, canonical Plan creation and explicit activation, clean
published managed-document commits, and a successful read-only `arcadia next`
plus `arcadia go` preview. The next fresh session builds the first policy Action;
it does not resume the old board Action or imply the production engine exists.
