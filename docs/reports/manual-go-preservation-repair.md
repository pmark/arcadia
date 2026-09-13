# Manual Go preservation repair candidate

## Bootstrap update, 2026-09-13

The operator ran the host bootstrap: 136 focused tests passed, build and the
disposable host probe passed, and commit `b91fe660ce98bffb5ba3fe5ab9cc7040059c810b`
was installed. It remains local only. The original governed Action is unfinished.
The earlier candidate-state statements below describe the pre-bootstrap attempt.

Worker activation then stopped before configuration or service changes. Its
real preservation check failed because the dependency installer used Node's
default symlink-copy behavior: release-local TypeScript and Vitest links became
absolute references into the original checkout. Seatbelt correctly refused
that access. The current correction preserves relative links with
`verbatimSymlinks: true`. The regression test removes the original dependencies
and renames the staged release before reading through the installed link; it
fails before the correction and passes afterward. All 34 broker/setup tests
pass. This correction still requires host installation and activation; no
end-to-end live success is claimed.

## Problem and scope

On 2026-09-13, the fixed Go broker prepared a clean worktree for
`bootstrap-managed-production-to-build-flight-deck/isolate-agent-asks-from-production-handoff`.
It correctly returned `session: null` for its manual handoff. The skill then
required protected preservation, whose transport and command accepted only
managed Sessions. Treating that mismatch as a missing planning approval sent
the operator into a workflow that could not register this worktree.

This is a repair candidate, not an installed fix or a completed governed Action.
The operator explicitly prioritized repairing the defect that blocks continued
work. Repair preceded a governance record under the Stop the line rule because
the defect blocks the preservation path needed to deliver the repair itself.
The original Ask-isolation Action remains unfinished and its pointer is unchanged.

## Candidate behavior

- The host can bind an active manual worktree reservation to the current
  dispatchable Action, exact branch/base, and host-configured objective checks.
- The worker advertises manual handoffs separately from managed Sessions and
  consumes their requests through the same protected preservation command.
- The existing immutable capture and Seatbelt validation run before a local
  commit. Manual preservation grants no production activation or remote write.
- Bindings and commits replay by reservation identity. Changed authority,
  checks, branch/base, or reservation expiry refuse rather than rebind silently.
- Go and Advance report preservation readiness. A null Session never asks for
  a planning packet as the remedy. Missing checks are named configuration.
- `production status` uses a read-only database connection and works while
  another connection owns the write lock.

## Evidence

- Core and Discord build passed; TypeScript check and whitespace validation passed.
- Focused suite: 129 passed, 6 host-only cases skipped. The subsequently added
  deterministic local-commit/replay wiring test also passed (manual file:
  9 passed, 1 host-only case skipped). Its validator is mocked explicitly;
  it is not evidence of native sandbox execution.
- Full suite: 1,437 passed, 73 failed, 12 skipped, with 53 unhandled errors.
  Many failures explicitly report EPERM for local HTTP/IPC, private workspace
  writes, or host application support paths. The provider availability file
  failed in the full run but passed all 6 tests when rerun alone. The full suite
  is not green; no claim is made that every failure is a proven baseline failure.
- Attempted native host suite: 13 passed, 4 failed. A diagnostic fixture
  captured exit 71 and `sandbox-exec: sandbox_apply: Operation not permitted`.
  Native preservation has not been proved from this task environment, including
  after its escalation request. The restriction was not weakened or bypassed.

## Operator QA procedure

| Target | Reachability | Start/recovery | Exact URL | Expected change |
| --- | --- | --- | --- | --- |
| Disposable CLI fixtures in this candidate | Local Mac only | `pnpm bridge:worktree` if dependencies are absent | Not applicable: CLI, no HTTP route | A manual handoff can preserve locally without a Session/packet/production grant |
| Installed Go worker/broker | Old runtime remains in place | Install the reviewed committed candidate with `pnpm arcadia go-broker install`, then restart the updated host worker | Not applicable: fixed local launchers | Manual reservations appear in the host heartbeat and preservation readiness is explicit |

1. From the candidate worktree, run:
   `pnpm exec vitest run tests/manual-preservation.test.ts tests/go.test.ts tests/go-broker.test.ts tests/go-broker-agent-setup.test.ts tests/go-request-transport.test.ts tests/preservation-validation.test.ts tests/candidate-preservation.test.ts tests/managed-production-policy.test.ts tests/advance-queue.test.ts`.
   Expected: all ordinary tests pass; native-host tests are explicitly skipped.
2. From an unsandboxed Mac host terminal, run:
   `ARCADIA_PRESERVATION_HOST_TEST=1 pnpm exec vitest run tests/manual-preservation.test.ts tests/preservation-validation.test.ts`.
   Expected: native fixtures pass, including one local commit, identical tested
   and committed trees, replay, and refusal after candidate mutation. Do not
   install on a failing native result.
3. Review and preserve this exact candidate before installing it. The installed
   old controller cannot preserve the repair's manual reservation. A one-time
   operator-authorized host bootstrap is required; do not make shared Git
   writable in the agent sandbox or substitute agent assertions for validation.
4. Install the committed candidate and restart a worker using the updated
   runtime. Merely changing a launcher does not update an already running worker.
   The worker command from the updated runtime is
   `pnpm arcadia worker start --workspace /Users/pmark/Dev/MR/Arcadia/workspaces/martianrover`.
5. Configure actual objective validation commands for Arcadia through
   `arcadia project metadata <project-id> --validation-command <command>`.
   Its current value is `[]`. Commands must work in the existing read-only
   snapshot validator. The disposable fixture's `node check.mjs` is not an
   Arcadia validation command and must not be copied into live configuration.
6. Run the fixed Go launcher from a disposable registered Project with configured
   checks. Expected: `session: null`, `preservation.kind: manual_handoff`, and
   `preservation.ready: true`. After changing its fixture marker, run the fixed
   preservation launcher. Expected: one LOCAL ONLY commit, `authorityKind:
   manual_handoff`, no production activation or remote action. Retry and compare
   the commit identity.

## End-user procedure

The end user says `arcadia go` from the phone-connected task. For an already
configured manual handoff, the agent implements and requests preservation without
asking the user to prepare a packet. Actual judgment and publication boundaries
remain explicit. No local file link or transient picker is required to relay
routine setup instructions to the user.

## Final preservation attempt

The service-status script reports the worker running. The broad test suite left
an ignored `.arcadia-workspace` directory in this candidate, which shadowed the
real workspace and initially produced an unavailable-heartbeat refusal. A
reversible move of that test-created directory was denied with `Operation not
permitted`; it was retained. Targeting the previously resolved registered
workspace explicitly gave the definitive installed-broker refusal:
`No prepared or running Session registers this preservation worktree.`

The failed test workspace is at
`/Users/pmark/.codex/worktrees/isolate-agent-asks-from-production-handoff-20260913T023034869Z/arcadia/.arcadia-workspace`.
It is ignored and excluded from the candidate patch. Host cleanup should move it
to the recovery directory first; do not delete an uninspected workspace.

## Remaining host boundary and draft Log ask

This task cannot install its own privileged controller through the broken old
preservation path. The candidate remains uncommitted in the isolated worktree;
no source changes were made on main and no governed state was hand-edited.

Draft Agent Ask (not previewed, settled, or represented as a canonical Log):

```yaml
agent_ask: v1
request_id: record-manual-go-preservation-repair-20260913
project: arcadia
intent: log
desired_result: >-
  Record that the manual Go handoff was incompatible with managed-only protected
  preservation, that the operator prioritized its repair, and that a local
  repair candidate and regression evidence were prepared. Repair preceded the
  record because this defect blocks its own preservation. The candidate is
  not installed or accepted; native host validation, host preservation and
  Arcadia objective-check configuration remain outstanding. The original
  Ask-isolation Action and Project pointer remain unchanged.
references:
  - docs/reports/manual-go-preservation-repair.md
```
