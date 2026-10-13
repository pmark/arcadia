# Protected broker role-registry packaging evidence — 2026-10-13

This report records a bounded implementation under approved Decision 0127 for
`recover-completed-governance-overlap-in-protected-go#package-protected-broker-role-registry`. It does not record Action completion.

Project: Arcadia. Milestone: Recover completed governance overlap in protected Go.
Responsibility: agent. Native role: implementer, depth 1, sole product-code writer.
Supervisor: the assigning Lead. Actual runtime: `gpt-6.1-sol/high`; no delegation.
Candidate: `/Users/pmark/.codex/worktrees/broker-role-registry-packaging/arcadia`.
Branch: `codex/broker-role-registry-packaging-20261013`.
Starting revision: `02f54757c9714845c130fa34475a70f729f13b96`.
The Lead preserved the product snapshot at `23d72cdea85eb6b17e68912a293b7b06ac4e62aa`; subsequent author changes are evidence-report only.
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
| `node_modules/.bin/vitest run tests/go-broker-release-packaging.test.ts` after stronger source-denial assertion | 0; ten tests passed | `native-packaging-source-denied-final.log` |
| `node_modules/.bin/eslint src/commands/goBrokerInstall.ts tests/go-broker-release-packaging.test.ts tests/go-broker-agent-setup.test.ts` | 0, including the final source-denial assertion | `native-packaging-lint-final.log` |
| `pnpm build` | 0, preliminary and final builds | `native-packaging-build.log`, `native-packaging-build-final.log` |
| `node scripts/fast-rehearsal.mjs` | 0; 19 test files, 72 passed and 1 expected-fail; 34 scenarios; report verified | `native-packaging-fast-rehearsal.log` |
| `node --import tsx /tmp/go-overlap-resume-20261013/collect-malformed-registry.ts` | 0; syntax and semantic cases return structured VALIDATION_ERROR | `native-packaging-malformed-receipts.log` |
| `git diff --check` | 0 | Tool receipt |

Paths in the last column without a directory prefix are under
`/tmp/go-overlap-resume-20261013/`.

The final fast-rehearsal report exists at
`/var/folders/cm/0dn1wl093f52lr7h5d7xpdn40000gn/T/arcadia-fast-rehearsal-report-eg7lKx/report.json`.
Its wall time was 6m26s and it records 49 errors, 47 expected and two labeled
unexpected. Both unexpected labels are the same deliberate `session-probe-wall`
fixture injection: `tests/fast-rehearsal/session-probe-wall.test.ts:31` writes an
EROFS probe failure, and lines 55–64 assert the resulting environment-wall
blocker. The scenario passes, but its expected-error matchers do not cover these
two lifecycle messages. This is a separate report-classification defect; the
packaging change touches no rehearsal code. Revival trigger: the next rehearsal
reporting maintenance or requirement for a zero-unexpected report. Existing [Issue #1322](https://github.com/pmark/arcadia/issues/1322)
tracks this exact matcher/report gap; no duplicate Issue or source fix was made.
No clean-error rehearsal result is claimed.

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

## Verified receipt excerpts

These summaries retain observed fields from the raw receipts, so the published
report can be reviewed without access to the author host's temporary directory.
The positive receipt is from the actual compiled fixed launcher and supervised
child; malformed receipts are from the production release validator.

```json
{
  "canonical_asset": {
    "sourceReadDenied": true,
    "launcherExit": 0,
    "receipt": {
      "ok": true,
      "command": "brief-broker.self-test",
      "data": { "readOnly": true }
    }
  },
  "missing_asset": {
    "launcherExit": 1,
    "stdoutEmpty": true,
    "stderrCode": "ERR_MODULE_NOT_FOUND",
    "requiredPath": "dist/config/defaults/agent-roles.json"
  },
  "malformed_syntax_and_semantics": {
    "ok": false,
    "command": "go-broker.release-validation",
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "The protected broker role registry is missing or malformed."
    }
  }
}
```

Additional verified prevention evidence: source-linked registry reuse refuses;
staging refuses direct-file, dangling-file and parent symlinks, leaves external
fixture bytes unchanged, and creates no file at the dangling target.

## Operator and end-user QA

The operator procedure is also the end-user procedure for this packaging change.
The remote review surface is the candidate PR on GitHub. At this report update
its URL is pending publication by the Lead; the PR handoff must include that
exact link. No updated installed broker or runtime demo is claimed.

1. Open the linked PR's **Files changed** tab and this committed report.
   Confirm the receipt excerpts show source read denied, canonical launcher
   success, missing-asset load refusal and malformed-registry validation refusal.
2. In **Files changed**, review `tests/go-broker-release-packaging.test.ts`.
   Confirm it builds the actual broker, uses the fixed launcher and production
   staging utilities, removes the disposable source, asserts checkout reads are
   denied, and covers missing, malformed, byte/default drift and linked paths.
3. Open the PR's **Checks** tab and the unit job running this test. Expect the
   source-denied positive and negative cases to pass, and all seven required
   CI jobs (`lint`, `unit-1`, `unit-2`, `unit-3`, `unit-4`, `dashboard`, `e2e`) to
   be green on the same final head. Review the independent exact-head review
   summary in the PR Conversation before the separate merge decision.

This procedure requires no operator terminal or access to the author host.
Installed verification awaits the separate reviewed installation gate. PPN
protected Go, old custody, packet-model and historical repair-budget gates
remain untested by this PR.

## Developer reproduction

From the candidate run
`node_modules/.bin/vitest run tests/go-broker-release-packaging.test.ts`; expect
all ten packaging tests to pass. The disposable launcher returns a read-only
self-test; source reads and invalid registry/staging cases refuse. The command
is developer reproduction, not an offsite operator requirement. Do not invoke
`go-broker install`, `ensure`, service restart or PPN dispatch for this fixture QA.

## Verified friction and prevention

1. **Canonical bytes versus emit:** TypeScript's emitted JSON is reserialized,
   so a compiled asset can contain the right data while differing from the
   checked-in bytes. Prevention is the implemented source-byte copy, canonical
   data validation and manifest fingerprint; the regression separately checks
   byte equality and actual compiled import closure.
2. **Linked staging destination:** copying first and validating afterward can
   overwrite a symlink's external target. Prevention is validating staged
   directories and any existing asset before copy. Direct, dangling and parent
   link fixtures prove the external bytes are preserved.

These are source fixes and test evidence for the Lead's Notes To Self update,
not a second lesson store or a new operator preference.

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
