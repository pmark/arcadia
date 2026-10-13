# Lead canonical role discovery and native dispatch evidence — 2026-10-12

Direct operator request: “Please close those gaps now so the Lead reliably finds
the canonical roles and skills and can dispatch role-based subagents. Use a
subagent engineer and create a PR.” Intake Issue: https://github.com/pmark/arcadia/issues/1354.
No governed Action is claimed. Active Plan/current Action was read solely to
rule out overlap: decision-card-contract in the decision-card Plan; neither
pointer nor queue was changed.

Candidate: `/Users/pmark/.codex/worktrees/agent-roles-article/arcadia`, branch
`codex/lead-role-dispatch-20261012`, base `8605619c033e862ac97c8a1f4dc7cff84f431693`.
Parent/Lead owns integration, independent review and PR delivery. Engineer is
sole candidate code writer, depth 1; no commits, pushes, governance settlement,
host brokers, messaging, checkout/stash/reset or worktree creation performed.
No primary or other live worktree edits. Parent reported an independent host
fast-forward of primary from 17f05 to 8605619c0 while this work ran; this is an
observation, not a claim that primary reflog stayed unchanged.

## Result and criterion evidence

- Canonical launch discovery: `renderActionBrief` always points to the role
  registry, role commands, indexed dispatch procedure and arcadia-role skill,
  even when no model escalation is needed. It carries an exact read-only role
  brief recipe tied to the Action/candidate. The same paths are explicit in
  native-app and role procedures; historical names resolve to registered IDs.
- Native preparation: existing `role brief --requested-by lead --depth 0`
  validates via `assertRoleOperation`. Both flags must appear together; depth
  parser rejects blank/whitespace/non-numeric/fractional input. Only top-level
  Lead to planner, plan-critic, implementer/researcher passes; unknown roles,
  nested delegates and code-reviewer/QA native targets refuse. Standalone briefs
  remain valid for independent Sessions. Specialization cannot expand authority.
- Existing harness dispatch: complete generated role brief and skill retrieval
  go into native Codex spawn_agent / Claude Agent, with role/depth, candidate,
  file ownership, acceptance, raw checks, budget and hand-back Artifact. Delegates
  never spawn children; implementer sole ownership pauses Lead edits. Headless
  Claude permits only scoped read-only role command additions, no unrelated
  Arcadia mutations. Native-app Lead remains a non-product-code-writing role.
- Forward discovery: parent generated an authorized researcher brief, then
  launched a read-only native researcher from the full brief and skill. The
  researcher returned its role/depth, canonical IDs and policy limits in
  `/private/tmp/role-dispatch-forward-result.md`; it wrote no repo files and
  launched no children. This is actual native discovery/hand-back evidence,
  not a capacity admission, governed attempt or independent PR verdict.
- Forward findings repaired: `roles show researcher --json` emitted plain text
  because parent command consumed --json. Handler now uses existing
  optsWithGlobals pattern; real CLI regression proves structured researcher
  output with no workspace database opens/activity writes. Generic PR reviewer
  context language now explicitly differs from canonical code-reviewer/QA
  admission and proves no governed lineage. Existing independent PR review gate
  remains mandatory; registered reviewer/QA requests need separate Sessions.

## Raw validation receipts

All commands ran in the candidate. No full suite or service changes performed.

| Command | Exit / evidence |
|---|---|
| `pnpm exec vitest run tests/agent-roles.test.ts tests/action-brief.test.ts --update` | 0; 63 passed; three intentional provider snapshots refreshed |
| `pnpm exec vitest run tests/session-launch.test.ts tests/session-capability-probe.test.ts -t 'allows only validation\|escapes a literal star\|allow\|role'` | 0; five selected passed, 63 skipped |
| `pnpm exec vitest run tests/activity-no-record-commands.test.ts tests/cli-invocation.test.ts` | 0; 21 passed including actual CLI pairing/depth/JSON and workspace leak boundaries |
| `PYTHONPATH=/private/tmp/arcadia-role-skill-validation-deps python3 /Users/pmark/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/arcadia-role` | 0; Skill is valid |
| `pnpm check:agent-guidance` | 0 on final clarification; all three provider guidance deliveries have no problems |
| `pnpm exec tsc --noEmit` | 0 on final code delta |
| `pnpm exec eslint src/agentRoles/brief.ts src/cli.ts src/sessions/actionBrief.ts src/sessions/headlessPermissions.ts tests/agent-roles.test.ts tests/action-brief.test.ts tests/session-launch.test.ts tests/activity-no-record-commands.test.ts` | 0 on final code delta |
| `git diff --check` | 0 on final code delta |

## Limits and preserved failure receipts

The validator trusts supplied requester labels: it does not inspect actual live
lineage, prove host authorization or enforce native tool calls. Native dispatch
requires explicit operator or existing launch authorization. Governed capacity
admission, reservation/caps and role-aware enrollment remain unavailable. No
new runner, capacity broker, queue service, model call or Decision was added.
Adopting Projects use installed arcadia and installed skill; unavailable skill
or native tools stop dispatch with a preserved assignment. OpenCode native
transport is unverified. Claude native execution was not exercised here.

Transient checks exposed three author mistakes, all corrected without changing
gates: duplicate expected headless allowlist array caused one targeted test
failure (exit 1); raw SHA instead of the existing trimmed guidanceFingerprint
caused stale guidance checker failure (exit 1); real CLI test initially read
exit status after helper reset, then expected status 1 instead of repository
validation status 2 (two failed test runs, exit 1). Remedies: remove duplicate,
use canonical fingerprint helper, capture direct invocation status and expect
validation code 2. No runtime defect was concealed by these test repairs.
Initial guessed source path src/roles was absent; imports identify real
src/agentRoles paths. Targeted Notes To Self lookup repeated on new failures;
relevant dependency and focused-Vitest entries read. No new memory store.

## Instruction retrieval

File sizes below are current file bytes, not a claim that all bytes of every
file were read. Full first-start files were read; initial combined output
truncated portions of PROJECT, then exact pointer/Action was retrieved. Bounded
sections: current Action lines12–30; arcadia-repository Orientation, Semantics,
Model Selection, Operator Guide, PR QA Plan and Working-Copy Safety; working-copy
start/stop; principles Pareto/YAGNI/division; PR independent review gate; Notes
To Self dependency bridge and focused Vitest guidance. Authority sources include
exact approved Lead Decision0112 and delegation Decision0114. Applied skills:
arcadia-guardrail and arcadia-role. Parent loaded skill-creator for skill changes.

| Loaded instruction/reference | File bytes |
|---|---:|
| `AGENTS.md` | 9750 |
| `CONSTITUTION.md` | 3320 |
| `PROJECT.md` | 31539 |
| `.arcadia/AGENT_CONTEXT_POLICY.md` | 539 |
| `.arcadia/repo-context.md` | 703 |
| `.arcadia/context-policy.json` | 870 |
| `.agents/skills/arcadia-guardrail/SKILL.md` | 5565 |
| `.agents/skills/arcadia-role/SKILL.md` | 7277 |
| `docs/agent-guidance/index.json` | 7623 |
| `docs/agent-guidance/continuation.md` | 6239 |
| `docs/agent-guidance/learning.md` | 1636 |
| `docs/agent-guidance/operator-directed-work.md` | 4494 |
| `docs/agent-guidance/standard-harness.md` | 5569 |
| `docs/agent-guidance/session-roles-and-briefs.md` | 5343 |
| `docs/agent-guidance/native-app-sessions.md` | 8101 |
| `docs/agent-guidance/pull-requests.md` | 17585 |
| `docs/working-copy-safety.md` | 15818 |
| `docs/agent-guidance/principles.md` | 13789 |
| `docs/agent-guidance/arcadia-repository.md` | 30174 |
| `docs/arcadia-semantics.md` | 14180 |

Next safe move: Lead verifies final receipts, commits candidate under resolved
identity, pushes and creates Issue1354-linked PR handoff; required independent
current-head review and CI remain separate gates. No settlement or merge is
claimed by this engineer report.
