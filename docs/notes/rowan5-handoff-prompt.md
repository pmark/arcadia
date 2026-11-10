# 🚦 Rowan 4 → Rowan 5 handoff (prepared 2026-11-10 ~07:00Z, 11:00 PM PST Nov 9)

Be 🚦 Rowan 5, coordinator (Role `lead`) for pmark/arcadia, taking sole custody
from Rowan 4. The record thread is #1929. ⭐ Signal 7
(`local_15143c7c-ff38-46dd-9e99-d61e502e6057`) holds monitoring and the operator
relay; send it PR heads, wake requests and anything operator-bound. Write the
operator's times in Pacific. Verify everything below live. Approvals don't
cross sessions, except the operator's overnight direction quoted here, which
was given in Rowan 4's chat for tonight's work.

## Operator's direction (Rowan 4's chat, 2026-11-09 Pacific, recorded via `operator-interaction record`)
- "Parallel work: A."
- "No-spend Decision: A (standing no-spend, supersedes 0126)."
- "After the item 2 CI fixes, next Plan: B2 bugs as helper PRs, plus the item-3 merge-route Decision draft."
- "Overnight, keep going without me: Sonnet helpers, at most 3 at a time; merge obvious work under the standing order; hold anything that needs me for the 8 AM digest."
- About #2433: "Please enable automerge on that PR so that I can go to bed and still convey my approval and unblock tonight's work."

## State at handoff (verify live)
- Production Inactive, revision 123, epoch 66. No START card is live, and none is to be pressed.
- Plan `guard-against-paid-usage` is finished: #2392, #2394, #2395, #2396, #2397 and #2402 are merged. Follow-ups are in #2408. The new `start-run.sh` sha256 is `616f4df3…`, and new cards pin it through `arcadia start-run pins`.
- Item 2, CI:
  - #2432: shards rebalanced to 12, and the max shard is now 312s. **Merged** as `3c1d567f2`; #2341 is closed.
  - #2434: the dashboard-live smoke-port race (refs #2284). Review is APPROVE WITH NITS at `52325a075`, followed by a base merge `2c740c5fb` that keeps the operator's #2428 `it.skip`. **Merge under 0182 C when it's CLEAN.**
  - #2129: the worker re-triggers required checks once per head. Its round 2 review was BLOCK: a stale record could reopen a PR a human closed. A builder was fixing that and merging in main. **This is the operator's merge**, because it changes what the worker does to PRs. See the in-flight section for its state.
- Decisions:
  - #2433 opens Decision 0212 (parallel work) and Decision 0213 (no-spend). Review is APPROVE, and **auto-merge is armed** at `a2ebeb076`.
  - **When it merges:** record both answers as **A** through the governed answer path, in a candidate worktree. The trap: `arcadia decision approve` writes and commits to the MAIN checkout even when run from a worktree. Cherry-pick that commit to the candidate and `reset --keep` main before any push. Answers must equal an option label exactly: 0212 A is "A. Record the order now and keep the gates: …" and 0213 A is "A. Standing no-spend policy, superseding 0126".
  - An answer PR records the operator's in-chat words, so it is merged only on their instruction. The #2433 instruction covers opening these Decisions, not recording their answers, so **hold the answer PR for 8 AM**, unless it needs a merge under the same explicit words; quote them if so.
  - Then remove `"0126"` from `APPROVED_PAID_USAGE_DECISION_IDS` in `src/intelligence/config/defaults.ts`. That is a spend-authority code change, so it is the operator's merge.
- B2 (`docs/reports/bug-backlog-triage-20261109/report.md` §B2): #2435 fixes #1646 (B2 item 2). Review is **APPROVE WITH NITS** at `879d80026` (comment 6760882758); **merge it under 0182 C when it's CLEAN.** Remaining B2 items:
  - #1670: tick.ts hold.
  - #2102: settlement.ts or operatorGate.ts.
  - #2038: `start-run.sh` gate-item refusal. Changes the START executor; re-pin note.
  - #1249: tick.ts sign-in escalation.
  - #1670 and #1249 both edit tick.ts, so run them in series. At most 3 Sonnet helpers at a time.
- Item 3: draft the Decision on a merge route for source changes (`isWorkerMergeSafePath`, `src/production/workerMerge.ts`). It is a Decision Ask preview only, and the operator answers it.

## In flight at handoff
- **The #2129 builder** (a Rowan 4 subagent) reports to Rowan 4's session. Inspect the branch `claude/ci-retrigger-once-per-head-20261105` on origin for new commits. If a new head is pushed, run an independent delta review: did it fix round 2's blocking finding? Are base-merge conflicts resolved?
- Rowan 4 will relay the #2129 builder's report to Rowan 5 when it lands.

## 8 AM digest items (operator)
1. Record the 0212/0213 answers (A/A) once #2433 is on main. The answer PR is theirs to merge.
2. The PR removing the 0126 paid route: their merge.
3. #2129: their merge.
4. #2434 fixes the smoke-port race behind #2284. Re-enable the quarantined dashboard-live case from #2428? A: yes. B: keep it skipped.
5. The item-3 merge-route Decision: theirs to answer once it is drafted.

## Known traps
- Bash calls don't share exported environment variables. Put the `GIT_AUTHOR_*`/`GIT_COMMITTER_*` prefix on the same command as every git commit or merge. Rowan 4 nearly committed under the operator's identity, and one helper did (`50d7f1084`, disclosed).
- The worker runs `TMPDIR` differently in and out of the sandbox, so pass scratch files by absolute path.
- Main moves often (Field Notes and Codex sessions). Expect `MISSION_LOG.md` conflicts. Resolve them by keeping both entries.
- Helpers can leave background test loops running. Stop them with TaskStop when they report.
- A unit shard can still time out at 10m. Read the annotation, then rerun the failed jobs once per head.

— Claudia Atlas <claudia.atlas@agents.arcadia.local>
