# Current strategy: Run what works, prove what's next

Adopted 2026-11-22. The operator chose this route and typed "yes" to it in Signal 18's chat, then pressed standing grant `standing-grant-20261122a`. The machine-readable record is [`current.json`](current.json). It sets what day-lane work builds and what may merge. It changes no Plan, queue or authority: Decisions, the active Plan and CONSTITUTION.md still govern.

Sources: the advisor's stable-versus-next report (`workspaces/advice-stable-vs-next-20261122.md`) and the playbook (`workspaces/playbook-to-unattended-production.md`). Both are host-local files in the workspaces folder beside this repository, not in it.

## The idea

Production runs a frozen engine, inside the envelope where it has worked: one Action at a time, simple test-only work. The next engine version is built beside it, and it replaces the running engine only after proof.

## Phase 1: Freeze and prove (from 2026-11-22; continued by the Wednesday checkpoint verdict below)

- **Engine frozen** at `a5f041066`. A PR that changes an engine path merges only as a fix for a named failed-night cause. Engine paths are the runtime paths (`src`, `scripts`, `apps`, `config`, `database`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`) plus the freeze's `extraPaths` (`mise.toml`, `mise.lock`, `pnpm-workspace.yaml`, `schemas`). Production worker candidates (the night lane) are exempt.
- **Each night** the timer tries first. If it has not pressed by 9 PM, Signal pings once and the operator presses (route A2). Supervised nights are recorded separately and never count as clean.
- **Builders** fix the named causes (#2976 to #2978). They also build the release pin (B18a), the golden corpus and the two-cycle replay. Those three are built and reviewed now, but a PR of theirs that touches an engine path **waits, open, for the checkpoint**. It never uses the `phase-cause` label, which is only for failed-night causes and the PRs a checkpoint verdict admits (below). Work that touches no engine path (tests, docs) merges as usual. B6a to B6c (handoff at 400k) wait too, unless Rowan shows that their files are outside the engine paths.
- **The operator sees:** a morning result, a 9 PM ping only if needed, the Monday noon message, and the pin Decision to merge. Several questions a day means the plan is failing.

## Wednesday 8 AM checkpoint

| Result | Next phase |
|---|---|
| Two clean nights with no operator press | **Pin and promote:** write the first pin; engine changes ship as tested releases at most twice a week |
| Nights delivered only when the operator pressed | **Stay in Freeze and prove**, focused on the timer loop |
| Supervised nights failed on test-only work | **Fall back:** supervised only; investigate the pipeline before any loop work |

Then: three clean nights in a row on real work, with the four NORTH_STAR gates live, is done.

## Checkpoint verdict (Wed 2026-11-25): stay in Freeze and prove, focused on the timer loop

The operator answered the checkpoint menu with "1A 2A" (verbatim, a human-origin turn at 2026-11-25T17:01:37Z, 9:01 AM Pacific, in Signal 19's session `ed0f9865-5cd6-4d1b-824a-7ef2867a3e98`, uuid `4e9467f9-d440-4c55-a3bf-7fb393df3619`). Option 1A read: "stay frozen and prove, focused on the timer's self-pressing loop. The verdict also lists the reviewed timer-loop fixes as allowed through the freeze: #3033, #3036, #3006, #3028, #3025 and #2980." Every night delivered, but only when he pressed, which is the table's second row.

- **The phase stays `freeze-and-prove`** and the engine stays frozen at `a5f041066`. Nothing else in `current.json` changes.
- **Admitted through the freeze** (each Issue is the PR's stated cause; the guard admits a PR only by its `Phase-cause: #N` line and that Issue's `phase-cause` label, so Rowan or Signal labels these Issues and adds any missing line after this verdict merges):

  | PR | What it fixes | Phase-cause |
  |---|---|---|
  | #3033 | the host timer stops a handed-off predecessor; START tolerates it meanwhile | #3029 |
  | #3036 | START waits within a bound for a fresh worker heartbeat | #3030 |
  | #3006 | run-mode re-derivation leaves out the run's own press | #3005 |
  | #3028 | dispatch fresh instead of resuming a stale-base candidate | #3015 |
  | #3025 | refuse a met failing-first criterion whose proof contradicts it | #3017 |
  | #2980 | an expired, consumed or retired START card hold stops blocking | #2976 |

- **Only these six PRs are admitted.** Labelling their cause Issues admits nothing else: another engine PR that cites one of these Issues is not admitted by this verdict, and the morning audit checks each cited cause against its PR. Labels stay on after the merges, because the track check's audit re-judges merged PRs by their Issues' current labels.
- **Still frozen:** the Workspace Plan picker PRs #2996 and #3039, until the next step up.
- **The guard after a verdict:** once `checkpoint.verdict` is set, the lint and track jobs stop judging later changes to the strategy ("the next change starts the next phase"). Until a new checkpoint is recorded, a PR that loosens the strategy is not machine-refused: it is the operator's merge, checked against his words.
- Option 2A (one "merge all" in Rowan g7's simulated order, then one release install) is the operator's merge instruction for the admitted PRs; it is carried out PR by PR under the usual exact-head review, green-check and production-Off gates, and changes nothing here.

## Admission (Thu 2026-11-26): "1B 2B, sequenced"

The operator answered the freeze-admission menu with "1B 2B, sequenced" (verbatim, a human-origin turn at 2026-11-26T16:45:06Z, 8:45 AM Pacific, in Signal 20's session `e1a83b65-af47-4256-b2f1-b001ded2f2a7`, line 4876, uuid `a6d36052-0e24-4211-a20e-aac3634674c2`). He was answering Signal's message at line 4870, which recommended "1B 2B, with Rebuster waiting" and gave this order:

> **Now:** coding sessions build the safety set, starting with those two fixes. Each PR is held for its turn, and test-only runs keep going at night.
> **Once both fixes have merged:** production starts building these plans overnight. It first passes a full dress rehearsal, as every new kind of run must. Its clean-run count starts fresh at 0.
> **Keeping-nights-going pieces** (the plan queue, the timer starting the next plan, one-tap retry): they follow the safety set, and their new press code needs a full rehearsal before live use.

"Those two fixes" are Plan A Action 2 (`continue-past-a-stopped-action`) and Plan B Action 4 (`launch-production-builds-on-the-plan-model-rule`). The menu options 1B and 2B are from Ellis's checkpoint-admission menu of 2026-11-26 (host-local `workspaces/ellis-plans-20261126/checkpoint-admission-menu.md`). The Plans are the drafts registered by #3114 on his "Approve plans A through D".

- **The phase stays `freeze-and-prove`** and the engine stays frozen at `a5f041066`. `current.json` does not change.
- **Admitted through the freeze** (option 1B), each PR citing `Phase-cause: #3116`, the admission Issue. Rowan or Signal labels #3116 `phase-cause` only after this section merges:

  | Plan or PR | Admitted Actions |
  |---|---|
  | Plan A `one-stop-never-ends-the-card-20261126` | 1 `wire-night-breaker-into-tick`, 2 `continue-past-a-stopped-action`, 3 `end-the-card-when-every-pin-is-merged-or-parked` |
  | Plan B `production-runs-clean-by-itself-20261126` | 1 to 4 |
  | Plan C `nights-never-run-empty-20261126` | 1 to 4 |
  | Plan D `coordinator-and-refusals-recover-without-the-operator-20261126` | 2 and 3; Action 1 is #3080, once its N2 is repaired |
  | #3083 (B12) | as reviewed |
  | #2960 (B9) | after its rebase |

- **This section is the checkpoint admission** that the label rules above refer to ("the PRs a checkpoint verdict admits").
- **Only these are admitted.** An engine PR citing #3116 must name its admitted Plan Action or PR in its body. The morning audit checks each one against this table.
- **When the admission closes:** every row has merged or been dropped, and Rowan or Signal notes that on #3116 and here. After that, a new engine PR citing #3116 is not admitted. The label stays on, so the audit can still re-judge the merged PRs.
- **Not admitted:** Rebuster's engine PRs (#3071, #3074, G5 #3078, G7 #3079), which wait by his answer, and every other held engine PR, including #2996 and #3039.
- **Each admitted PR still lands one at a time:**
  - on its own exact-head independent review and green checks;
  - in an Off window, with a release install before the next card;
  - by its stated merge route, so a PR that loosens a gate or changes authority stays the operator's merge.
- **Option 2B, who builds:**
  - Day-lane coding sessions build these items now, starting with the two fixes. Each PR is held until #3116 is labelled.
  - After both fixes merge, production may build these Plans' Actions overnight, as a new run shape under Decision 0288 rule 2. It needs a full rule-1 dress rehearsal first, and its clean-run count starts at 0. Its PRs park for the operator's merge or a C-03 merge.
  - The night-continuity pieces (Plan C Actions 3 and 4, Plan D Action 3) add new press-path code, which needs an unstubbed rule-1 rehearsal before live use.
- Test-only night cards continue meanwhile.

## Admission (Thu 2026-11-26, evening): "Yes, A" on #3122

The operator answered "Yes, A" (verbatim, a human-origin turn at 2026-11-27T02:37:53Z, 6:37 PM Pacific on 11-26, in Signal 20's session `e1a83b65-af47-4256-b2f1-b001ded2f2a7`, line 6700, uuid `5ddf5b27-6aad-45f3-8cf9-d8679e177d46`). He was answering Signal's two questions (lines 6685 and 6694):

> 1. 🔀 **Merge #3136** once tonight's run ends: yes or no?
> 2. 🗳️ **#3122:** A means admit the small 36-second fix now. B means admit it and the bigger thread fix. C means wait for the next checkpoint.

Before that he had seen A's full text: "A (recommended): admit the 30-second fix now. It's built and reviewed as a held PR, and merges after tonight's run while production is Off. The thread fix waits for the next checkpoint." Signal then told him the wait would be about 36 seconds rather than 30.

#3122 is the cause that refused Track 4 card A at P4 after consumption. The worker's usage beat goes stale for 21 to 30 s while its synchronous tick body runs, and the sign-in lead wait (16 s) refuses then.

- **The phase stays `freeze-and-prove`** and the engine stays frozen at `a5f041066`. `current.json` does not change. Question 1 (#3136) is already admitted above as Plan A Action 2; his "yes" only sets its merge after tonight's Off.
- **Admitted through the freeze**, the PR citing `Phase-cause: #3158`, the admission Issue. Rowan or Signal labels #3158 `phase-cause` only after this section merges:

  | PR | Admitted change |
  |---|---|
  | The small #3122 fix | `scripts/start-run.sh` only: `HEARTBEAT_SIGN_IN_LEAD_WAIT_SECONDS` 16 to 36, a re-run of the guards and the 8 s lead after a long wait, the fixture shortcut and its tests |

- **Only this is admitted.** A PR citing #3158 that changes any other engine path is not admitted.
- **Not admitted:** #3154, the worker-thread fix for #3122. It waits for the next checkpoint, which is option C for the thread fix. Every other held engine PR is also not admitted.
- **When the admission closes:** the PR has merged or been dropped, and Rowan or Signal notes that on #3158 and here.
- **It still lands like every admitted PR:** on its own exact-head independent review and green checks, in an Off window. It changes the executor (`scripts/start-run.sh`), so every START card after it needs a fresh mint, review and rule-1 rehearsal.

## How it is enforced

| Guard | Where | What it does |
|---|---|---|
| Freeze check | CI's required `lint` job, every PR | Reads the strategy from the PR's **base** revision, so a PR cannot switch the guard off for itself. Fails a PR that changes an engine path unless its body has a line `Phase-cause: #N` and Issue #N carries the label `phase-cause`. Renames count on both sides. Also fails a PR that changes a guard file (`current.json`, the guard script, the two workflows) and engine paths together |
| Track check | `.github/workflows/strategy-track.yml`, at 8:15 AM and 9:15 PM Pacific | Goes red when an engine change reached main outside the freeze rule; when the strategy's phase or freeze changed without a checkpoint verdict; in the morning run only, when last night (9 PM to 8 AM Pacific) produced no worker merge; or when the checkpoint passed four hours ago with no verdict. It also prints an audit listing every engine change since the freeze and how each passed |
| Session start | `AGENTS.md`, "Current strategy" | Every Codex, Claude Code and OpenCode session reads this page |

**To let a fix through:** label its Issue `phase-cause`, only for a cause that failed a night, is named above (#2976 to #2978), or is admitted by a checkpoint verdict. Then add `Phase-cause: #N` to the PR body and re-run the lint job.

**What is honour-system, and audited:**
- **Labels.** Anyone with triage access can add the label, and agents share one GitHub identity, so the guard cannot tell who added it. Only Rowan or Signal applies it.
- **The worker exemption.** It is by branch name (`<agent>/<action>-<YYYYMMDD>T<9 digits>Z`). Day-lane `arcadia go` sessions get the same branch shape, so they must not open engine PRs from such a branch during the freeze.
- **The audit.** Signal reads the track job's list each morning and checks that each cited cause matches its change.

**To change the strategy** (record the checkpoint verdict, move to the next phase, change the freeze): use a PR that changes only `docs/strategy/`, citing the operator's words or the Decision that made the change. A phase change must record `checkpoint.verdict` in the same PR, on or after the checkpoint time. Before a verdict is on record, the lint job refuses an early verdict and any other loosening: moving the checkpoint later, lowering the night minimum, or changing the freeze. After one is recorded it no longer judges strategy changes (see the verdict section). Tightening, such as adding `extraPaths`, needs no verdict. Never change the strategy or its guard in the same PR as engine code. That rule applies even to a night worker whose Action edits `.github/` together with `src`: that worker is refused, as `.github/` is the operator's merge anyway.

The guard's code is `.github/scripts/strategyGuard.ts` and its tests are in `tests/strategy-guard.test.ts`. It lives under `.github/`, not `scripts/`, because `scripts/` is a runtime path, and changing it would make the installed engine stale.
