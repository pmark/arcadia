# Continue the Scout project for Arcadia Studio

Say **“Continue the Scout project for Arcadia Studio.”** The entrypoint skill is `arcadia-studio-scout`; repository agents also discover this guide through AGENTS.md and the guidance index. This guide is the maintained continuation map. Decisions and checked-in control records retain their authority; PRs and evidence establish what happened.

## Purpose and scope

**Checkpoint refreshed:** 2026-10-15. This update covers only the operator-directed replacement for #1402/#1404, tracked by [#1443](https://github.com/pmark/arcadia/issues/1443); it does not launch or complete the live Scout. The replacement PR must establish its own exact-head review and CI evidence before handoff.

The Scout initiative is the first bounded probe in Arcadia’s [operator-persona behavioral testing approach](../behavioral-testing.md). Personas simulate people using Arcadia; model/effort settings are separate from their knowledge and attention. This guide owns Scout continuation state; the broader document owns that testing concept. The approved live Luna customer and its bounds remain unchanged.

Prove that a customer can ask Arcadia for `HelloWorld.txt` through **Ask / Ask show / To-do**, and receive an actual completed Run and accepted product Artifact. This is the bounded no-remote Hello World integration probe supporting Arcadia Studio, not permission to launch a Studio pilot or create a remote delivery repository.

The exact builder-owned output is one file, `HelloWorld.txt`, containing **13 bytes**: `Hello World!` followed by one LF newline (`Hello World!\n`). Setup, approval transport, bounded Run consumption, validation and the independent oracle belong to the Lead/Supervisor or harness, outside the customer persona.

## Current checkpoint — 2026-10-15

| Track | Verified state | Meaning for continuation |
| --- | --- | --- |
| Scope/approved handoff | [#1392](https://github.com/pmark/arcadia/pull/1392) merged (`2cb6cce081c764b0fa4adaed03f8c60acae97147`); [#1394](https://github.com/pmark/arcadia/pull/1394) merged (`63e9c38edd3c656efd3cf7bde28cb99e0c0c11c1`) | Reuse the exact-file/approval route; do not expand builder scope to tests. Both #1394 reviewers withdrew the earlier finding after a real public-handler reproduction; #1401 remains advisory. |
| Consumer fix | [#1402](https://github.com/pmark/arcadia/pull/1402) remains open and draft at `797335b3b3a5cd279aa919eadc4f6f1eb78dc36a`; its source fix is carried onto current main in `codex/pr1402-fresh-carry-forward-20261015`, tracked by [#1443](https://github.com/pmark/arcadia/issues/1443) | Explicit blank/invalid Run selectors return no claim; omitted selector preserves FIFO. The replacement requires its own independent review and CI; no readiness is inferred from the old PR. |
| Independent review | The old PR exhausted its five-round review cycle and conflicts with main in the guidance index and Notes To Self; exact-head CI is absent. Its raw-ID receipt correction is retained unchanged. | Do not push to #1402 or start a sixth review round. The operator selected a fresh isolated candidate and replacement PR with a fresh review cycle; this authorizes source carry-forward only, with no merge or live Scout launch. |
| Historical Sonnet QA | Canonical QA Session `470885a5-84f4-4835-8441-b967973b9540`: **PASS** on all five source criteria; final-head confirmation verified source/tests unchanged and PR status accurately reported | No tests were run inside the read-only Session. It noted the duplicate-claim test is sequential rather than scheduler-simultaneous; the SQL compare-and-set is unchanged. |
| Historical CI | Run `38654575531` on the prior PR head passed six required checks and failed `unit-2`: `tests/notes-to-self.test.ts` measured 26 entries against the 25-entry limit after a new CI-log note was added | The remedy folds that guidance into the existing CI troubleshooting entry; the 25-entry cap and test remain unchanged. Check the current PR body for results on the corrected head. |
| Historical local validation | ESLint, TypeScript, build and code `git diff --check` exit 0; worker suites 78/78; fast rehearsal 19 files, 72 pass + 1 expected failure, 34 scenarios | The rehearsal report is `/private/tmp/arcadia-scout-advisor-20261014-01a13c4d/fast-rehearsal-final-head-report.json` (SHA-256 `88124e81b88000f940a202d7a67080bfc948a15985401f63ce3f79bbbc6806b2`). |
| Public consumer | Missing capability [#1389](https://github.com/pmark/arcadia/issues/1389) | No public bounded single-Run consumer is delivered. `worker start` is a daemon and refused in experiment workspaces; do not substitute an ad hoc internal-worker script. |
| Isolation / durable budget | Decision-aware preflight remains **isolation-only**, `executionAuthorized: false` | Earlier-valid-ledger rollback detection was not cleared; incomplete reservation code was removed. Durable counters, freshness and execution admission remain required. |
| Actual product result | **Unproved / no live attempt** | Zero actual Scout builder attempts and zero runtime repair cycles. Do not infer them from source-development or review calls. |
| Production | `inactive_idle`, zero live admissions, observed `2026-10-14T23:18:12.477Z` | Historical observation only; re-read current production state before any live attempt. |

Source work resumed only for the operator-directed #1443 replacement of the #1402/#1404 correction. The review found a ledger-ID mismatch; the corrected row preserves the stopped failure with the exact raw ID, and the CI note-cap failure is fixed without raising its limit. No live Scout launch, consumer, or product result is implied.

## First useful work in a new session

1. Read repository AGENTS.md, CONSTITUTION.md, PROJECT.md, its **current** active Plan/Action, the context policy and guidance index. Then read this guide, targeted Notes To Self (`scout`, `ingress`, `claim`, `budget`, `preflight`) and the indexed procedures needed for the next operation. The current Project Action may be an unrelated production track; this operator-directed Scout request does not activate the inactive Scout Plan or move pointers/queues.
2. Verify #1394 remains merged, and inspect the replacement PR linked from #1443, its current head, independent review, and required checks before continuing. Keep #1402 preserved at its exhausted review cycle; do not extend it. Preserve unique work; never reset the primary checkout or another Session’s candidate. If the named worktree is missing, recover through supported managed-worktree tooling.
3. The #1404 selector regression passed independent QA and its source review; later evidence-ledger corrections required additional review. The helper is only a prerequisite; no public consumer currently passes the selected Run through a bounded execution path.
4. Finish #1389: one canonical public consume-one operation selecting the approved named Run and sharing the existing executor/finalization. No daemon, recurring intake, orphan recovery, global-oldest fallback, production tick or second orchestration harness. Attach the actual product file Artifact; executor metadata alone is not Hello World evidence.
5. Finish durable Decision0128 safeguards before any provider launch: stable goal budget across restarts/source revisions/fixture changes; transactional reservation before invocation; ambiguous interruptions consume allowance; caps, expiry, clock rollback, corrupt/missing history and restoration of an earlier valid ledger fail closed. Independently verify freshness/restore detection; a hash/timestamp stored only inside the same restored ledger is insufficient. Do not fabricate governed Session admission/role lineage. The evidence-witness research below is a proposal, not an accepted implementation.
6. Obtain separate independent Code-reviewer and QA Sessions, repair valid findings and required CI, and prove the exact current head. Only then prepare the approved exact-scope assignment, immutable clean source, Node22, current subscription/capacity checks and fresh protected-state attribution witnesses. Launch the customer Scout through Ask/Ask show/To-do only after every prerequisite passes.

Use canonical **Lead acting as Supervisor**. The preserved configuration uses Luna/medium Implementer for bounded source assignments and Luna/low Researcher for bounded investigation; separate Luna/high Code-reviewer and QA Sessions. Read current role/model bindings before dispatch and state finite budgets. Native delegates stay depth1 and never delegate. Reviewers are separate Sessions, not native children. A live builder is exactly Luna/low; unavailable configuration is a gate, not permission to substitute a model/provider.

## Live authority and stop conditions

Read [Decision0128](../decisions/0128-record-the-operator-authorized-bounded-luna-hello-world-attempt-bug-repair.md) in full and revalidate its publication/approval. It supersedes only Decision0125’s attempt/retry bounds for this same fixture goal:

- At most **3 total** live builder attempts, **90 seconds each**; at most **2** runtime repair cycles. Each repair: one Luna/medium Implementer up to20min, separate Code-reviewer and QA up to5min each.
- At most **90 minutes from the first live launch**, including repairs/reviews/waits across restarts and source changes. No first live launch was reported here; verify durable evidence before relying on remaining allowance.
- **$0 incremental paid spend**, existing subscription only; no API billing, bought credits/resets, fallback or new infrastructure. Retain measured usage and unknown cost honestly.
- **Expires `2026-10-18T00:00:00Z`** (October17,5pm Pacific). After expiry, source preparation may continue when independently authorized, but a live attempt requires a new operator Decision. A continuation prompt cannot renew the scope or reset counters.
- Keep Production Off for Scout. No live Project/pointer/queue mutation, service install/restart, default-workspace switch, host-config rollback/deletion, fixture remote/GitHub/Discord operation, deployment or Studio pilot. Resolve the configured live workspace normally; experiment workspaces use inline addressing and the Decision0082 constraints.
- Retry only after a named failure, changed verified fix and independent review/QA. Stop on unchanged failure, missing authority/evidence, isolation or unattributed protected-state changes, expiry, clock rollback, corrupt/rolled-back history, login/quota refusal or exhausted limits. Do not deactivate another track or disturb work in flight to make Scout eligible.

Preserve the historical config uncertainty from the earlier Scout. A fresh baseline or successful replay cannot retroactively attribute the old change or authorize execution. Generic merge-on-green still applies; the exceptional #1394 clarification was operator-specific and does not raise the usual five-round review cap.

## Completion oracle

A passing source test or CI run proves source behavior only. A queued Run, approval receipt, metadata Artifact or standalone file is **not Yes**. Actual Hello World completion needs all of:

- exact13-byte `HelloWorld.txt`, with no other builder-owned file changes;
- the original Ask correlated with a **completed** Run;
- a **ready/published product Artifact at that exact path**;
- an independently checked result and protected-state witnesses within the approved bounds.

A local fixture Yes still does not prove the separately gated remote green-PR/Studio pilot milestone. Report source validation, actual attempts and product outcome separately.

## Preserved work and evidence

The historical pushed branch is `codex/scout-bounded-consumer-resume-20261013`; preserve it without changes. Fresh replacement source work uses `codex/pr1402-fresh-carry-forward-20261015` at `/Users/pmark/.codex/worktrees/pr1402-fresh-carry-forward/arcadia`, tracked by #1443. Its review/check results belong to the replacement PR; the old results below remain historical. Last known local candidate: `/Users/pmark/.codex/worktrees/scout-bounded-consumer-resume/arcadia`. Its exact original two-file patch was committed as `9627247e056004dbea51afe669de1af319d5643d`, patch SHA256 `c9ab5e9b0a5ccdf8f8df94916dbe7c6640ee62f642d84c1e92f8f713fda788f7`; the later head adds close-out documents. One focused named-Run test passed; feature acceptance remains blocked. Paths are recovery hints, not guarantees.

Private evidence root on this host: `/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/artifacts/scout-evidence/`:

| Bundle | Use |
| --- | --- |
| `bounded-20261013-fresh-session/` | Original bounded handoff;31 manifest files verified, interrupted consumer patch and earlier budget/review evidence |
| `resume-01a13873-checkpoint-20261014T0418Z/` | Intermediate source recovery checkpoint |
| `resume-01a13873-final-source-gate-20261014T0525Z/` |90 verified files: PR1394 R1–R5 history, consumer R1, raw handbacks/usage, proposal and original stop evidence |
| `pr1394-clarification-20261014T2050Z/` |19 verified files: final reproduction, both explicit PASS/withdrawals, merge gates and actual merge receipt; supersedes only the old #1394 block |

Verify each bundle’s manifest before reuse. Inspect the saved `scout-resume-research-handback.json` in the final-source-gate bundle for the proposed canonical SQLite budget plus independent create-once/fsync artifact witness, its crash behavior, restore-snapshot test and trust boundary. It does not establish resistance to a privileged rewrite of both trusted stores and has not been independently accepted as an implementation. Keep raw config/secrets out of prompts/public logs; these private directories are evidence, not authority.

Supporting records: [bounded-loop report](../reports/scout-bounded-loop-2026-10-13.md), [replacement scope](../reports/scout-replacement-scope-2026-10-13.md), [isolation report](../reports/scout-isolation-preflight-2026-10-13.md), [Scout Plan](../plans/ask-queues-approved-work-or-admits-bounded-independent-sessions-without.md), [public rehearsal guidance](../agent-guidance/ask-todo-scout.md). Older reports are historical snapshots; use this checkpoint and verified current records to avoid reopening the resolved #1394 gate.

At the next Scout stop, update this guide’s dated checkpoint, PR/head/acceptance state, actual budget consumption and evidence locations. Preserve history in reports; keep one continuation guide and a thin entrypoint rather than parallel memory stores. Governed status/Decision/Plan changes still use Agent Asks.
