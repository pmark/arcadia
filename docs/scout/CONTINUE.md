# Continue the Scout project for Arcadia Studio

Say **“Continue the Scout project for Arcadia Studio.”** The entrypoint skill is `arcadia-studio-scout`; repository agents also discover this guide through AGENTS.md and the guidance index. This guide is the maintained continuation map. Decisions and checked-in control records retain their authority; PRs and evidence establish what happened.

## Purpose and scope

Prove that a customer can ask Arcadia for `HelloWorld.txt` through **Ask / Ask show / To-do**, and receive an actual completed Run and accepted product Artifact. This is the bounded no-remote Hello World integration probe supporting Arcadia Studio, not permission to launch a Studio pilot or create a remote delivery repository.

The exact builder-owned output is one file, `HelloWorld.txt`, containing **13 bytes**: `Hello World!` followed by one LF newline (`Hello World!\n`). Setup, approval transport, bounded Run consumption, validation and the independent oracle belong to the Lead/Supervisor or harness, outside the customer persona.

## Current checkpoint — 2026-10-14

| Track | Verified state | Meaning for continuation |
| --- | --- | --- |
| Scope/approved handoff | [#1392](https://github.com/pmark/arcadia/pull/1392) merged (`2cb6cce081c764b0fa4adaed03f8c60acae97147`); #1394 adds final selected-repository checks | Reuse the exact-file/approval route; do not expand builder scope to tests |
| Shared Ask/To-do Run evidence | [#1394](https://github.com/pmark/arcadia/pull/1394) merged (`63e9c38edd3c656efd3cf7bde28cb99e0c0c11c1`), reviewed source head `207080cd80c0b62a65b721c80c284b8238bdb87e` | 299 affected source tests and all seven CI jobs passed; this blocker is resolved |
| Final #1394 finding | Both original independent reviewers withdrew the blocking classification after a real public-handler reproduction | Renamed edited input creates a new capture, not old-capture authority. [#1401](https://github.com/pmark/arcadia/issues/1401) is advisory; no more #1394 clarification is needed |
| Consumer preservation | [#1402](https://github.com/pmark/arcadia/pull/1402) is an open draft at `956f20f67da2eb145db23b25ab5bb31e1c1495b6`; all seven CI jobs passed | Partial selected-Run helper only; currently conflicts with main. Both independent R1 reviews block the empty-selector edge in [#1404](https://github.com/pmark/arcadia/issues/1404) |
| Canonical public consumer | Missing capability [#1389](https://github.com/pmark/arcadia/issues/1389) | No public bounded single-Run consumer is delivered. `worker start` is a daemon and refused in experiment workspaces; do not substitute an ad hoc internal-worker script |
| Isolation / durable budget | Decision-aware preflight is **isolation-only**, `executionAuthorized: false` | Earlier-valid-ledger rollback detection was not cleared; incomplete reservation code was removed. Durable counters, freshness and execution admission remain required |
| Actual product result | **Unproved / No live attempt** | Zero actual Scout builder attempts and zero runtime repair cycles were reported at this checkpoint. Do not infer them from source-development or review calls |
| Production | Inactive · Idle, zero live admissions observed `2026-10-14T20:58:13.451Z` | Re-read on resume; never assume a past observation is current |

Consumer and Scout execution were held by the operator; only #1394 clarification and this documentation were subsequently resumed. A future explicit “continue” request resumes the named work within current authority, not an automatic live launch or general policy exception.

## First useful work in a new session

1. Read repository AGENTS.md, CONSTITUTION.md, PROJECT.md, its **current** active Plan/Action, the context policy and guidance index. Then read this guide, targeted Notes To Self (`scout`, `ingress`, `claim`, `budget`, `preflight`) and the indexed procedures needed for the next operation. The current Project Action may be an unrelated production track; this operator-directed Scout request does not activate the inactive Scout Plan or move pointers/queues.
2. Verify #1394 remains merged, and inspect #1402/#1404 plus the preserved candidate and its actual head/status. Run the supported work monitor before edits. Preserve unique work; never reset the primary checkout or another Session’s candidate. If the named worktree is missing, recover from its pushed branch/PR through supported managed-worktree tooling.
3. The **next concrete source fix** is #1404: distinguish an omitted Run selector (legacy FIFO) from an explicitly empty/invalid selector. A supplied invalid ID must return no claim and leave unrelated pending Runs untouched. Add that negative regression alongside named-Run/duplicate/concurrent-claim evidence. Use the existing #1402 candidate or a safely resumed isolated candidate, then integrate current reviewed base through the governed merge path, never rebase/reset away the preserved patch.
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

The pushed branch is `codex/scout-bounded-consumer-resume-20261013`. Last known local candidate: `/Users/pmark/.codex/worktrees/scout-bounded-consumer-resume/arcadia`. Its exact original two-file patch was committed as `9627247e056004dbea51afe669de1af319d5643d`, patch SHA256 `c9ab5e9b0a5ccdf8f8df94916dbe7c6640ee62f642d84c1e92f8f713fda788f7`; the later head adds close-out documents. One focused named-Run test passed; feature acceptance remains blocked. Paths are recovery hints, not guarantees.

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
