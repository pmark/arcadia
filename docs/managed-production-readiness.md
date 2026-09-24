# Managed production readiness

**The one question this document answers:** how far is Arcadia from running
software production unattended, steered from a GitHub Project board?

It is a *derived* document. It asserts nothing on its own. Every line is a
reading of `PROJECT.md`, `docs/plans/bootstrap-managed-production-to-build-flight-deck.md`,
`docs/decisions/`, `MISSION_LOG.md`, the live worker log, and the live
`arcadia schedule status`, `arcadia production status` and
`arcadia production capacity` output. When those sources disagree with this
file, they are right and this file is stale. "Refreshing this document" at the
bottom says how to re-derive it in about a minute.

Last derived: **2026-09-24**. This derivation also triaged the queue, so that
automated production arrives as soon as possible (see "What this derivation
changed").

---

## Executive summary

**The critical path has changed from "wait for the operator" to "fix what the
live runs broke."** The 2026-09-23 derivation said every remaining
critical-path step belonged to the operator and that no code session could move
the path forward. That was true of the Action list. It stopped being true once
the worker began launching real Sessions under the standing policy:

- **2026-09-23:** `session_e7748a398de14978b4` ran the zero-prompt-rehearsal
  fixture's `confirm-rehearsal-marker` from a worker admission and was
  reconciled `accepted_completion`. It took five operator touches.
- **2026-09-24:** `session_5c1a2543cae24319a6` ran the fixture's
  `write-rehearsal-marker` and was reconciled `incomplete_resumable` after its
  preservation was refused. The operator turned production Off at 16:15Z.

Those two runs produced the real blocker list. **Seven defects now stand
between the worker and an unattended two-Action run. Each is a code fix, each
is an agent-dispatchable Action, and all seven are at the front of the queue in
this order:**

| # | Action | Defect | What the live run showed |
| --- | --- | --- | --- |
| 1 | `release-committed-admissions-on-session-end` ← **pointer** | #610 | A finished Session's `committed` admission is never released. Under `maxConcurrentSessions: 1`, one completed Session blocks every later launch forever. `production status` shows it today: "2 committed Action(s) finishing", with nothing running. |
| 2 | `preserve-candidates-across-base-advance` | #539 | Preservation refuses whenever the base branch advances during the Session. That is routine, because the base moved four times during 09-23's Session. It also compares against the pointer's Action, not the Session's own. |
| 3 | `name-failing-preservation-check-and-bound-retries` | #611 | The refusal reads `details: {}`. The Session looped on it with no limit, then read host source outside its worktree and stalled on a sandbox prompt. |
| 4 | `withhold-worker-lifecycle-from-sessions` | #611 | That same Session ran `arcadia worker stop && arcadia worker start` on the shared daemon. |
| 5 | `stop-killing-busy-workers` | #617 (new) | The hung-worker self-heal fired **five times in 24h**, three of them at 15–26s, which is a busy worker rather than a hung one. The trigger this document set, "reopen on a second `Recovered hung worker:` line", has fired. |
| 6 | `honor-policy-providers-at-launch` | #559 | Provider selection ignores the policy's `scope.providers`, so every tick is refused with `provider_not_permitted` and nothing surfaces. |
| 7 | `refuse-packets-without-validation-commands` | #572 | A Project with no validation commands launches a Session that can never be preserved or auto-completed. 09-23's Action B had to be settled by hand. |

Two cheap single-lane correctness fixes follow in the queue:
`treat-blocked-status-as-undispatchable` (#494) and
`serialize-decision-deferral-pointer-write` (#505). Neither blocks the proof,
but both are hazards once the lane runs unattended.

**After those seven, one operator step earns the claim.** Decision 0057/0061's
revival trigger reads "the operator begins the live rehearsal on whichever
configured provider has capacity … after the further managed-production
defects are fixed." Landing the seven above satisfies its second condition.
The operator then reverses the deferral (`arcadia decision reverse`) and runs
`prove-two-action-unattended-production` per its runbook.

**Distance: 7 code Actions, then 1 operator step, then 1 proof run.** Nothing
else stands between the current state and the unattended claim.

---

## What this derivation changed

Governance writes landed on `main` before this document was changed:

- **Filed 6 Actions** from the live-run defects. Agent Asks
  `file-live-production-blockers-2026-09-24` (commit `322be1ec`) and
  `file-busy-worker-false-kill-2026-09-24` (`5cca4eec`). Filed Issue #617.
- **Reordered the queue** so the seven blockers, then #494 and #505, come ahead
  of `surface-terminal-operator-approvals-in-runs` (Gate 6 UI) and every other
  ready Action (queue receipts `qorder_afd1a762…`, `qorder_7cb0c606…`,
  `qorder_2a720eec…`, `qorder_f69fe132…`).
- **Moved the pointer** from `surface-terminal-operator-approvals-in-runs` to
  `release-committed-admissions-on-session-end` (`54bc4b6c`, receipt
  `qpointer_50204854…`). The superseded pointer Action is still queued, just
  after the blockers.
- **Took `prove-zero-prompt-production-loop` off the critical path.** It is
  *not* a dependency of `prove-two-action-unattended-production`, whose
  `depends_on` names only `feed-and-supervise-managed-production` and
  `add-opencode-production-provider`. It proves the assisted go-broker path,
  and the worker has since launched Sessions directly, so the unattended claim
  no longer routes through it. Only `harden-zero-prompt-production-loop`
  depends on it. Whether to narrow or retire it is left for a later session,
  because it costs nothing while it sits unblocked-but-operator-only.

---

## The gates

| Gate | State |
| --- | --- |
| 1 — The board is the surface | ✅ closed 2026-09-20 |
| 2 — Work reaches an agent with no operator | ✅ closed 2026-09-22 |
| 3 — A finished Session lands with no operator | 🔴 **reopened by live evidence.** Its Actions are done, but #539, #611, #572 and #610 each broke landing in a real run. Blockers 1–4 and 7 above close it again. |
| 4 — It keeps going without help | 🔴 **reopened by live evidence.** #617 (busy workers killed) and #559 (silent per-tick refusal). Blockers 5–6 close it again. |
| 5 — Proof | ⬜ open. `prove-two-action-unattended-production` (deferred; revives after blockers 1–7), then `prove-multi-provider-production-recovery` and `run-managed-production-live-soak` (both blocked on it). |
| 6 — The operator surface | ⬜ open, off the critical path. `surface-terminal-operator-approvals-in-runs` (ready, queued after the blockers), `expose-bootstrap-production-controls` and `freeze-production-runtime-and-handoff-flight-deck` (both blocked on the proof). |

A gate is closed when the live system does what the gate says, not when its
Actions are marked done. Gates 3 and 4 were marked closed on Action status
alone, and the first real runs reopened them. Read a green gate as provisional
until a live run has passed through it.

### What the 2026-09-23 run's five operator touches have become

The touches came from `session_e7748a398de14978b4`, recorded in the prior
derivation.

| Touch | Now |
| --- | --- |
| Permission re-grant | Unattributed. Watch for it in the proof run. |
| Workspace-trust prompt | Fixed: `register-agent-workspace-trust` done. |
| `/login` | Fixed: `preflight-provider-signin-before-launch` and `pass-managed-claude-token-into-sessions` done. |
| Manual completion settlement (no validation commands) | Blocker 7 (#572). |
| Operator's merge | Expected. Integration runs only under Decision 0058's separately recorded grant. |

---

## The critical path, in order

1. `release-committed-admissions-on-session-end` (#610), the **pointer**
2. `preserve-candidates-across-base-advance` (#539)
3. `name-failing-preservation-check-and-bound-retries` (#611)
4. `withhold-worker-lifecycle-from-sessions` (#611)
5. `stop-killing-busy-workers` (#617)
6. `honor-policy-providers-at-launch` (#559)
7. `refuse-packets-without-validation-commands` (#572)
8. **Operator:** reverse Decision 0057's deferral and start the rehearsal on a
   provider with capacity. Before resetting the fixture, see #608 below.
9. `prove-two-action-unattended-production`, where **the unattended claim is
   earned**

Then, for continuous production rather than the claim itself:
`prove-multi-provider-production-recovery` and
`run-managed-production-live-soak` (operator-granted scope).

**Entries 1–7 are ordinary `claude-sonnet-5`/high code sessions.** Their
Issues already hold the root-cause analysis and `file:line` pointers, so none
needs a planning pass. `arcadia go` dispatches them in order. They touch
different files: `policy.ts`/`reconciliation.ts`, `manualPreservation.ts`,
`preservationValidation.ts`, `worker.ts` (entries 4 and 5 both, so run them
in sequence) and packet preparation. That makes them good candidates for
cross-worktree parallel sessions if the operator wants the path shorter than
seven sequential sessions.

### Rehearsal hazards the operator should know before entry 8

- **#608:** while the standing policy is Off, the worker fast-forwards every
  DB-active Project's checkout to `origin/main` each tick, so a
  `git reset --hard` on the fixture is silently undone. Reset the fixture
  through its remote, or stop the worker while resetting.
- **#609:** `production activate`'s `--expect-revision` flag does not match
  preview's `expectedRevision` field name.
- **Capacity gating is off** (`codingAgent.capacityGateEnabled: false`). All
  three providers read "admitted (unmetered by config)", which is an operator
  choice, not observed headroom.
- An open escalation, `private-practice-now/calibrate-river-specialty-prompt-chain`
  (`planning_required`), will stay visible in `production status`. It is
  unrelated to the Arcadia lane.

### What is *not* on the critical path

- `prove-zero-prompt-production-loop` and `harden-zero-prompt-production-loop`.
  See "What this derivation changed".
- `treat-blocked-status-as-undispatchable` (#494) and
  `serialize-decision-deferral-pointer-write` (#505). They are queued right
  behind the blockers as cheap hardening and do not gate the proof.
- Gate 6: `surface-terminal-operator-approvals-in-runs`,
  `expose-bootstrap-production-controls`,
  `freeze-production-runtime-and-handoff-flight-deck`.
- `settle-commit-survives-gitignored-asks` (#512). Arcadia does not gitignore
  `.arcadia/asks/`, so the Arcadia lane is unaffected.
- `defect-bounded-triage-loop`, `build-agent-agnostic-learning-loop`,
  `add-segment-queue-arrange`, `page-runs-this-push-list`,
  `tab-runs-page-concerns`, `renumber-duplicate-decision-files`,
  `repoint-r195-to-fresh-decision`.
- Open Issues the lane can run beside: #549 (a claim expires after 24h,
  relevant only to Sessions that long), #507, #582, #450, #430.

---

## Concurrency

Unchanged in substance. **Decision 0066** is now *approved*: same-repository
concurrent Sessions wait until `prove-two-action-unattended-production` and the
#505/#507/#549-class fixes have landed. The repository lease admits at most one
`prepared`/`running` Session per repository. Note that #610 currently makes
even that one lane fail after its first Session, which is why it is entry 1.

---

## The worker-hang defect: trigger fired

`self-heal-hung-worker-heartbeat` (Issue #485) made a hung worker recoverable.
This document deferred the root cause with the trigger "reopen when a second
`Recovered hung worker:` line appears in `.arcadia/worker.log`." The live log
(`workspaces/martianrover/.arcadia/worker.log`) has five:

```
2026-09-22T19:31:53Z  15s  SIGKILL
2026-09-23T06:45:08Z 170s  SIGKILL
2026-09-23T06:45:57Z  26s  SIGKILL
2026-09-23T19:46:45Z 292s  SIGKILL
2026-09-23T19:51:02Z  17s  SIGTERM
```

The marginal ones confirm the exposure this document already named. A worker
inside one long synchronous step cannot re-stamp its heartbeat, so the 15s
window treats it as hung and kills it. That can happen mid-tick while it holds
admissions. The 170s and 292s stalls may be real hangs. Both are owned by
`stop-killing-busy-workers` (Issue #617, entry 5).

---

## Live state at derivation

| Signal | Reading (2026-09-24 ~21:41Z) |
| --- | --- |
| Managed production | **Inactive** (policy revision 15, epoch 12, revoked 16:15:45Z). Shows 2 committed admissions "finishing" for fixture Actions that are no longer running: the #610 leak. |
| Provider capacity | All three admitted, unmetered by config. Not observed. |
| Worker | Running. Five hung-worker recoveries 09-22→09-23 (#617). |
| Pointer | `release-committed-admissions-on-session-end` |
| Open Decisions | 0041, 0052. Neither concerns production readiness. 0066 and 0067 are now approved. |

---

## Scoreboard

| | Count |
| --- | --- |
| Actions in the active Plan | 101 (each `- id:` paired with the `status:` line that follows it) |
| Done | 76 |
| Open | 24 (18 before this derivation, plus 6 filed) |
| Deferred | 1 (`prove-two-action-unattended-production`) |
| **On the critical path, code** | **7**, all ready, at queue front, pointer on the first |
| **On the critical path, operator** | **1** (reverse the deferral and start the rehearsal) |
| **On the critical path, proof** | **1** (`prove-two-action-unattended-production`) |
| Unfinished, off the critical path | 17 (includes the two post-claim proofs) |

---

## Refreshing this document

Run these, then update the summary table, gates, critical path and scoreboard:

```bash
mise exec -- pnpm arcadia schedule status --project arcadia
mise exec -- pnpm arcadia production status
mise exec -- pnpm arcadia production capacity
grep -l "^status: open" docs/decisions/*.md
tail -80 MISSION_LOG.md
grep -E "Launched Session|Reconciled Session|Recovered hung worker|Escalated" <workspace>/.arcadia/worker.log | tail -30
gh issue list --label bug --state open
```

**Read the worker log, not only the Plan.** This derivation's main correction
came from `Launched Session` / `Reconciled Session` lines and their Issues, none
of which the Plan's statuses showed. Count Actions by pairing each `- id:` with
the `status:` line that follows it. A whole-file `status:` grep overcounts,
because acceptance-criteria text quotes status values.

An Action's truth is its `status:` in the Plan. A gate's truth is whether the
live system does what the gate says. **Refresh this document whenever a
critical-path Action completes, a live run happens, or a new blocker is
found.**
