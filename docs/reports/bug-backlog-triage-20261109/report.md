# Bug backlog triage and Relay gaps

**Taken:** Sunday 2026-11-08, 10:31 PM PST, against `main` at `bf1b304c5b2d`. **Issue:** [#2342](https://github.com/pmark/arcadia/issues/2342). No governed Action holds this work.

Nothing was closed or relabelled, and no Plan, pointer or queue moved. As the request directed, this work filed seven Issues and 17 Agent Ask proposals. Those are signals and receipts, and none grants authority or queues work.

## Refresh 2026-11-11

**Taken:** Wednesday 2026-11-11, against `main` at `a3a109bff` (the list above was taken at `bf1b304c5b2d`). Live state came from one batched `gh issue list --state all` call (986 Issues). Nothing was closed or relabelled and no Plan or Action was edited. Per-Issue state is in each `triage.json` row (`refresh_20261111`) and the new **Live 11-11** column of [bug-table.md](bug-table.md).

| Of the 344 Issues in the list | Count | Of the 177 bug-shaped |
|---|---|---|
| **Closed** on GitHub since 2026-11-08 | 15 | 13 |
| **Fixed on main, Issue still open** | 95 | 15 |
| **Still open** | 234 | 149 |

- **Closed (all completed):** [#749](https://github.com/pmark/arcadia/issues/749) 11-09, [#1249](https://github.com/pmark/arcadia/issues/1249) 11-10, [#1366](https://github.com/pmark/arcadia/issues/1366) 11-09, [#1646](https://github.com/pmark/arcadia/issues/1646) 11-10, [#1670](https://github.com/pmark/arcadia/issues/1670) 11-10, [#2011](https://github.com/pmark/arcadia/issues/2011) 11-09, [#2102](https://github.com/pmark/arcadia/issues/2102) 11-10, [#2119](https://github.com/pmark/arcadia/issues/2119) 11-10, [#2134](https://github.com/pmark/arcadia/issues/2134) 11-09, [#2159](https://github.com/pmark/arcadia/issues/2159) 11-09, [#2227](https://github.com/pmark/arcadia/issues/2227) 11-10, [#2273](https://github.com/pmark/arcadia/issues/2273) 11-09, [#2278](https://github.com/pmark/arcadia/issues/2278) 11-09, [#2284](https://github.com/pmark/arcadia/issues/2284) 11-10, [#2341](https://github.com/pmark/arcadia/issues/2341) 11-10 (month-day, 2026). Three of the closures were the unattended production run's: [#2134](https://github.com/pmark/arcadia/issues/2134), [#1249](https://github.com/pmark/arcadia/issues/1249) and [#1670](https://github.com/pmark/arcadia/issues/1670) landed with `Closes` commits `f44c99a4d`, `15242bca3` and `53351c45e`. [#749](https://github.com/pmark/arcadia/issues/749) is fixed by `ad48f90fa` and closed 2026-11-09, yet its Plan Action is still open.
- **Fixed on main, Issue open, with a commit:** [#2018](https://github.com/pmark/arcadia/issues/2018), `64b3372fe` (PR 2364). It was **reopened**, so confirm the fix covers the reopen reason before closing. [#1340](https://github.com/pmark/arcadia/issues/1340) was also reopened and has no fix commit, so it stays open.
- **Fixed on main, Issue open, governed Action done (94):** each has a done Action in the checked-in Plans. Acceptance coverage was not re-proved, which the closure rule requires. These are the 69 mirrors plus other done-Action Issues from the earlier list.
- The earlier 18 resolved and 8 duplicate candidates are all still open. None has closed since.

### Closure candidates for the operator (not closed)

[#899](https://github.com/pmark/arcadia/issues/899), [#925](https://github.com/pmark/arcadia/issues/925), [#940](https://github.com/pmark/arcadia/issues/940), [#944](https://github.com/pmark/arcadia/issues/944), [#987](https://github.com/pmark/arcadia/issues/987), [#989](https://github.com/pmark/arcadia/issues/989), [#1015](https://github.com/pmark/arcadia/issues/1015), [#1016](https://github.com/pmark/arcadia/issues/1016), [#1262](https://github.com/pmark/arcadia/issues/1262), [#1277](https://github.com/pmark/arcadia/issues/1277), [#1286](https://github.com/pmark/arcadia/issues/1286), [#1419](https://github.com/pmark/arcadia/issues/1419), [#1470](https://github.com/pmark/arcadia/issues/1470), [#1509](https://github.com/pmark/arcadia/issues/1509), [#1536](https://github.com/pmark/arcadia/issues/1536), [#1570](https://github.com/pmark/arcadia/issues/1570), [#1574](https://github.com/pmark/arcadia/issues/1574), [#1582](https://github.com/pmark/arcadia/issues/1582), [#1585](https://github.com/pmark/arcadia/issues/1585), [#1628](https://github.com/pmark/arcadia/issues/1628), [#1655](https://github.com/pmark/arcadia/issues/1655), [#1656](https://github.com/pmark/arcadia/issues/1656), [#1657](https://github.com/pmark/arcadia/issues/1657), [#1767](https://github.com/pmark/arcadia/issues/1767), [#1800](https://github.com/pmark/arcadia/issues/1800), [#1886](https://github.com/pmark/arcadia/issues/1886), [#1965](https://github.com/pmark/arcadia/issues/1965), [#1966](https://github.com/pmark/arcadia/issues/1966), [#1967](https://github.com/pmark/arcadia/issues/1967), [#1987](https://github.com/pmark/arcadia/issues/1987), [#1989](https://github.com/pmark/arcadia/issues/1989), [#1990](https://github.com/pmark/arcadia/issues/1990), [#1991](https://github.com/pmark/arcadia/issues/1991), [#2004](https://github.com/pmark/arcadia/issues/2004), [#2015](https://github.com/pmark/arcadia/issues/2015), [#2018](https://github.com/pmark/arcadia/issues/2018), [#2049](https://github.com/pmark/arcadia/issues/2049), [#2050](https://github.com/pmark/arcadia/issues/2050), [#2051](https://github.com/pmark/arcadia/issues/2051), [#2052](https://github.com/pmark/arcadia/issues/2052), [#2053](https://github.com/pmark/arcadia/issues/2053), [#2054](https://github.com/pmark/arcadia/issues/2054), [#2055](https://github.com/pmark/arcadia/issues/2055), [#2056](https://github.com/pmark/arcadia/issues/2056), [#2057](https://github.com/pmark/arcadia/issues/2057), [#2123](https://github.com/pmark/arcadia/issues/2123), [#2139](https://github.com/pmark/arcadia/issues/2139), [#2140](https://github.com/pmark/arcadia/issues/2140), [#2141](https://github.com/pmark/arcadia/issues/2141), [#2162](https://github.com/pmark/arcadia/issues/2162), [#2163](https://github.com/pmark/arcadia/issues/2163), [#2164](https://github.com/pmark/arcadia/issues/2164), [#2165](https://github.com/pmark/arcadia/issues/2165), [#2166](https://github.com/pmark/arcadia/issues/2166), [#2167](https://github.com/pmark/arcadia/issues/2167), [#2168](https://github.com/pmark/arcadia/issues/2168), [#2169](https://github.com/pmark/arcadia/issues/2169), [#2186](https://github.com/pmark/arcadia/issues/2186), [#2187](https://github.com/pmark/arcadia/issues/2187), [#2188](https://github.com/pmark/arcadia/issues/2188), [#2189](https://github.com/pmark/arcadia/issues/2189), [#2190](https://github.com/pmark/arcadia/issues/2190), [#2191](https://github.com/pmark/arcadia/issues/2191), [#2192](https://github.com/pmark/arcadia/issues/2192), [#2193](https://github.com/pmark/arcadia/issues/2193), [#2194](https://github.com/pmark/arcadia/issues/2194), [#2195](https://github.com/pmark/arcadia/issues/2195), [#2196](https://github.com/pmark/arcadia/issues/2196), [#2197](https://github.com/pmark/arcadia/issues/2197), [#2198](https://github.com/pmark/arcadia/issues/2198), [#2199](https://github.com/pmark/arcadia/issues/2199), [#2200](https://github.com/pmark/arcadia/issues/2200), [#2201](https://github.com/pmark/arcadia/issues/2201), [#2202](https://github.com/pmark/arcadia/issues/2202), [#2203](https://github.com/pmark/arcadia/issues/2203), [#2204](https://github.com/pmark/arcadia/issues/2204), [#2205](https://github.com/pmark/arcadia/issues/2205), [#2288](https://github.com/pmark/arcadia/issues/2288), [#2289](https://github.com/pmark/arcadia/issues/2289), [#2290](https://github.com/pmark/arcadia/issues/2290), [#2291](https://github.com/pmark/arcadia/issues/2291), [#2292](https://github.com/pmark/arcadia/issues/2292), [#2293](https://github.com/pmark/arcadia/issues/2293), [#2294](https://github.com/pmark/arcadia/issues/2294), [#2295](https://github.com/pmark/arcadia/issues/2295), [#2296](https://github.com/pmark/arcadia/issues/2296), [#2297](https://github.com/pmark/arcadia/issues/2297), [#2298](https://github.com/pmark/arcadia/issues/2298), [#2299](https://github.com/pmark/arcadia/issues/2299), [#2300](https://github.com/pmark/arcadia/issues/2300), [#2301](https://github.com/pmark/arcadia/issues/2301), [#2302](https://github.com/pmark/arcadia/issues/2302), [#2303](https://github.com/pmark/arcadia/issues/2303), [#2304](https://github.com/pmark/arcadia/issues/2304), [#2305](https://github.com/pmark/arcadia/issues/2305)

Evidence for each is in [changes.json](changes.json) under `refresh_20261111.closure_candidates`. Re-check each at the current base first.

### Governed Actions whose Issue is closed (Agent Ask proposals)

42 distinct unfinished Actions across 10 Plans (53 Action–Issue pairs) point at a closed or fixed Issue. The active Plan's current Action `truncate-torn-journal-tail-by-byte-offset` (#749) and `report-cut-work-monitor-attention-lines` (#2011) are both fixed on main (`ad48f90fa`, `a03559b0b`). One `arcadia agent-ask preview` proposal per Plan (`intent: proposal`, `requested_authority: propose`) asks for completion with proof or withdrawal; a closed Issue alone proves nothing about acceptance. Receipts:

- `agentask_84fc1691428f356f82` (20 Actions, bootstrap-managed-production-to-build-flight-dec)
- `agentask_3e6a0f7da237e773f9` (2 Actions, burn-down-three-small-verified-bug-issues-in-una)
- `agentask_dd8fbfbc268f3acdbf` (6 Actions, deliver-one-authorized-action-through-a-persiste)
- `agentask_e22b9d3684e5c7a067` (1 Action, execute-one-approved-named-run-safely-with-produ)
- `agentask_eaaa8dc57f688a849c` (3 Actions, guard-the-operator-s-machine-against-data-loss-f)
- `agentask_73fb2684c1f87f645e` (3 Actions, make-ask-the-superpower-tool-for-planning-data-a)
- `agentask_fe597599ebfbe3590f` (1 Action, recover-completed-governance-overlap-in-protecte)
- `agentask_0e8c34cf8b94c81d1e` (1 Action, redesign-the-phone-dashboard-into-one-judgment-h)
- `agentask_bd321c5e68fc2514ed` (1 Action, seven-verified-settlement-queue-and-preservation)
- `agentask_819f4f650d2b20af30` (4 Actions, unify-interactive-and-unattended-coordination-wi)

Exact Action and Issue pairs are in `changes.json` under `refresh_20261111.action_proposals`.

## What the operator needs to know

1. **The backlog is smaller than it looks.** Of 344 open Issues, 69 mirror Actions already marked done, and 18 more look fixed and 8 are duplicates, so 95 are closure candidates.
2. **Bugs are real but none is catastrophic.** 177 Issues read as bugs, and only 60 carry the `bug` label. Of the 139 Issues checked in code, 80 are present, and 76 of those are classified as bugs. 17 are S2 (a run fails safe but needs recovery) and none is S1.
3. **The biggest unknown isn't in the backlog.** Unattended production has so far merged only tests and docs, so nobody has seen what a general Plan hits end to end. Fixing these bugs will help, but the first general Plan run will find others. The three-bug Plan ([PR 2177](https://github.com/pmark/arcadia/pull/2177)) is the cheapest way to find out.
4. **Source fixes can't merge unattended yet.** `isWorkerMergeSafePath` (`src/production/workerMerge.ts:212`) allows only tests and ordinary docs. Every batch below except BT needs that operator Decision or a gap merge per Action.
5. **Bugs arrive faster than a small allocation can clear them.** About 30 bug-shaped Issues filed in each of the last two weeks are still open, 11 to 12 of them S2 or worse. Much of that is review follow-ups, so what gets filed matters as much as what gets fixed.
6. **Relay isn't yet a conversation.** The sky, overlay and routes exist. Answers, lookups, the menu, the server thread, and any way to answer or stop from Relay don't. Six new defects and 15 proposals now hold the gaps ([inventory](#relay-gap-inventory)).

**Owen was not launched, on a premise that turned out to be wrong.** I took OpenCode to be metered API-key billing from Decision 0118's rationale, found no Decision covering it for triage, and held it, as the brief said to for new spend. The operator corrected this on 2026-11-09: OpenCode works exactly like the Codex and Claude Code plans, with tokens allocated weekly. Whether that changes any approval gate is the operator's call, proposed in `correct-decision-0118-opencode-plan-premise-20261109`. The mechanical pass ran on Claude Haiku helpers instead, which isn't the agent the operator asked for. Arcadia still has no probe for remaining OpenCode allowance. See [How this was done](#how-this-was-done).

## Ranked batches

Ranked by what blocks reliable unattended production for general use. Each batch has one shared mechanism, and members are in dependency order. A batch becomes work only through an Agent Ask, and Rowan 3 holds Plan custody. Batches B1 to B3 total 15 Actions.

**Already owned, so not queued again:**

- **Three-bug Plan** (Rowan 3): [PR 2177](https://github.com/pmark/arcadia/pull/2177) holds the draft Plan, and fixes are open for [#1366](https://github.com/pmark/arcadia/issues/1366) in [PR 2337](https://github.com/pmark/arcadia/pull/2337), [#749](https://github.com/pmark/arcadia/issues/749) in [PR 2339](https://github.com/pmark/arcadia/pull/2339) and [#2011](https://github.com/pmark/arcadia/issues/2011) in [PR 2340](https://github.com/pmark/arcadia/pull/2340).
- **Automatic handoff** (Rowan 3 helper): [#2286](https://github.com/pmark/arcadia/issues/2286) in [PR 2338](https://github.com/pmark/arcadia/pull/2338).

### B1: Plans start and hand over cleanly

**Shared mechanism:** The Plan lifecycle at its two edges: creating a draft Plan and moving from a finished Plan to the next.

Every general run crosses a Plan edge, and #2134 sends a draft Plan's Actions to a planning run. These are small. [#2160](https://github.com/pmark/arcadia/issues/2160) is two stale `current_action` values on draft Plans; it needs a governed Ask, not code.

| Order | Issue | Sev | Size | Fix | Acceptance |
|---|---|---|---|---|---|
| 1 | [#2134](https://github.com/pmark/arcadia/issues/2134) | S2 | S | Emit `execution: <route>` in newDraftPlan's actionLines (src/ask/settlement.ts ~2727) when action.execution is set. | Settle an untargeted intent: plan Ask whose children set execution: build and assert the written draft Plan Actions carry it. |
| 2 | [#2278](https://github.com/pmark/arcadia/issues/2278) | S2 | S | In src/ask/settlement.ts activation branch (~line 686) keep the outgoing Plan's status when it is complete or every Action is done, and adjust the effect line. | Settlement test: activate a successor while the outgoing Plan is complete and assert its front matter stays status: complete; unfinished Plan still returns to draft. |
| 3 | [#2018](https://github.com/pmark/arcadia/issues/2018) | S2 | S | Add the activate subject to isOwnPointerCommit in pointerReconcile.ts | sync over a local activate commit reconciles |
| 4 | [#2273](https://github.com/pmark/arcadia/issues/2273) | S3 | S | Call the scope-complete check in src/production/tick.ts when the active Plan has no current_action | one scope_complete event and one ping after a Plan's last in-scope Action merges |
| 5 | [#2159](https://github.com/pmark/arcadia/issues/2159) | S4 | XS | Name 'arcadia go --apply' in SCOPE_DRIFT_REMEDY (src/production/policy.ts:894) and in the operator procedure docs. | SCOPE_DRIFT_REMEDY text and the operator guide both contain 'arcadia go --apply'. |

**Common validation:** Settlement and pointer-reconcile tests, then one replay across a Plan boundary.

**Also covers:** [#2160](https://github.com/pmark/arcadia/issues/2160).

### B2: A run stops for the right reason and says so

**Shared mechanism:** Escalation and hold state for preserved candidates, pending Asks and dead sign-ins.

When a run stops, the operator should see one true reason. Today a refused candidate can burn its repair budget and lose its escalation, and a pending Ask can hold a launch while the card says ready.

| Order | Issue | Sev | Size | Fix | Acceptance |
|---|---|---|---|---|---|
| 1 | [#1670](https://github.com/pmark/arcadia/issues/1670) | S2 | M | Hold launch quietly in src/production/tick.ts while a not-landed settled candidate receipt exists, or keep the escalation | replay chain with a refused settled candidate keeps self_settled_completion_refused and burns no repair attempts |
| 2 | [#1646](https://github.com/pmark/arcadia/issues/1646) | S3 | S | Record the completionSettlementNotInCandidate escalation in runSessionReconcileCommand in src/commands/advance.ts | session reconcile of a refused settled candidate leaves an escalation row |
| 3 | [#2102](https://github.com/pmark/arcadia/issues/2102) | S2 | S | Treat a complete Ask whose derived auto-settle proposal is settled as settled in src/ask/settlement.ts or exempt it in operatorGate.ts | resolveOperatorGate for that Action returns no blocking item when the derived proposal is settled; card preview agrees |
| 4 | [#2038](https://github.com/pmark/arcadia/issues/2038) | S2 | M | Make scripts/start-run.sh refuse on a blocking gate item for the pinned Action and read the reviewer's capacity | a start-run preflight test with a pending Ask naming the pinned Action refuses |
| 5 | [#1249](https://github.com/pmark/arcadia/issues/1249) | S2 | M | src/production/tick.ts: escalate once after N consecutive sign-in exits or ~6h, clear on successful launch; use last result event in reconciliation.ts | fixture with repeated sign-in exits opens exactly one escalation and clears on a successful launch without consuming attempt |

**Common validation:** `pnpm production-replay` on a refused settled candidate, a pending Ask and a dead sign-in.

### B3: Main can move during a run

**Shared mechanism:** How the worker reconciles local main and candidates when main moves or holds something foreign.

General use means main moves during a run. [#2021](https://github.com/pmark/arcadia/issues/2021) and [#2029](https://github.com/pmark/arcadia/issues/2029) may need an operator Decision on the route, so settle those two first or split them out. Several verdicts here rest on a search finding no guard, so re-read before building.

| Order | Issue | Sev | Size | Fix | Acceptance |
|---|---|---|---|---|---|
| 1 | [#2103](https://github.com/pmark/arcadia/issues/2103) | S2 | S | Refuse a squash merge route for worker candidates and/or run base sync while Off | hand squash of a worker candidate is refused with the --merge remedy, or local main is healed before START |
| 2 | [#2104](https://github.com/pmark/arcadia/issues/2104) | S2 | M | Teach the governed-record check in src/qa/prReview.ts to accept a recognized reconcile commit | a candidate branched from a worker reconcile commit passes the governed-record completeness check |
| 3 | [#2021](https://github.com/pmark/arcadia/issues/2021) | S2 | M | Add a validated step or Decision route to preserve a foreign local commit on a branch and name it in the escalation | base_not_synced escalation names an executable governed route |
| 4 | [#2029](https://github.com/pmark/arcadia/issues/2029) | S3 | S | Route go through the worker resolver (operator Decision) or avoid writing updated: beside current_action | go succeeds on local pointer commits across an updated: change |
| 5 | [#2093](https://github.com/pmark/arcadia/issues/2093) | S2 | S | Exclude proposal-intent Asks from the preservation snapshot in candidateSnapshot.ts | a proposal Ask written under .arcadia/asks is not in the preserved candidate |

**Common validation:** Replay with a merge to main mid-run and a foreign local commit.

### B4: Settlement and queue integrity (the existing seven-bug Plan, re-cut)

**Shared mechanism:** Writers of governed documents and queue state. Uses the existing draft Plan; no new Plan.

These do real damage when they fire, though only duplicate Decision numbers is still recurring. Amend the existing draft Plan through an Ask: complete or retire the two fixed Actions and keep these five. #1011's items 3 and 5 and #960's item 5 weren't checked.

| Order | Issue | Sev | Size | Fix | Acceptance |
|---|---|---|---|---|---|
| 1 | [#960](https://github.com/pmark/arcadia/issues/960) | S2 | S | In developedForSupersededInput (roleLineage.ts:119) fail closed when any passed row cannot be attributed; log or require pushed for local-only. | Test: a passed development row with unparseable terminal_receipt_json keeps the claim. |
| 2 | [#1022](https://github.com/pmark/arcadia/issues/1022) | S3 | S | In arrangeActionOrder/moveActionOrder (src/dispatch/order.ts) preserve or refuse on position rows absent from currentKeys and record them in the receipt. | Test: a position row for an invisible Project survives an arrange (or arrange refuses) and appears in the receipt. |
| 3 | [#1011](https://github.com/pmark/arcadia/issues/1011) | S2 | S | Add --no-renames and restrict ignored intake to archive add / pending delete in settlement.ts:2042; separate cleanup try/catch and bounded exec. | Test: git mv of a Decision into .arcadia/asks is refused as not the canonical settlement. |
| 4 | [#1187](https://github.com/pmark/arcadia/issues/1187) | S3 | M | Allocate from local plus origin/main and refuse an existing number in addDecisionMutation (settlement.ts:2642) and decision.ts:843; add a duplicate-number check. | Test: with origin/main holding 0007, a worktree settlement allocates 0008; writing a duplicate number is refused. |
| 5 | [#1160](https://github.com/pmark/arcadia/issues/1160) | S3 | S | Always JSON-quote free-text scalars in settlement writers (src/ask/settlement.ts, src/docs/frontmatter.ts) and add round-trip tests. | Round-trip test for true, null, 123, '[x] done', '{a}' on title, next_action and acceptance. |

**Common validation:** Each Action's listed tests plus `pnpm fast-rehearsal`, as the Plan already requires.

**Also covers:** [#1270](https://github.com/pmark/arcadia/issues/1270), [#1273](https://github.com/pmark/arcadia/issues/1273), [#1274](https://github.com/pmark/arcadia/issues/1274), [#1275](https://github.com/pmark/arcadia/issues/1275), [#1276](https://github.com/pmark/arcadia/issues/1276), [#1731](https://github.com/pmark/arcadia/issues/1731), [#1176](https://github.com/pmark/arcadia/issues/1176).

### B5: CI stops eating runs

**Shared mechanism:** Required CI jobs that fail or time out for reasons unrelated to the change.

A candidate that fails CI for no reason stalls a serial run. #2341's cause (stale shard weights) is the Issue's inference, and #2284's mechanism is unproven, so the first step of each is confirming it. `.github/` and `scripts/` are outside the worker-merge allowlist.

| Order | Issue | Sev | Size | Fix | Acceptance |
|---|---|---|---|---|---|
| 1 | [#2341](https://github.com/pmark/arcadia/issues/2341) | S3 | S | Refresh scripts/ci-test-weights.json from a recent CI run and compare per-shard spread (optionally add a weight-refresh script). | After refreshing weights, `node scripts/ci-test-shard.mjs --check 8` passes and the slowest shard's CI wall time is well under 8 minutes across several runs. |
| 2 | [#1347](https://github.com/pmark/arcadia/issues/1347) | S3 | S | In .github/workflows/ci.yml pin/cache the pnpm download (e.g. cache COREPACK_HOME or bounded retry step) without lengthening timeouts. | Bootstrap step has a cache or bounded retry and CI passes with it. |
| 3 | [#2284](https://github.com/pmark/arcadia/issues/2284) | S3 | S | In scripts/dashboard-build.sh after line 136 `wait` on smoke_pid (and/or raise the test's smoke deadline) once a failure shows the output. | Repeated runs of tests/dashboard-live.test.ts in parallel with load show no exit 1 on the second build. |

**Common validation:** Several consecutive green runs with the slowest shard well under its limit.

**Also covers:** [#1000](https://github.com/pmark/arcadia/issues/1000), [#1460](https://github.com/pmark/arcadia/issues/1460), [#1907](https://github.com/pmark/arcadia/issues/1907).

### B6: An offsite operator can act

**Shared mechanism:** Review and approval paths that strand or mislead an operator away from the host.

The operator is offsite and shouldn't need the host. These strand or mislead an offsite operator. Each helps during runs but none stops one. [#1627](https://github.com/pmark/arcadia/issues/1627) and [#852](https://github.com/pmark/arcadia/issues/852) are related, validity unknown; check them when this batch starts.

| Order | Issue | Sev | Size | Fix | Acceptance |
|---|---|---|---|---|---|
| 1 | [#1572](https://github.com/pmark/arcadia/issues/1572) | S3 | M | Add a /production rerun-review control in apps/dashboard (production-control route) and change the remedy text in src/production/reviewRepair.ts to point at it. | A gated review-repair row shows a /production button that reruns the review, working while production is Off for a PR with a readiness grant. |
| 2 | [#823](https://github.com/pmark/arcadia/issues/823) | S3 | S | In src/ask/settlement.ts include queueRevision in the fingerprint only when arrangeQueue/queue mutation is involved, with a regression test. | Unrelated queue movement between preview and apply does not refuse an inactive-Plan-only settlement, while real queue changes still do. |
| 3 | [#1624](https://github.com/pmark/arcadia/issues/1624) | S3 | S | In src/commands/review.ts approve, special-case IndependentPullRequest* intents to record acknowledgement without queueing a run and state the real next step. | Approving a code-review evidence item queues no execution run and its notification names the repair loop or operator merge. |
| 4 | [#1759](https://github.com/pmark/arcadia/issues/1759) | S3 | S | In dashboard-ui.tsx ReviewCard render a packet-only Approve with noExecute:true for CodexBuildPacketApproval items and wire it in app/review/page.tsx. | On /review a build-packet item shows a packet-only Approve that posts noExecute:true and succeeds. |

**Common validation:** Each acceptance exercised on the dashboard at phone width.

### B7: The tick stays responsive and reconciliation tells the truth

**Shared mechanism:** What the tick and Session reconciliation accept and how long they block.

Accepting a completion without its evidence ([#1874](https://github.com/pmark/arcadia/issues/1874)) is the most serious here, though it's reached only for an already-settled Action. [#1606](https://github.com/pmark/arcadia/issues/1606) is large, so make it a design Action or defer it. [#1012](https://github.com/pmark/arcadia/issues/1012) needs a Decision.

| Order | Issue | Sev | Size | Fix | Acceptance |
|---|---|---|---|---|---|
| 1 | [#1874](https://github.com/pmark/arcadia/issues/1874) | S2 | M | Run the managed evidence gate before the done short-circuit in classifyExitOutcome. | Reconcile with a done Action and a missing capability contract returns `incomplete_resumable`. |
| 2 | [#1614](https://github.com/pmark/arcadia/issues/1614) | S3 | S | Add a revision to the worker heartbeat in transportHeartbeat.ts and refuse the card when it differs from main HEAD | grant precondition refuses a worker heartbeat with a stale revision |
| 3 | [#1702](https://github.com/pmark/arcadia/issues/1702) | S3 | M | Let listPendingTerminalCandidates in terminalCandidates.ts release a stale exhaustion hold when canonical review and QA bindings are current | a held candidate with current passing verdicts is listed for integration; independent current candidate keeps precedence |
| 4 | [#1012](https://github.com/pmark/arcadia/issues/1012) | S2 | M | Refuse launch in attemptProjectLaunch when the integration grant or delegation has lapsed (needs a Decision) | it.fails test flips to it and passes |
| 5 | [#1606](https://github.com/pmark/arcadia/issues/1606) | S3 | L | Move long validation/review in src/production/tick.ts into pending steps with receipts, as the issue asks | a tick containing a 120s review step returns in bounded time and a later tick consumes the receipt |

**Common validation:** Tick and reconciliation tests; a replay with a long review step.

**Also covers:** [#1875](https://github.com/pmark/arcadia/issues/1875).

### B8: Relay's replies are honest

**Shared mechanism:** Defects that make Relay's reply or view wrong today, before any new Relay capability.

These don't block production. They rank here because the operator asked for Relay's gaps to be found and queued, and because most of them make Relay's replies wrong today. #2343 and #2344 land with the first slice; the rest stand alone.

| Order | Issue | Sev | Size | Fix | Acceptance |
|---|---|---|---|---|---|
| 1 | [#2343](https://github.com/pmark/arcadia/issues/2343) | new | S | Show the compact status with freshness in Workspace and Discord. | See the Issue. |
| 2 | [#2344](https://github.com/pmark/arcadia/issues/2344) | new | S | Route plain questions to an answer or one clarifying reply, with no review item. | See the Issue. |
| 3 | [#2345](https://github.com/pmark/arcadia/issues/2345) | new | S | Harden: refuse when the allowlist is empty, with a documented setup step. Today's fail-open is deliberate, with a startup warning and channel gating. | See the Issue. |
| 4 | [#2346](https://github.com/pmark/arcadia/issues/2346) | new | S | Replace the native modal so Relay stays reachable with an Artifact open. | See the Issue. |
| 5 | [#2347](https://github.com/pmark/arcadia/issues/2347) | new | S | Read the Journey cheaply and never draw a stopped Plan as open. | See the Issue. |
| 6 | [#2348](https://github.com/pmark/arcadia/issues/2348) | new | S | Rank production Off first for stop questions, in a checked-in case set. | See the Issue. |

**Common validation:** A Playwright pass at phone and desktop width, plus the routing near-misses.

**Also covers:** [#2119](https://github.com/pmark/arcadia/issues/2119).

### BT: Test-only fixes production can merge today

**Shared mechanism:** Flaky or time-coupled tests whose fix touches only tests, inside today's worker-merge allowlist.

The only batch production can run and merge today. It fixes nothing that blocks general use, but it's a cheap way to keep runs going. [#1742](https://github.com/pmark/arcadia/issues/1742) wasn't checked; confirm it first.

| Order | Issue | Sev | Size | Fix | Acceptance |
|---|---|---|---|---|---|
| 1 | [#2314](https://github.com/pmark/arcadia/issues/2314) | S3 | XS | In tests/system-tmux-long-command.test.ts write to a temp path in the provider script and renameSync to out (both occurrences). | Test passes under repeated load runs with the exact 64 KiB assertion kept. |
| 2 | [#1327](https://github.com/pmark/arcadia/issues/1327) | S3 | XS | Strip inherited Claude login tokens from the logged-out fixtures' test process. | The logged-out cases pass with a token in the parent environment. |
| 3 | [#1742](https://github.com/pmark/arcadia/issues/1742) | S3 | S | Decouple the copied Grant fixtures from the historical card's expiry. | The Grant test files pass after the card's expiry date. |

**Common validation:** The named tests pass under load on repeated runs.


**After these:** the other confirmed-present bugs are in [bug-table.md](bug-table.md) with route `fix`. They include one more S2, [#1909](https://github.com/pmark/arcadia/issues/1909), on a legacy run path. The likeliest to matter next are [#847](https://github.com/pmark/arcadia/issues/847) (the unattended profile blocks local browser audits), [#1765](https://github.com/pmark/arcadia/issues/1765) (a lint cap reported wrongly) and [#1903](https://github.com/pmark/arcadia/issues/1903) (a slow opening brief can block a request).

## Existing Plans, so nothing is queued twice

**Seven-bug Plan** (`seven-verified-settlement-queue-and-preservation-integrity-bugs-are-fixed-and`, draft, all Actions open):

| Action | Issues | State at this base |
|---|---|---|
| `keep-claim-when-passed-attempt-receipt-is-unparseable` | [#960](https://github.com/pmark/arcadia/issues/960), mirror [#1270](https://github.com/pmark/arcadia/issues/1270) | Present. Keep in B4. |
| `settle-superseded-decision-ask-rejection` | [#1173](https://github.com/pmark/arcadia/issues/1173), mirror [#1271](https://github.com/pmark/arcadia/issues/1271) | **Already fixed** with a test (`tests/agent-ask-settlement.test.ts:2887`). Needs a completion Ask, not a build. |
| `amend-action-consumes-block-scalar-and-literal-ids` | [#1213](https://github.com/pmark/arcadia/issues/1213) item 1, mirror [#1272](https://github.com/pmark/arcadia/issues/1272) | **Already fixed** with tests. #1213's item 2 remains, at S4. |
| `keep-queue-positions-of-projects-not-visible-at-arrange` | [#1022](https://github.com/pmark/arcadia/issues/1022), mirror [#1273](https://github.com/pmark/arcadia/issues/1273) | Present. Keep in B4. |
| `refuse-hidden-renames-in-committed-completion-replay` | [#1011](https://github.com/pmark/arcadia/issues/1011), mirror [#1274](https://github.com/pmark/arcadia/issues/1274) | Present. Keep in B4. |
| `allocate-decision-numbers-from-origin-and-refuse-duplicates` | [#1187](https://github.com/pmark/arcadia/issues/1187), mirror [#1275](https://github.com/pmark/arcadia/issues/1275), [#1176](https://github.com/pmark/arcadia/issues/1176) | Present, and still recurring (0191 is new). Keep in B4. |
| `write-yaml-scalars-that-round-trip-as-strings` | [#1160](https://github.com/pmark/arcadia/issues/1160), mirror [#1276](https://github.com/pmark/arcadia/issues/1276), [#1731](https://github.com/pmark/arcadia/issues/1731) | Present. Keep in B4. |

So this Plan is really five bugs. Running it unchanged would spend two Actions on work that's done.

**Other overlaps:**

- [#2134](https://github.com/pmark/arcadia/issues/2134) is in B1. PR 2177 worked around it by amending, and Rowan 3's Plan doesn't need the fix.
- [PR 2228](https://github.com/pmark/arcadia/pull/2228) holds the draft Plan `relay-use-drives-planned-work-that-production-performs`. It's the loop that would route Relay gaps into work; this inventory doesn't replace it.
- `operator-to-do-list-with-ask-only-input` has four open Actions ([#1043](https://github.com/pmark/arcadia/issues/1043)). `ask-golden-set-and-vanish-report` overlaps Relay's scorecard, and `ask-local-model-tiebreaker` overlaps the companion. Both proposals name the overlap.

**Two-way reconciliation** ([reconciliation.json](reconciliation.json)):

| Finding | Count |
|---|---|
| Open Issues with no Action | 202 |
| Open Issues whose linked Actions are all done | 96 (69 mirrors, 27 by explicit reference) |
| Linked to an unfinished Action | 43 |
| Fix landed, Action unfinished | 3 ([#1173](https://github.com/pmark/arcadia/issues/1173), [#1271](https://github.com/pmark/arcadia/issues/1271), [#1272](https://github.com/pmark/arcadia/issues/1272)) |
| Unfinished Action citing a closed Issue | 50, mostly in the old bootstrap Plan |
| Action citing a pull request as if it were an Issue | 2 |

I didn't compare Issue requirements with Action acceptance beyond the checked Issues, and I didn't search for defect Actions missing an Issue reference.

## Closure candidates

None of these has been closed. [changes.json](changes.json) lists each with the proof still needed, and each must be re-checked at the current base first.

- **69 Action mirrors.** Decision 0081 allows closing them once each Action's acceptance is re-verified at the governed base. That re-verification hasn't been done.
- **18 resolved:** [#978](https://github.com/pmark/arcadia/issues/978), [#1041](https://github.com/pmark/arcadia/issues/1041), [#1129](https://github.com/pmark/arcadia/issues/1129), [#1168](https://github.com/pmark/arcadia/issues/1168), [#1173](https://github.com/pmark/arcadia/issues/1173), [#1190](https://github.com/pmark/arcadia/issues/1190), [#1271](https://github.com/pmark/arcadia/issues/1271), [#1272](https://github.com/pmark/arcadia/issues/1272), [#1414](https://github.com/pmark/arcadia/issues/1414), [#1419](https://github.com/pmark/arcadia/issues/1419), [#1536](https://github.com/pmark/arcadia/issues/1536), [#1695](https://github.com/pmark/arcadia/issues/1695), [#1738](https://github.com/pmark/arcadia/issues/1738), [#1744](https://github.com/pmark/arcadia/issues/1744), [#1800](https://github.com/pmark/arcadia/issues/1800), [#1920](https://github.com/pmark/arcadia/issues/1920), [#2084](https://github.com/pmark/arcadia/issues/2084), [#2154](https://github.com/pmark/arcadia/issues/2154). Each row's caveat is in the file. For example, [#1744](https://github.com/pmark/arcadia/issues/1744)'s separate request for a manual Off recovery route isn't covered, and [#1190](https://github.com/pmark/arcadia/issues/1190) resolves only the To-do surface, with the Review page in [#1759](https://github.com/pmark/arcadia/issues/1759).
- **8 duplicates:** [#1000](https://github.com/pmark/arcadia/issues/1000), [#1270](https://github.com/pmark/arcadia/issues/1270), [#1273](https://github.com/pmark/arcadia/issues/1273), [#1274](https://github.com/pmark/arcadia/issues/1274), [#1275](https://github.com/pmark/arcadia/issues/1275), [#1276](https://github.com/pmark/arcadia/issues/1276), [#1460](https://github.com/pmark/arcadia/issues/1460), [#1698](https://github.com/pmark/arcadia/issues/1698). The mirror Issues in that list stay useful until the seven-bug Plan runs, so close them with it.

**Not proposed for closing, though helpers called them resolved:** [#1032](https://github.com/pmark/arcadia/issues/1032), [#1155](https://github.com/pmark/arcadia/issues/1155), [#1603](https://github.com/pmark/arcadia/issues/1603), [#1878](https://github.com/pmark/arcadia/issues/1878), [#1016](https://github.com/pmark/arcadia/issues/1016), [#1339](https://github.com/pmark/arcadia/issues/1339), [#1340](https://github.com/pmark/arcadia/issues/1340), [#1357](https://github.com/pmark/arcadia/issues/1357), [#1615](https://github.com/pmark/arcadia/issues/1615), [#1461](https://github.com/pmark/arcadia/issues/1461), [#1628](https://github.com/pmark/arcadia/issues/1628), [#1320](https://github.com/pmark/arcadia/issues/1320) and [#1189](https://github.com/pmark/arcadia/issues/1189). Their proof was thin or partial, so they stay `unknown` with the reason in their row. [#1176](https://github.com/pmark/arcadia/issues/1176) also stays open: [#1187](https://github.com/pmark/arcadia/issues/1187) prevents new duplicate numbers, but the two existing 0100 Decisions are still there.

The same file proposes adding the `bug` label to the 120 bug-shaped Issues without it. That rests mostly on helper classification from title and body, so review it before applying.

## Weekly allocation: options for the operator

Bugs as tech debt with a fixed share of each week is the operator's policy to set. It's proposed in Agent Ask `weekly-bug-allocation-policy-20261109` (`agentask_9661ac957a81696171`), and nothing is adopted here. That Ask says 79 confirmed bugs and about 16 weeks. It was filed before review, and it counted every present Issue as a bug; 76 and about 16 weeks are the current figures.

| Option | What it means | Consequence |
|---|---|---|
| **A. Surge, then floor** (recommended) | B1 to B3 take first claim, about 15 Actions. After that, 20% of production Actions, at least 5 a week. | The blockers clear soonest, which is the stated goal. Features and Relay builds wait during the surge. |
| **B. Flat 5 a week** | 5 bug Actions every week, whatever else is running. | Predictable and cheap. The 76 bugs confirmed so far take about 16 weeks with no new ones, assuming one Action per Issue, and it can't keep up with S2 inflow of 11 to 12 a week. |
| **C. 20% with no minimum** | A fifth of production Actions go to bugs. | Scales with capacity. A quiet week fixes nothing, and blockers wait their turn. |
| **D. No allocation** | Bugs compete with features Plan by Plan. | No new rule. The backlog keeps growing, as it has. |

**What the numbers can't tell you yet:** source-fix throughput. Last night's 18 merges were narrow test pins, and a source fix is larger and needs a merge route. Option A's surge length is unmeasured, so measure it on the first batch and revisit.

**Whichever is chosen,** filing needs attention too. Review follow-ups are 40 of the classified Issues. Worth considering: label follow-ups separately and count only S1 and S2 toward the allocation's target.

## Relay gap inventory

Compared against `docs/design/relay/`, the [proposal](../../proposals/relay.md), the [handoff](../handoffs/20261103T0000Z-relay-proposal.md) and the [conversational workspace design](../../design/arcadia-conversational-workspace.md), then read against the code at this base.

**What exists:** the sky on every Workspace view, weather rhythm, the modal overlay, routes as the context layer, a lighter Decision page, the receipt loop with idempotent request ids, and `arcadia way lookup`. The design record shows no phone test of the overlay, routes or weather since they merged, so the operator's judgment of items 3 to 5 is still open.

**New Issues, filed in `pmark/arcadia`:**

| Issue | What's wrong |
|---|---|
| [#2343](https://github.com/pmark/arcadia/issues/2343) | A status Ask replies "Status shown." and shows no status |
| [#2344](https://github.com/pmark/arcadia/issues/2344) | Plain questions come back as low-confidence captures and can create To-do items |
| [#2345](https://github.com/pmark/arcadia/issues/2345) | With an empty allowlist, the Discord bot accepts any member in its channels. This is deliberate today, with a startup warning, so it's hardening the Relay design requires |
| [#2346](https://github.com/pmark/arcadia/issues/2346) | The Artifact viewer's native modal blocks Relay |
| [#2347](https://github.com/pmark/arcadia/issues/2347) | A route reads "Open" while the Journey says the Plan stopped |
| [#2348](https://github.com/pmark/arcadia/issues/2348) | Way lookup answers "how do I stop everything" with session-ending guidance |

**Every requirement, against what's built:**

| Requirement | State | Evidence | Held by |
|---|---|---|---|
| REQ-001 Way knowledge | Partial | Probe scored 73% against a 90% default; #2348 reproduces the stopping failure | `relay-way-knowledge-remeasure`, #2013, #2348 |
| REQ-002 Operate by talking | Partial | No chosen concept. Status and review routes run but show no answer (#2343), and no other lookups exist | `relay-first-slice-plan`, `relay-idea-to-plan` |
| REQ-003 One conversation | Missing | Thread is browser storage, five items (`workspace-ask.tsx:86`) | `relay-server-thread` |
| REQ-004 Attention | Partial | Questions become To-do items; 493 pending proposals | #2344, `pending-proposal-backlog-disposition` |
| REQ-005 Group channels | Missing | C-019, C-020 and C-022 are missing, C-021 conflicts | `relay-group-channels-later` |
| REQ-006 Enforced limit | Partial | No route declares an effect; `arcadia ask` can create a Project | `relay-first-slice-plan`, #2345 |
| REQ-007 Relay mode | Exists | Skill present; the label audit (R1-F17) is unproved | `relay-design-ready-gate` |
| REQ-008 Default shell | Conflicts | Read-and-propose doesn't fit a coding session | `relay-default-shell-and-xr-later` |
| REQ-009 Direct addressing | Missing | Needs a Decision | `relay-group-channels-later` |
| REQ-010 Speed | Partial | Tap feedback measured; no budgets, and each Ask spawns the CLI | `relay-latency-budgets-and-compact-reads` |
| REQ-011 Minimal context | Unproved | Commands return 23 to 717 KB | `relay-latency-budgets-and-compact-reads` |
| REQ-012 Arbitrary text | Conflicts | Probe in #2344 | #2344, `relay-first-slice-plan` |
| REQ-013 Mostly zero cost | Partial | Ask is free; no companion | `relay-companion-and-bakeoff` |
| REQ-014 Idea to production | Partial | Draft Plan `idea-to-managed-build` predates Relay | `relay-idea-to-plan` |
| REQ-015 Status from every view | Partial | Routes can misread (#2347); a new blocker in a Blocked sky doesn't land | #2347, `relay-design-ready-gate` |
| REQ-016 View defines context | Partial | Ordinary Ask sends only the Project (`api/ask/route.ts`) | `relay-view-scope-and-cues` |
| REQ-017 Always available | Partial | Overlay is Workspace-only by 2A; blocked by the Artifact modal | #2346 |
| REQ-018 Mobile-first, XR | Partial | Phone test outstanding; no XR code | `relay-design-ready-gate`, `relay-default-shell-and-xr-later` |
| REQ-019 Off in one step | Missing | No Off control in Workspace components; operator asked "Where is the OFF button?" (S034) | Existing `propose-relay-workspace-switches-and-perpetual-rowan-20261106`, #2348 |
| REQ-020 Approvals carry | Missing | Each handoff re-asks (S035) | `relay-approval-record` |

**The operator's scenarios and the ladder that aren't covered above:**

| Gap | State | Held by |
|---|---|---|
| One question at a time, answered in Relay | Missing; needs a Decision | Existing `proposal-command-center-answer-in-place-20261107` |
| Catch up: what changed while I was away | Missing; no push or service worker either | `relay-catch-up-and-single-contact` |
| Capture a thought in five seconds | Partial; `/capture` only, no voice or share target | `relay-five-second-capture` |
| Judge what came back | Missing | `relay-judge-what-came-back` |
| Create a Project, Design or Plan by talking | Missing | `relay-idea-to-plan` |
| Rung 4, Project supervisors | Missing | `relay-resumable-supervisors` |
| Design gate: `--ready` reports 69 problems, R1's findings open, C-077 to C-082 leaning | Blocks the handoff's approved route | `relay-design-ready-gate` |

**Existing Issues that also bear on Relay:** the helpers flagged 43 Issues as Relay-relevant, including [#2119](https://github.com/pmark/arcadia/issues/2119) (fix in [PR 2121](https://github.com/pmark/arcadia/pull/2121)), [#2013](https://github.com/pmark/arcadia/issues/2013) and [#2227](https://github.com/pmark/arcadia/issues/2227). They're marked `"relay": true` in [triage.json](triage.json). [#2013](https://github.com/pmark/arcadia/issues/2013)'s STOP item is now done (`START_HERE.md:1679`), and its item 5 is confirmed open. Items 1, 2, 4, 6, 7 and 8 rest on searches that found nothing, so they're unconfirmed.

**Proposals filed** (`intent: proposal`, each a receipt that grants nothing):

| Request id | Receipt |
|---|---|
| `pending-proposal-backlog-disposition-20261109` | `agentask_7ed136ab1bbf09b5a1` |
| `relay-approval-record-20261109` | `agentask_eac726a40cb0cb1c04` |
| `relay-catch-up-and-single-contact-20261109` | `agentask_d3a7bedbfa83310680` |
| `relay-companion-and-bakeoff-20261109` | `agentask_e84581716d9bd05b19` |
| `relay-default-shell-and-xr-later-20261109` | `agentask_7b49c53b51b7acf465` |
| `relay-design-ready-gate-20261109` | `agentask_18e01da26dd2a41c5b` |
| `relay-first-slice-plan-20261109` | `agentask_6f12f21d62b26a3210` |
| `relay-five-second-capture-20261109` | `agentask_8d97156ca7486398f6` |
| `relay-group-channels-later-20261109` | `agentask_983b56f1e13a8c2fda` |
| `relay-idea-to-plan-20261109` | `agentask_a046d7a67d9f70e1a3` |
| `relay-judge-what-came-back-20261109` | `agentask_6d9aeb1e7f7168d7a6` |
| `relay-latency-budgets-and-compact-reads-20261109` | `agentask_098757f72335980efa` |
| `relay-resumable-supervisors-20261109` | `agentask_e1ab3a3e79b8edf670` |
| `relay-server-thread-20261109` | `agentask_d288f9b6a8123e28c9` |
| `relay-view-scope-and-cues-20261109` | `agentask_4f25dccff9eb3261e5` |
| `relay-way-knowledge-remeasure-20261109` | `agentask_22c6ed3bc5481ca4c8` |
| `weekly-bug-allocation-policy-20261109` | `agentask_9661ac957a81696171` |

**What this doesn't cover:** the inventory compares documents with code. Nobody drove Relay on a phone for this report, and real use will find more, which is what the loop in PR 2228 is for.

## How this was done

- **Inventory:** every open Issue, all pages. 357 open items minus 13 pull requests gives 344, matching GitHub's count, with no repeats. The skill's validator passes for coverage and row shape; it doesn't check whether evidence is true.
- **Classification:** 275 Issues read from title and body by Claude Haiku helpers, after a calibration packet I reviewed. 69 done mirrors were classified by script. Helper severity is a first guess.
- **Verification:** 139 Issues, including all 60 labelled `bug`, were checked against the code by Claude Sonnet helpers and by me. No tests ran, to keep load off the host before batch 5. Many "present" verdicts rest on reading code, and several on a search finding no guard, which is weaker; each row says which.
- **My audit:** I checked that the cited lines exist (one was past the end of its file), read the source behind seven verdicts, and downgraded eight thin "resolved" verdicts. An independent review then found one false claim, which is fixed, and five more thin verdicts, now `unknown`. It also found that helper line numbers can drift by a few lines, and it corrected two, so treat a citation as pointing near the code. I also reset helper severities on the rows I checked myself. Of the labelled bugs, 31 are present, 10 resolved, 1 duplicate and 18 unknown.
- **Not verified:** the other 205 Issues, including 69 done mirrors and about 59 unlabelled bug-shaped Issues, have validity `unknown`. Revival: when their subsystem is selected for repair. Nothing here says they are valid or invalid.
- **Usage, from the runtime's reports:** Haiku helpers about 480,000 processed tokens, Sonnet helpers about 868,000. This session's own usage isn't available. OpenCode: none.

## Artifacts

- [bug-table.md](bug-table.md): every bug, with category, subsystem, validity, severity, size and whether it blocks production.
- [triage.json](triage.json): one row per open Issue.
- [reconciliation.json](reconciliation.json): Issues and Actions in both directions.
- [changes.json](changes.json): proposed closures and labels, none applied.
