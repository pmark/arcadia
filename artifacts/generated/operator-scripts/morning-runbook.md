# Morning runbook — v6 remaining stages rehearsal

This runbook is for `prove-two-action-unattended-production` only. It prepares
and authorizes a disposable v6 fixture; it does not turn the previous v5 run
into evidence for the three still-open proof stages.

## Prepared boundary

`prepare-two-action-v6-rehearsal-2026-09-30.sh` is repeatable preparation.
It creates `~/tmp/arcadia-two-action-rehearsal-v6`, registers only
`two-action-rehearsal-v6`, synchronizes its two Actions, and records the
current **inactive** production-policy revision in
`.arcadia-v6-rehearsal.json`. It does not preview or activate policy, start or
restart a worker, launch a Session, or settle completion.

The two fixture Actions are deliberately ordered:

1. `split-marker-across-two-sessions` requires a first Session to leave only
   `v6 split session one`, exit incomplete, and a second Session on the same
   candidate/worktree/branch to append `v6 split session two` and complete.
2. `off-mid-work-and-restart-worker` depends on that completion and appends
   `v6 off-restart action`. While its already-admitted Session is live, the
   operator turns policy Off and restarts the worker to prove no later
   admission or duplicate/reactivated Session after Off.

The genesis validation command, `node scripts/check-v6-rehearsal.mjs`, accepts
only ordered prefixes of those lines. It is committed before any Session, so
no candidate can alter the check that judges it.

## The one-click Grant — leave unpressed until ready

`grant-production-two-action-v6-remaining-stages-2026-09-30.sh` is one-shot.
It reads the preparation manifest and refuses unless all of these remain true:

- policy is inactive at precisely the revision saved during preparation;
- Arcadia and the v6 fixture are clean and on `main`;
- scope is exactly the v6 project/plan, exactly the two listed Actions,
  `codex-cli`, and concurrency 1; and
- preview confirms that same scope before activation.

It grants packet approval/integration transitions only for those two Actions,
for 24 hours. It does not press a packet approval outside scope, terminate a
Session, turn production Off, restart a worker, merge, deploy, or change
credentials. Revision drift is a fail-closed signal: re-run preparation and
review the new receipt rather than editing or reusing the Grant.

## Safe morning execution

1. Confirm the Arcadia checkout is on current `origin/main`, clean, and the
   worker reports healthy. Confirm production is inactive. If any differs,
   stop; do not adapt the scripts by hand.
2. Run the repeatable prepare action from `/runs`, inspect its receipt, and
   confirm the fixture's manifest names exactly the v6 Project, two Actions,
   `codex-cli`, and an inactive policy revision.
3. Review the Grant descriptor and press it once. The host first runs the
   hermetic rehearsal with discovery restricted to `tests/` and a five-minute
   process timeout. Failure, timeout, or an agent-sandbox invocation refuses
   activation and preserves the failure handoff; no terminal command or pasted
   test output is required. Save its replay log, preview,
   activation, and receipt paths. If it refuses, stop at its handoff; do not
   widen scope or retry against a changed revision.
4. Observe the first admitted split Session. Once `MARKER.md` contains exactly
   the first split line, end that existing Session through the supported
   host/session control. Record Session id, candidate path, branch, and time.
   Do not create a second manual worktree or invoke the Go launcher.
5. Observe the worker resume the same Action. Confirm the new Session has a
   different Session id but the same candidate worktree and branch; verify it
   sees line one, writes line two, completes, and its successor receives a
   fresh candidate. A concurrent candidate attempt must be refused and saved
   as evidence, not bypassed.
6. Observe the dependent Off Action become admitted. While that Session is
   genuinely live, turn production Off through the supported production
   control and record the acknowledgement/epoch. Then restart the existing
   worker through the supported service control. Do not turn policy back on.
7. After restart, record production status, worker identity, admission list,
   live/reconciled Session state, candidate path and `MARKER.md`. The evidence
   must show no post-Off admission, duplicate Session, or reactivation.
8. Leave policy Off. Preserve the run directory, worker log slice, fixture Git
   history, Session/Action ids, revisions, receipts, and every manual
   intervention. Only then assess every acceptance criterion honestly.

## Recovery

- **Prepare fails:** inspect its timestamped `failure-handoff.md`; it has not
  touched policy, worker, or Sessions. Correct that specific local condition
  and rerun preparation.
- **Grant refuses before activation:** no policy changed. Do not force its
  expected revision; re-prepare and review scope drift.
- **Grant reports a post-activation observation problem:** the policy may be
  active. Inspect `arcadia production status` and its receipt before any
  further action; do not press the one-shot Grant again.
- **Split does not resume in the same candidate:** leave policy Off, preserve
  evidence, and open a concrete defect. Do not manually complete the Action.
- **Off/restart permits a new launch or duplicate:** leave policy Off,
  preserve all receipts/logs, and stop the proof as failed. Do not reactivate
  merely to make the fixture look complete.

This is a live proof procedure. Fixture setup, approval, and a clean-looking
marker are not proof unless the recorded Session, policy, and worker evidence
matches the stated boundaries.
