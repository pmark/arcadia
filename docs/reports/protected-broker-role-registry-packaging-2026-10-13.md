# Protected broker role-registry packaging evidence — 2026-10-13

This report records a bounded implementation under approved Decision 0127 for
`recover-completed-governance-overlap-in-protected-go#package-protected-broker-role-registry`. It does not record Action completion.

Project: Arcadia. Milestone: Recover completed governance overlap in protected Go.
Responsibility: agent. Native role: implementer, depth 1, sole product-code writer.
Supervisor: the assigning Lead. Actual runtime: `gpt-6.1-sol/high`; no delegation.
Candidate: `/Users/pmark/.codex/worktrees/broker-role-registry-packaging/arcadia`.
Branch: `codex/broker-role-registry-packaging-20261013`.
Starting revision: `02f54757c9714845c130fa34475a70f729f13b96`.
App-host custody operation: `6a9d4ff6-d466-46d0-94be-fce87cf94b8f`.
Implementation budget: one pass, no more than 45 minutes; cutoff 22:55 UTC.
The assignment grants no Arcadia Session, admission, claim, capacity slot or Go
reservation. The current `delegation-policy-records` Action is disjoint; neither
that Action, the active Plan, the queue nor production state was changed.

## Acceptance criteria, verbatim

1. The staged broker release includes the canonical role-registry JSON at dist/config/defaults/agent-roles.json, bound to the compiled import and identical canonical bytes; release validation refuses a missing or malformed required registry before ready publication rather than inventing default authority.
2. A deterministic disposable-release regression loads the actual broker entrypoint or literal fixed launcher after source-tree access is removed or hidden, proves structured success with the correctly staged asset, and reproduces the missing-asset refusal. It performs no real installation, service restart, policy change or live workspace mutation.
3. Focused release-staging/broker tests, internal review, independent exact-head review and all required CI checks pass. The PR preserves existing role/authority semantics and names separate installed verification, stale custody, packet-model and historical repair-budget gates; it claims no #1280 completion or successful PPN dispatch.

## Implementation and evidence

The installer copies the checked-in canonical `config/defaults/agent-roles.json`
to `dist/config/defaults/agent-roles.json`, the compiled registry module's static
import target. TypeScript reserializes JSON during emit, so copying emitted bytes
would fail equality with the checked-in asset. Staging preserves original bytes
and binds their SHA-256 fingerprint in the release manifest.

The existing role validator validates the required asset; role definitions,
authority semantics and workspace overrides are unchanged. Staging compares
validated data against the trusted bundled registry, including defaults.
Inside an installed release the bundle is the same required asset; byte reuse
is independently bound by the recorded manifest fingerprint, with no runtime
source-tree fallback. Missing, malformed, altered-byte or linked assets refuse
reuse and READY. Fresh staging validates the complete release before publication
and linking. Staging rejects existing file, dangling-file and parent symlinks
before copying, preserving external fixture bytes.

`tests/go-broker-release-packaging.test.ts` compiles the actual broker graph to a
disposable tree, uses the production staging utilities and fixed launcher writer,
copies release-local dependencies, and removes the build-source tree. The actual
fixed Codex brief launcher runs in its existing read-only self-test mode. Node
filesystem reads are confined to the release; a separate probe asserts that
reading the checkout's canonical asset is `ERR_ACCESS_DENIED`. The launcher and
its supervised child return structured `brief-broker.self-test` success with
`readOnly: true`. No native-addon permission is granted. Removing the asset
reproduces `ERR_MODULE_NOT_FOUND` and exit 1, with no success receipt. Syntax and
semantic malformed data, byte drift, defaults drift, linked assets and invalid
staging all have negative coverage. Existing status fixtures prove READY refuses
missing or malformed registry even when launchers would otherwise answer.

Raw baseline receipt: `/tmp/go-overlap-resume-20261013/missing-registry-baseline.json`.
Final success/refusal receipts:
`/tmp/go-overlap-resume-20261013/packaging-test-reports/canonical-success.json` and
`/tmp/go-overlap-resume-20261013/packaging-test-reports/missing-refusal.json`.
The baseline reproduces only the packaging defect. It does not establish a cause
for historical tmux failures.

## Commands and outcomes

All commands ran from the candidate. Host escalation was per command only; no
sandbox, credentials or permission configuration was widened.

| Command | Exit / outcome | Raw evidence |
| --- | --- | --- |
| `node node_modules/typescript/bin/tsc -p tsconfig.json` (sandboxed baseline) | 2; candidate-local `dist` writes refused with EPERM | Tool receipt; followed by host-permission compile |
| same baseline compile with ordinary host permission | 0 | `/tmp/go-overlap-resume-20261013/native-packaging-baseline-tsc.log` |
| `node --import tsx /tmp/go-overlap-resume-20261013/reproduce-missing-registry.ts` | Harness 0; literal installed-shaped launcher 1, `ERR_MODULE_NOT_FOUND` | `missing-registry-baseline.json` |
| `node_modules/.bin/vitest run tests/go-broker-release-packaging.test.ts tests/go-broker.test.ts tests/go-broker-ensure.test.ts tests/go-broker-agent-setup.test.ts` (sandboxed) | 1; candidate-local `.vite-temp` EPERM | `native-packaging-focused.log` |
| same focused run with host permission, first pass | 1; 75 passed, new fixture refused tsc-reserialized bytes | `native-packaging-focused-host.log` |
| same focused run, second pass | 1; 81 passed; drift test chose the already-canonical light default | `native-packaging-focused-host-r2.log` |
| same focused run, final product snapshot | 0; four files, 87 tests passed | `native-packaging-focused-host-r3.log` |
| `node_modules/.bin/vitest run tests/go-broker-release-packaging.test.ts` after stronger source-denial assertion | Pending | `native-packaging-source-denied-final.log` |
| `node_modules/.bin/eslint src/commands/goBrokerInstall.ts tests/go-broker-release-packaging.test.ts tests/go-broker-agent-setup.test.ts` | 0 before final source-denial assertion; final run pending | `native-packaging-lint-final.log` |
| `pnpm build` | Preliminary 0; final run pending | `native-packaging-build.log`, `native-packaging-build-final.log` |
| `node scripts/fast-rehearsal.mjs` | Pending; combined report must exist | `native-packaging-fast-rehearsal.log` |
| `git diff --check` | 0 | Tool receipt |

Paths in the last column without a directory prefix are under
`/tmp/go-overlap-resume-20261013/`.

## Review and remaining gates

Internal author review checked compiled-path binding, prepublication validation,
status/reuse refusals, canonical bytes, authority preservation and source escape.
The Lead's read-only review identified the runtime self-comparison distinction
and linked-staging write risk; both were corrected and tested. No unresolved
internal product-code finding is known. Independent generic exact-head review
and all seven CI jobs remain the Lead's follow-up after preservation. This
report is not their verdict or a completion claim.

Installation and installed verification remain separately authorized work. The
old custody gate, original #1280 governance-overlap repair, packet-model gate and
historical repair-budget gate remain separate. No successful PPN dispatch, PPN
mutation, old-custody takeover, repaired #1280, installation, service restart,
production activation or budget reset is claimed. START_HERE.md is unchanged
because the operator flow has not changed.

## Operator and end-user QA

The proof is local-only, offline and fixture-based; no web endpoint or installed
updated broker is available from this PR. The operator procedure is also the
end-user procedure for this packaging change:

1. From the candidate run `node_modules/.bin/vitest run tests/go-broker-release-packaging.test.ts`.
2. Expect all ten packaging tests to pass. The canonical case must return a
   structured read-only self-test; the source-read probe must refuse access.
3. Expect missing/malformed/altered registry and linked staging paths to refuse,
   with the external linked fixture bytes preserved.

Running a live fixed launcher against an updated installed broker requires the
separate reviewed installation and verification gate. Do not use `go-broker
install`, `ensure`, service restart or PPN dispatch as part of this QA procedure.

## Retrieved instructions

The full Decision and generated brief (including `data.text`) were read.
Current and assigned Actions were read from their exact Plan frontmatter.
Arcadia repository sections: Orientation, Semantics, Model Selection, Operator
Guide, PR QA Plan and Working-Copy Safety. Notes retrieval targeted broker,
registry, release, staging, Vitest, tsc, EPERM, lint, symlink and fast-rehearsal;
matching entries were read before implementation, repairs and hand-back.

| Loaded instruction path | UTF-8 file bytes |
| --- | --- |
| `AGENTS.md` | 9750 |
| `CONSTITUTION.md` | 3320 |
| `PROJECT.md` | 31542 |
| `.arcadia/AGENT_CONTEXT_POLICY.md` | 539 |
| `.arcadia/repo-context.md` | 703 |
| `.arcadia/context-policy.json` | 870 |
| `docs/agent-guidance/index.json` | 7623 |
| `.agents/skills/arcadia-role/SKILL.md` | 7277 |
| `.agents/skills/arcadia-guardrail/SKILL.md` | 5565 |
| `docs/decisions/0127-decide-whether-to-authorize-one-bounded-native-packaging-repair-exception-using.md` | 6073 |
| `docs/agent-guidance/continuation.md` | 6239 |
| `docs/agent-guidance/operator-directed-work.md` | 4494 |
| `docs/working-copy-safety.md` | 15818 |
| `docs/agent-guidance/pull-requests.md` | 17585 |
| `docs/agent-guidance/learning.md` | 1636 |
| `docs/agent-guidance/principles.md` | 13789 |
| `docs/agent-guidance/session-roles-and-briefs.md` | 5343 |
| `docs/agent-guidance/standard-harness.md` | 5569 |
| `docs/agent-guidance/rehearsal-freeze-window.md` | 4690 |
| `docs/agent-guidance/arcadia-repository.md` | 30174 |
| `docs/arcadia-semantics.md` | 14180 |
| `docs/notes-to-self.md` | 35751 |

The Lead owns session-ledger, governance settlement, commit identity resolution,
commits, branch publication, PR, independent exact-head review and CI follow-up.
