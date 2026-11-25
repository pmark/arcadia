# Current strategy: Run what works, prove what's next

Adopted 2026-11-22. The operator chose this route and typed "yes" to it in Signal 18's chat, then pressed standing grant `standing-grant-20261122a`. The machine-readable record is [`current.json`](current.json). It sets what day-lane work builds and what may merge. It changes no Plan, queue or authority: Decisions, the active Plan and CONSTITUTION.md still govern.

Sources: the advisor's stable-versus-next report (`workspaces/advice-stable-vs-next-20261122.md`) and the playbook (`workspaces/playbook-to-unattended-production.md`). Both are host-local files in the workspaces folder beside this repository, not in it.

## The idea

Production runs a frozen engine, inside the envelope where it has worked: one Action at a time, simple test-only work. The next engine version is built beside it, and it replaces the running engine only after proof.

## Phase 1: Freeze and prove (now until Wed 2026-11-25 8 AM Pacific)

- **Engine frozen** at `a5f041066`. A PR that changes an engine path merges only as a fix for a named failed-night cause. Engine paths are the runtime paths (`src`, `scripts`, `apps`, `config`, `database`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`) plus the freeze's `extraPaths` (`mise.toml`, `mise.lock`, `pnpm-workspace.yaml`, `schemas`). Production worker candidates (the night lane) are exempt.
- **Each night** the timer tries first. If it has not pressed by 9 PM, Signal pings once and the operator presses (route A2). Supervised nights are recorded separately and never count as clean.
- **Builders** fix the named causes (#2976 to #2978). They also build the release pin (B18a), the golden corpus and the two-cycle replay. Those three are built and reviewed now, but a PR of theirs that touches an engine path **waits, open, for the checkpoint**. It never uses the `phase-cause` label, which is only for failed-night causes. Work that touches no engine path (tests, docs) merges as usual. B6a to B6c (handoff at 400k) wait too, unless Rowan shows that their files are outside the engine paths.
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

- **Still frozen:** the Workspace Plan picker PRs #2996 and #3039, until the next step up.
- Option 2A (one "merge all" in Rowan g7's simulated order, then one release install) is the operator's merge instruction for the admitted PRs; it is carried out PR by PR under the usual exact-head review, green-check and production-Off gates, and changes nothing here.

## How it is enforced

| Guard | Where | What it does |
|---|---|---|
| Freeze check | CI's required `lint` job, every PR | Reads the strategy from the PR's **base** revision, so a PR cannot switch the guard off for itself. Fails a PR that changes an engine path unless its body has a line `Phase-cause: #N` and Issue #N carries the label `phase-cause`. Renames count on both sides. Also fails a PR that changes a guard file (`current.json`, the guard script, the two workflows) and engine paths together |
| Track check | `.github/workflows/strategy-track.yml`, at 8:15 AM and 9:15 PM Pacific | Goes red when an engine change reached main outside the freeze rule; when the strategy's phase or freeze changed without a checkpoint verdict; in the morning run only, when last night (9 PM to 8 AM Pacific) produced no worker merge; or when the checkpoint passed four hours ago with no verdict. It also prints an audit listing every engine change since the freeze and how each passed |
| Session start | `AGENTS.md`, "Current strategy" | Every Codex, Claude Code and OpenCode session reads this page |

**To let a fix through:** label its Issue `phase-cause`, only for a cause that failed a night or is named above (#2976 to #2978). Then add `Phase-cause: #N` to the PR body and re-run the lint job.

**What is honour-system, and audited:**
- **Labels.** Anyone with triage access can add the label, and agents share one GitHub identity, so the guard cannot tell who added it. Only Rowan or Signal applies it.
- **The worker exemption.** It is by branch name (`<agent>/<action>-<YYYYMMDD>T<9 digits>Z`). Day-lane `arcadia go` sessions get the same branch shape, so they must not open engine PRs from such a branch during the freeze.
- **The audit.** Signal reads the track job's list each morning and checks that each cited cause matches its change.

**To change the strategy** (record the checkpoint verdict, move to the next phase, change the freeze): use a PR that changes only `docs/strategy/`, citing the operator's words or the Decision that made the change. A phase change must record `checkpoint.verdict` in the same PR, on or after the checkpoint time. The lint job refuses an early verdict and any other loosening: moving the checkpoint later, lowering the night minimum, or changing the freeze. Tightening, such as adding `extraPaths`, needs no verdict. Never change the strategy or its guard in the same PR as engine code. That rule applies even to a night worker whose Action edits `.github/` together with `src`: that worker is refused, as `.github/` is the operator's merge anyway.

The guard's code is `.github/scripts/strategyGuard.ts` and its tests are in `tests/strategy-guard.test.ts`. It lives under `.github/`, not `scripts/`, because `scripts/` is a runtime path, and changing it would make the installed engine stale.
