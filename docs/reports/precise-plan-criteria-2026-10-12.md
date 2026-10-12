# Precise Plan acceptance criteria — review and evidence

Operator request: 2026-10-12. Branch: `codex/precise-plan-criteria`, created from local `main` (`0a979af61cc4ac58e70c16a9383f0bb3edfdaf6f`).

This report is a review Artifact, not a completion claim or an approval. No governed acceptance amendment has been applied.

## Implementation

- Every managed Plan Action requires a non-empty list, including non-current, completed, deferred, blocked and question-open Actions. Malformed elements are rejected instead of silently coerced or dropped.
- Parsing and settlement share deterministic checks for duplicate conditions, unresolved placeholders, known subjective quality claims, short implementation instructions and unnamed token thresholds. These are necessary minimum checks; arbitrary English coverage and semantic precision still require independent review.
- The amendment writer can insert a missing list. A restricted criteria-only repair read tolerates only acceptance errors and preserves the Action identity, next_action, status, responsibility, dependencies, questions and pointers; written documents undergo ordinary strict validation. It grants no dispatch authority.
- Six malformed YAML criteria were quoted with their literal text preserved. Authoring guidance and its index fingerprints were updated.

## Validation

- Parser/dispatch regression suites: 137 tests passed.
- Existing Artifact acceptance tests and new Plan validation tests: 29 passed.
- Governed criteria-repair scenarios: 4 passed (open, done, question_open preservation, and pre-write subjective-criterion refusal).
- Final targeted parser/dispatch suites: 139 tests passed.
- Complete settlement and governed-compatibility suites: 104 tests passed.
- Bootstrap, ordering, history-link and scheduling compatibility suites: 69 tests passed.
- Session Action brief suite: 27 tests passed, including a field-specific invalid-criteria refusal.
- Six repair scenarios cover open/done/question_open state, non-current legacy Actions without next_action, subjective rejection and literal-dollar preservation. Positive assertion regressions reject the independent reviewer's excellent-product and everyone-loves-it examples.
- The obsolete pre-review local full-suite process was stopped after about 13 minutes; source changes made it unsuitable as final-head proof. First-head CI reported old fixture failures plus the expected control-document refusal. Each reported fixture failure was repaired and its targeted suite passed. Final-head CI supplies the full-suite gate.
- A read-only projection check parsed the three official settlement-preview Plan outputs and compared every Action control field except acceptance/source metadata. All unchanged-corpus errors are covered by these three unapplied amendments. No live Plan was written for this proof.

## Approval boundary and exact amendments

Automatic approval review rejected creation of the intake GitHub Issue because it considered that a separate external project-record/message mutation without an explicit Decision. It also rejected a script applying these three Plan settlements because exact broad amendments had not been approved and an agent cannot approve its own proposal. Neither rejected action was retried through another route.

The three previews below are registered in the configured martianrover workspace. They preserve status, Responsibility, dependencies, references, activation, pointers and queue order. The eight historical backfills specify evaluation conditions; they do not assert that new evidence was gathered or rewrite completion status. Fresh previews are required before apply because queue revisions and source bytes can change.

### plan/every-production-session-is-bounded-by-a-platform-token-ceiling-and-an-in

- Request: `precise-criteria-active-20261012`
- Proposal: `agentask_419f5a2bc5610e69b0`
- Preview fingerprint at review: `d243a32e44444cfecc674dfd6cc465b28a175984e0bbe3a252eed05be7dff121`

**action/replay-environment-wall-session**

1. Running pnpm fast-rehearsal includes a deterministic environment-wall fixture based on the 2026-10-12 00:40Z receipts; the fixture finishes in less than 30 seconds and its assertion fails when the environment-wall stop is removed.
2. Running scripts/fast-rehearsal.mjs with a missing report.json or invalid JSON prints the attempted report path and exits with a non-zero status; a valid report prints its path and exits zero.
3. The fixture sets a 1,000 input-token ceiling (cached plus uncached), asserts the attempt stops at or below it, records both counts in a per-attempt receipt, raises exactly one environment_wall blocker and records exactly one provider launch.
4. Focused tests added for the environment-wall scenario and missing or invalid report.json all exit zero; pnpm fast-rehearsal exits zero. The PR records the exact focused test commands and their exit codes.

**action/record-session-ledger**

1. docs/reports/session-ledger.jsonl is validated against a typed schema requiring session_id, role, model, effort, action_id, pr, tokens_in_uncached, tokens_in_cached, tokens_out, wall_min, attempts, review_rounds, blocking_findings, operator_touches, host_touches, frictions and outcome.stop_reason; unknown historical measurements use an explicit schema-supported unknown value rather than an invented number.
2. The validator exits non-zero and names the row and field for each fixture with a missing required field, wrong field type or malformed JSON; it exits zero for a valid row. CI runs the validator on every PR changing the ledger.
3. The ledger contains exactly one backfilled row for each session A12, A3, A5 and A6, with provenance to docs/reports/production-simulation-living-notes.md; that document links to the ledger.
4. Focused tests for valid rows, malformed JSON, missing fields, wrong types and historical unknown values exit zero; the PR records their exact command and exit code.

**action/enforce-session-token-ceiling**

1. A replay fixture sets a 1,000 input-token ceiling, feeds cached and uncached input usage whose sum reaches that ceiling, and asserts a budget_exhausted stop receipt containing ceiling: 1000 and the two supplied token counts.
2. The ceiling-hit replay records exactly one provider launch and one budget_exhausted blocker; a subsequent production tick does not relaunch the same attempt.
3. The production policy declares a positive finite integer input-token default for each configured tier. Tests attempt to disable or raise it through prompt, brief and Action text and assert the effective policy value is unchanged; the PR lists the actual per-tier defaults.
4. Focused token-ceiling and production-tick tests exit zero and pnpm fast-rehearsal exits zero; the PR records the exact focused commands and exit codes.

**action/probe-environment-inside-session**

1. A fake provider with a read-only workspace database runs the probe as its first Session step, returns environment_wall within a 1,000 input-token fixture budget, and attaches the probe JSON to the reconcile receipt.
2. A regression fixture with a passing host-worker probe and a failing in-Session probe is refused with environment_wall; the passing host probe is not accepted as evidence of Session capability.
3. Probe fixtures independently deny workspace-database writes, host-validation execution and preservation-receipt creation; each returns exactly one environment_wall blocker naming the failed capability and its remedy. A passing probe records cached and uncached input counts whose sum is at most 1,000 tokens in the fixture.
4. Focused tests for the three failed capabilities, host-versus-Session capability and a passing probe exit zero; pnpm fast-rehearsal exits zero. The PR records the exact focused commands and exit codes.

**action/one-click-clear-every-blocker-kind**

1. An enumeration test collects emitted blocker kinds, fails for an unregistered kind, and passes with registered remedies for environment_wall, budget_exhausted, scope_successor_held and scope_pointer_mismatch.
2. A dashboard interaction test starts at /todo or /actions for each registered blocker kind, selects its remedy and resolves the stop in at most two clicks with no typing or copy/paste; each remedy invokes the existing validated operator-script machinery.
3. Dashboard tests for environment_wall and budget_exhausted each find the reset-repair-budget control from /todo and assert its registered operator-script identifier.
4. Focused blocker-registry and dashboard interaction tests exit zero; the dashboard dependency-graph check rejects any containerAuditTransport import. The PR records the exact commands and exit codes.

**action/fix-docs-sync-lock-and-activation-order**

1. A settlement test injects a transient SQLite lock during Plan activation; after the bounded retry succeeds, advance queue reports orderValid: true and unpositionedCount: 0, and the activated Actions were positioned in the apply transaction.
2. A before-and-after queue snapshot test asserts that the relative order of every other Project's Actions is unchanged by activation.
3. A queue-reorder settlement test asserts that the matching current_action pointer update and reorder share one settlement receipt; an injected failure before commit leaves both original values unchanged.
4. Focused settlement, transient-lock and queue-order tests exit zero; the PR records the exact commands and exit codes.

**action/revise-agent-roles-and-session-briefs**

1. docs/agent-guidance defines Lead as one Action per Session, Driver on standard tier returning diff, exact test command and exit code, Reviewer as the fresh independent review role replacing Critic, and Replayer as a deterministic script role; the live Observer is deferred until a recorded run demonstrates an otherwise-undetected stall requiring observation.
2. The session-brief template includes repository file:line ranges, named focused test paths, literal adversarial fixture inputs for guard or validator Actions, and a hand-back instruction excluding repeated sandbox text.
3. The role table names an available model and supported effort for each model-bearing role with cost reasoning, marks Replayer as zero-model, and docs/agent-guidance/index.json routes the role and brief triggers to the authoritative section.
4. pnpm check:agent-guidance exits zero for the instruction budget and guidance-index checks; the repository documentation link check exits zero. The PR records the exact link-check command and exit code.

### plan/clarification-pass

- Request: `precise-criteria-clarification-pass-20261012`
- Proposal: `agentask_53c64332a81bb3c231`
- Preview fingerprint at review: `899d0592693d9d0c8075640d52eb88209b8bc16cf75acebd58ca1271e5d89e2a`

**action/phase-1-plumbing**

1. CLI help lists artifact create and work update --expected-artifact; a CLI fixture creates an Artifact linked to its Action and persists the supplied expected-artifact value.

**action/phase-2-fields**

1. A fresh database and an upgraded database each expose clarification_status, gap_type, open_question, clarification_source and confidence on work_items; repeating migration leaves exactly one column of each name.

**action/phase-3-decisions-subtasks**

1. CLI fixtures open a clarification Decision and add a child Action whose parent_work_item_id equals the named parent; listing the Actions shows that parent-child relationship.

**action/phase-4-orchestrator**

1. A clarify fixture maps a concrete next action to clarified and an unresolved requirement to question_open with exactly one question and gap_type, preserving the original captured input.

**action/plan-gate**

1. An explicit Decision records whether work plan requires clarified Actions and names the compatibility consequences; until that Decision is answered this Action remains question_open and is not dispatched.

### plan/portfolio-docs-protocol

- Request: `precise-criteria-portfolio-docs-protocol-20261012`
- Proposal: `agentask_46c417530b96c8c284`
- Preview fingerprint at review: `02621f5cb3a75f350f3ab561214a014358e80699f1795e9c46428f6b4476f429`

**action/build-parser**

1. Parsing a managed frontmatter fixture returns its declared Project, Plan or Decision fields; an invalid vocabulary value reports the exact file and field without throwing away errors in other files.

**action/build-upsert**

1. Applying the same managed-document fixture twice leaves one row per doc_ref and no duplicate dependency links; a changed title updates the existing row rather than creating another.

**action/wire-docs-sync-command**

1. CLI help lists docs sync with --project and --apply; a fixture dry run writes no Project rows, the same --apply run persists the declared records, and portfolio reports the synced Project.

## Instruction retrieval evidence

Loaded the following paths and relevant sections before their operations. Byte counts identify the candidate versions; the two authoring-guidance hashes were refreshed after editing.

| Path | UTF-8 bytes | Retrieved sections |
| --- | ---: | --- |
| `CONSTITUTION.md` | 3320 | Authority; Truth; Economy |
| `PROJECT.md` | 31609 | Frontmatter and current state |
| `AGENTS.md` | 9276 | All instructions |
| `.arcadia/AGENT_CONTEXT_POLICY.md` | 539 | All |
| `.arcadia/repo-context.md` | 703 | All |
| `.arcadia/context-policy.json` | 870 | All |
| `docs/agent-guidance/index.json` | 6393 | Task/failure triggers |
| `docs/agent-guidance/operator-directed-work.md` | 4494 | Start now; Leave a trace; Handoff |
| `docs/agent-guidance/learning.md` | 1636 | All |
| `docs/managed-documents.md` | 16858 | Plan anatomy; fields with teeth; enforcement; change rules |
| `docs/planning-process.md` | 13191 | Action sizing; acceptance; deliverable |
| `docs/agent-guidance/arcadia-repository.md` | 30174 | Plan-amendment runner; Orientation; Managed Documentation; Semantics; PR QA Plan; Working-Copy Safety |
| `docs/working-copy-safety.md` | 15818 | Monitor; Start-session; Stop-session; candidate preservation |
| `docs/agent-guidance/agent-asks.md` | 22884 | Capture; permission failure; Project state; settlement; candidate publication |
| `docs/agent-guidance/pull-requests.md` | 17208 | Independent review; checks; merge exclusions; QA metadata |
| `docs/agent-guidance/git-identity.md` | 5248 | Resolve identity and signature |
| `docs/arcadia-semantics.md` | 14180 | Canonical concepts |
| `docs/notes-to-self.md` | 34925 | Acceptance/amendment; workspace write denial; dependency bridging; literal replacement text |
| `docs/plans/every-production-session-is-bounded-by-a-platform-token-ceiling-and-an-in.md` | 12407 | Exact current Action and all seven acceptance lists |
| `/Users/pmark/.codex/AGENTS.md` | 929 | All |
| `/Users/pmark/.codex/skills/arcadia-agent-ask/SKILL.md` | 3452 | All |

## Friction and recovery

- Initial combined guidance read was truncated; authoritative procedures were reread in bounded calls. Two guessed source/test paths and one working-copy procedure alias did not exist; actual authoritative files were located and read. No missing mandatory reference remains.
- Sandbox denied workspace receipt writes. The same preview operations succeeded through ordinary host approval; no workspace substitution, direct database edit or sandbox-policy modification was used.
- A temporary draft and differently serialized inline preview shared a request id, producing an auto-discovery conflict. The successful registered active proposal is authoritative; settlement uses its request id. Historical requests were drafted and previewed once using the canonical files.
- A new test initially collided with an existing filename. The original Artifact tests were restored byte-for-byte from main and the new tests moved to `tests/plan-acceptance-validation.test.ts`. Both suites passed.
- Strict parsing exposed missing criteria in old fixtures; fixtures now declare their observable result without changing the behaviors under test.
- A repair fixture initially used the wrong title for a question-open Action. The preservation check rejected it; the corrected fixture passed.
- Changed authoring guidance initially failed its fingerprint check; the two index hashes were refreshed using the canonical fingerprint function.
- The full suite uses disposable test workspaces only. No live governed settlement, queue reorder, service restart, merge or deployment was performed.

## Independent review

Round 1 reviewed `692236bf8bca396e0ea713c200da64cbd6b31c62` and found two blocking issues: a phrase blacklist admitted subjective prose, and missing-next_action legacy shapes could not use criteria-only repair. The reviewer also identified the pre-existing literal-dollar replacement defect (related to Issue #1213). All three were repaired, with positive assertion checks, preserved absent fields, callback replacement and regressions. Round 2 reviews the resulting pushed head. CodeRabbit skipped its review because the PR is a draft; no advisory findings were supplied.

Bootstrap generation now emits a declared Artifact condition or a recorded clarification condition for each Action. An unresolved product requirement remains blocked; no product success condition is invented. Initial CI's historical fixtures were updated to declare their actual test condition. Session launch now surfaces the exact malformed-criteria field instead of claiming the existing Plan is missing.

A report-update Python syntax error left the report unchanged; the corrected update was applied separately with fail-fast shell execution. No governed state was involved.

Round 2 at `0eb6747bd4a550b7220e475e47a9931f7cbaee45` confirmed the legacy-field and dollar-preservation fixes, but kept P1 blocking: bare copulas/modals admitted "The UI is beautiful" and "The feature will delight users". The validator now requires a supported inspectable active/passive outcome, explicit field/value/count condition, or numeric comparison; bare copulas/modals/negation words do not qualify. The assertion contract is documented. Those examples plus "The product has a nice design" have refusal regressions.

The latest assertion-contract compatibility run passed 240 tests in nine suites. The focused Plan/criteria-only repair run passed 32 tests. Corpus validation reports exactly ten errors in the three still-unapplied amendment targets; no other Plan is rejected by the grammar. Changing the assertion guidance temporarily invalidated its fingerprint during a local adoption test; the fingerprint was refreshed before the successful nine-suite rerun. Round 3 reviews the final grammar and documentation delta. No governed amendment has been applied.
