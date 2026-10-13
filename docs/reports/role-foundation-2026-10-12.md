# Role and supervisor foundation evidence — 2026-10-12

This is derived implementation evidence, not an Action settlement, supervisor
assignment, permission grant or release acceptance. No governed Action exists
for this operator-directed work. The active Plan, current Action and queue were
not changed. Parent session owns commit, independent review, PR and CI delivery.

## Request and boundary

Operator: “Establish the foundation now alongside current work. Please use a
subagent engineer.” Intake: https://github.com/pmark/arcadia/issues/1341.
Engineer candidate: `codex/role-foundation-20261012` in the host-prepared isolated
worktree, initially based on `a6157e2e65e0643f9e6b6e1fdfecf8d457d4b53d`.
Delivery branch: `codex/role-foundation-public-base-20261012`, based on public
`origin/main` at `d5b25bcb20319e2043f009beb021210dfd18d1db`. The uncommitted
foundation changes were preserved by switching to that fresh branch; unrelated
local governance settlements remain in their original history and are excluded
from this PR. Work monitor was run by the
parent before edits. The engineer did not edit the primary checkout, commit,
push, create a PR, change live config or launch other agents. Token usage and
budget consumption are unmeasured, not zero.

## Delivered foundation

- Checked-in seven-role registry and deterministic validator, implementing the
  approved taxonomy and lineage. Lead and implementer are development-eligible,
  but the brief explicitly grants neither ownership nor a second writer.
- Read-only `roles`, `roles show` and `role brief`, supporting JSON, resolved
  identity/model/effort, domain labels and contained exact Action reads with
  verbatim criteria. Workspace patches can change model/effort defaults only;
  authority amendments fail closed. Child delegation and independent review
  requests are separate eligibility fields; neither admits a Session.
- Canonical Lead charter in Action launch briefs, preserving launcher behavior
  and the applicable native-app Lead/Driver convention.
- Repo-discoverable shared role and assigned-supervisor skills, with conditional
  milestone acceptance-gap and checkpoint references. Existing installed
  release-manager files were read as source material and not modified.
- START_HERE and command guide cover runnable commands and unavailable operations.

## Instructions and evidence retrieved

Byte sizes are source file sizes, not an assertion that all bytes belong in a
single prompt. Targeted sections were used after initial mandatory context.

| Source | Bytes | Sections/purpose |
| --- | ---: | --- |
| CONSTITUTION.md | 3320 | Authority, Truth, Economy |
| PROJECT.md | 31539 | Current pointer; parent supplied shared orientation |
| .arcadia/AGENT_CONTEXT_POLICY.md | 539 | Discovery bounds |
| .arcadia/repo-context.md | 703 | Paths and safe commands |
| .arcadia/context-policy.json | 870 | Denied paths and bounded discovery |
| docs/agent-guidance/index.json | 7623 | Operation triggers |
| docs/agent-guidance/operator-directed-work.md | 4494 | Start, custody and delivery boundary |
| docs/agent-guidance/standard-harness.md | 5569 | Existing harness, one instruction workflow, evidence handoff |
| docs/agent-guidance/session-roles-and-briefs.md | 4195 | Sole writer and raw evidence hand-back |
| docs/agent-guidance/learning.md | 1636 | Notes retrieval and failed receipts |
| docs/working-copy-safety.md | 15818 | Isolation and preservation |
| docs/agent-guidance/arcadia-repository.md | 30174 | Orientation, semantics, model selection, operator guide, PR QA, working-copy safety |
| docs/arcadia-semantics.md | 14180 | Canonical vocabulary |
| skill-creator/SKILL.md (installed system skill) | 15311 | Frontmatter, progressive disclosure, validation |
| arcadia-release-manager/SKILL.md (installed skill) | 8735 | Milestone gap, recovery, authority, paused watch |
| arcadia-release-manager/references/checkpoint.md | 4208 | Derived evidence continuation contract |
| Decision 0100 exact role-taxonomy file | 3820 | Seven roles; supervisor relationship |
| Decision 0112 exact session-start-role file | 4899 | Lead development semantics |
| Decision 0113 exact supervisor-chain file | 4333 | Supervisor chain |
| Decision 0114 exact delegation file | 3883 | Lead depth one; independent review/QA |
| Decision 0121 exact event-supervisor file | 6592 | Amends 0113; signal/end pass and budget requirement |
| Governed roles draft Plan | 42958 | Lines 12–49 registry/brief specification; not activated or settled |

Read the active `decision-card-contract` Action to rule out overlap. Notes To
Self targeted matches covered worktree custody, bridge dependencies and focused
Vitest invocation. The exact Decision filenames were used because Decision
0100 has another unrelated file. The repository guardrail skill's focused
implementation and convergence guidance was also read before final hand-back.

## Verification receipts

Local temporary receipts preserve raw outputs under `/private/tmp/role-foundation-*`;
they contain validation output, not live private operational receipts.

1. `node scripts/bridge-worktree-deps.mjs`: exit 0; bridged four dependency trees
   through the supported script.
2. `pnpm exec vitest run tests/agent-roles.test.ts tests/action-brief.test.ts tests/activity-no-record-commands.test.ts tests/cli-invocation.test.ts`:
   exit 0, **4 files, 68 tests passed**; raw receipt
   `/private/tmp/role-foundation-tests-final.txt` reports 18.45 seconds. Tests
   exercise refusal classes, loader isolation, all attempt mappings, independent
   review requests, unchanged policy for arbitrary accepted labels, exact Action
   criteria and symlink containment. The CLI harness tracks SQLite opens and
   activity recording, proving the added commands perform neither.
3. After adding unsupported-operation/blank-ref checks, the role test file
   passed 21/21, exit 0 (`role-foundation-last-unit.txt`). Three supported-agent
   text snapshots were then pinned with `vitest ... --update`; the snapshot
   receipt is `/private/tmp/role-foundation-snapshots.txt`.
4. Touched-file ESLint and `pnpm exec tsc --noEmit -p tsconfig.json`: exit 0,
   empty diagnostics (`role-foundation-last-lint.txt`, `role-foundation-last-tsc.txt`).
5. `git diff --check`: exit 0. Existing Action-brief and invocation checks passed
   with the new role block/path option. No broad full-suite or production
   rehearsal was run for this bounded read-only foundation; PR CI remains a
   separate delivery gate.
6. Real CLI smoke: `node --import tsx src/cli.ts roles --json` and
   `node --import tsx src/cli.ts role brief --role researcher --agent codex --tier light --action every-operator-decision-in-a-production-run-is-a-pinned-decision-card-on-a#decision-card-contract --json`:
   exit 0; observed `arcadia-roles-v1`/`arcadia-role-brief-v1`, researcher remains
   read-only, criteria refer to the existing Action. Raw JSON receipts:
   `role-foundation-cli-roles.json`, `role-foundation-cli-brief.json`.
7. `node --import tsx src/cli.ts bug --json`: observed `USAGE_ERROR`,
   `commander.unknownCommand`, “unknown command 'bug'”. This confirms the skill
   must not advertise the proposed utility as live.

## Friction and remedies

- Ordinary branch creation was denied at Git's shared ref lock. The supported
  host escalation succeeded for this operator-authorized candidate; no bypass.
- Initial CLI import above the shebang failed TS18026. Corrected the placement;
  final typecheck is clean. Initial receipt: `role-foundation-tsc.txt`.
- Adversarial tests exposed a mutable registry alias: one caller's change could
  contaminate a later load. Loader now clones rows, and regression coverage proves
  isolation. Initial receipt: `role-foundation-tests.txt`.
- Existing CLI contract caught the new `--repo` missing invocation coercion.
  Reused `resolveInvocationPath`/`invocationRoot` and updated the option inventory.
- Required skill `quick_validate.py` could not import PyYAML in either system
  or bundled Python (`ModuleNotFoundError: No module named 'yaml'`). One bounded
  offline uv attempt confirmed PyYAML is absent from cache. No dependency was
  installed by the engineer and no pass was claimed then. The parent subsequently
  installed PyYAML 6.0.3 only in `/private/tmp/arcadia-role-skill-validation-deps`
  through ordinary host permission recovery and ran the exact required validator
  for both skills: exit 0, “Skill is valid!”. No repository or global Python
  dependency was changed.

## Foundation versus deferred behavior

**Implemented:** registry and validated read-only brief commands, shared role
protocol, assigned-supervisor procedure and optional milestone evidence workflow.
**Unavailable:** automatic event-triggered supervisor execution, assignment
persistence, token/cap enforcement, governed delegation admission and `arcadia bug`.
No scheduler, broker, database, model-call route or agent harness was added.

Revival triggers: integrate supervisor automation only through authorized governed
work with explicit event wiring, budget/cap and assignment contracts; deliver the
bug utility through its approved implementation path; retire release-manager only
after supervisor exception handling and milestone acceptance tracking demonstrate
coverage and preserve ownership, authority, evidence and stopped-watch state.
Skill invocation or a passing foundation test cannot fulfill those triggers.

## Parent verification before PR

The parent independently ran the four focused test files (68 passed, exit 0),
core `tsc --noEmit` (exit 0), and actual registry/specialist commands. The
researcher brief preserved `mutates: false` and `may_delegate: false` with the
label “database migration research”. Vitest first refused its temporary config
write under the sandbox; the same test command passed through normal host
escalation. The public-base switch requires a fresh focused verification before
delivery. Independent PR review and required GitHub CI are separate gates.

## Public-base portability repair

After the parent preserved this implementation on the public-base candidate
`codex/role-foundation-public-base-20261012` (`origin/main` at
`d5b25bcb20319e2043f009beb021210dfd18d1db`), verification exposed a test assumption:
the source-checkout Action's unpublished activation had supplied model pins.
The public Plan is a draft without them, so the valid brief has no escalation.
The actual-repository smoke now asserts only the verbatim Action contract; a
hermetic temporary draft Plan separately proves null escalation/default effort
without pins, and the heavy model plus explicit `high` effort when pinned.
No product code or acceptance boundary was weakened. An initial fixture used
invalid `token_impact: low`; the parser named the defect, and the fixture now
uses canonical `none`. Both failed receipts remain under `/private/tmp`.

The repaired role tests pass 22/22 (`role-foundation-public-base-role-repair.txt`),
touched-test lint and public-base core TypeScript exit 0. Shared skill wording
now distinguishes configured/installed `arcadia` for adopters from the shown
`node --import tsx src/cli.ts` source-checkout examples. Both exact system skill
validators again report “Skill is valid!” using the parent's temporary PyYAML
path. No installation/adoption change was made.

Final public-base four-file verification: **4 files, 69 tests passed**, exit 0;
35.02 seconds, raw output `/private/tmp/role-foundation-public-base-final.txt`.
The focused command is the same four-file command recorded above. Diff whitespace
check remains clean. Engineer is terminal after this bounded repair; delivery and
independent review remain parent-owned.

## Independent review and delivery

Round 1 independently reviewed `55f4a73ecb1ed7afac31fa2098a52b6ca971e658`
from a frozen archive: no blocking findings, 69 focused tests passed. Its three
forward scenarios preserved researcher permissions despite a production label,
refused to infer release or resume a paused timer from idle status, and kept
missing mandatory browser proof unproved despite merged PRs. The reviewer
found no new authority grant in this implementation.

One nonblocking finding was repaired: strict field validation now uses
`Object.hasOwn` and refuses extra own `constructor`, `toString` and `__proto__`
keys. JSON round-trip regression tests preserve otherwise valid rows and prove
each refusal. The repaired role suite passed 25 tests; touched-file lint, core
TypeScript and diff whitespace checks exited 0. A fresh round-2 reviewer was
started for the final delta; its pinned-head verdict and remote CI are delivery
gates recorded in PR #1342, not asserted here as passed in advance. The session
ledger counts the two initiated independent review rounds, with unmeasured
model/token/time fields left unknown or null. Its complete outcome denotes
implementation handoff to that PR, not governed Action or Milestone acceptance.

PR: https://github.com/pmark/arcadia/pull/1342. CodeRabbit is rate limited and
was not awaited. No external review comment or Discord lifecycle notification
was sent: host automatic approval review rejected those messaging operations.
The explicit approved ping Decision 0084 was checked before one retry, which
was also rejected because repository Decisions were not accepted as trusted
messaging authorization. No alternate messaging route was used.
