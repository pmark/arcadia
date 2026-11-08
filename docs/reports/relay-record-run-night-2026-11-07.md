# Part 3: the record-run night (2026-11-07 14:50Z to 2026-11-08 05:29Z)

Parts 1 and 2 are in [relay-rowan-night-2026-11-06.md](relay-rowan-night-2026-11-06.md)
(Part 1 merged as #2153; Part 2 is #2181 and may still be open). This part is its own
file so that the report doesn't conflict with #2181 (the Relay record and brief hunks still sit beside #2181's, so the second PR to merge needs a trivial rebase). It covers the night the operator
set "a record for unattended sessions": Plan `record-run-unattended-test-pins-20261107`,
20 test-only pins in four 5-Action batches under one day grant.

**Result.** 19 of 20 Actions done: 18 merged by the worker with no operator merge, and
Action 15 landed by hand (#2260) after an exact-head independent review. Pins merge at
about one per 15 minutes when nothing is wrong (my estimate from the merge times in
Signal 3's log). Signal 3's log counts a "streak" of 14 for Actions 1 to 14, meaning
no Action failed and was left unmerged; it still includes the stalls in rows 45 and 49. Best run with no operator input at
all: 5 (batch 1, per Rowan's handoff). Action 20 (the last) stalled on #2270 and
production went Off at 03:18Z; at 05:29Z the operator answered "1A 2A 3B 4A".

**Sources** (read as data): Signal 3's log, the Rowan record-run handoff, the Momentum
Keeper's log, Signal 2's night handoff, pmark/arcadia#1929, Issues #2217, #2240, #2261,
#2270, and PRs #2236, #2241, #2243, #2247, #2249, #2250, #2260, #2262, #2268, #2271.
Session transcripts were not read. Times and minutes come from the logs' own
timestamps, so they are estimates; "not measured" means no source gives a figure.

Classes as in Part 1: (a) authority ambiguity or re-ask, (b) missing wake, (c) Way
gap, (d) product defect, (e) Plan or card design error, (f) a gate that worked,
(g) Relay or UX gap.

## Extraction (rows continue Part 2's numbering)

| # | UTC | Actor | Event | Operator touch | Min lost | Class | Evidence |
|---|---|---|---|---|---|---|---|
| 45 | 16:17–17:17 (minutes counted from 16:29, when the card was pressed) | Planner | After the batch-1 Off it bound Action 6's packet to codex while the Active policy permits only claude; refused 78+ times and read as an operator tap | no | 48 | d | #2217, #2219 |
| 46 | 17:17–19:54 | Host, operator | Replacing the packet needed `arcadia review reject`, refused to Rowan by the host; Off 18:11; #2219 merged 19:37 (77 min after it was ready); Active 19:54 | yes | 157 | a | #2217, Keeper log 17:17 to 19:54 |
| 47 | 15:56–17:01 | Gate PRs | Decision numbers 0185, 0186 and 0188 collided or were renumbered | no | not measured | d | #1275 comment |
| 48 | 17:30–21:55 | Signal | The operator's "Yes merge them" lived in Signal 2's chat; Signal 3 needed a new word per PR; relays about reviews were wrong twice | yes | not measured | a | [S035](../design/relay/sources/S035-approvals-do-not-carry.md) |
| 49 | 20:11–22:34 | Worker | Pin 7's criterion quoted `tests/x.test.ts` as data; validation demanded it as a file; 26 Sessions (52 launches by the Keeper's count); Off 21:26 to 22:17 | no | 124 (109 over cadence) | d | #2240, #2236, #2241 |
| 50 | 21:55–22:21 | Signal 3 | `gh` fails TLS in the sandbox and Monitor is sandboxed: the PR watcher had to run unsandboxed | no | not measured | b | Signal 3 log 21:55 |
| 51 | 22:56–23:25 | Race | Two 0191 Decision files on main; no CI check trips; the operator answered A (grandfather) | yes | 29 | d | #1275, #2250 |
| 52 | 00:38–01:27 | Worker, Rowan | Pin 15's criterion and QA expected an escape; the Session wrote the invisible literal; round 1 settled a claimed file change that was not in the diff; Off 01:10; B at 01:26; landed by hand #2260 | yes | 47 | d | #2258, #2259, #2260, #2261 |
| 53 | 00:54–01:05 | QA, code review | Caught the invisible literal and then the false-evidence repair before any merge | no | 0 | f | #2258, #2259 |
| 54 | 01:13–01:17 | Flynn, helper | Theory that Sessions cannot write escapes; withdrawn on counter-evidence; precautionary amendment #2262 built and closed unsettled | no | helper time, not measured | e | #2262 |
| 55 | 03:03–05:29 | Worker | Action 20 (the Plan's last): the Plan-completing settlement fails the reviewer's shape check; repairs cannot converge; 3 Sessions; Off 03:18 | yes | 131 (03:18 to the operator's answer) | d | #2268, #2271, #2270 |
| 56 | 03:19–03:25 | Rowan 1 | No `scope_complete` after the last Action, so Rowan decided completion by hand | no | not measured | d | #2273 |
| 57 | 03:20 | Rowan 1 | Handed off at 61% context; `start_session` refused over Remote Control; the paste prompt was the fallback | yes (paste) | not measured | g | Signal 3 log 03:20 |

## Idle accounting: operator-bound against defect-bound

Each window is counted once, by the cause that held the next move. These are my sums
from the logs, not a measurement by the tick.

| Cause | Windows | Minutes |
|---|---|---|
| Operator-bound | 17:17–19:54 (row 46); 01:11–01:26 (row 52); 03:18–05:29 (row 55) | 157 + 15 + 131 = 303; 172 without the last |
| Defect-bound | 16:29–17:17 (row 45); 20:30–22:34 (row 49); 00:38–01:10 (row 52); 02:49–03:18 (row 55) | 48 + 124 + 32 + 29 = 233 |

The brief gave about 205 minutes operator-bound. I could not reproduce that figure
from these notes, and the nearest sum depends on where the 03:18 to 05:29 window,
which the operator may have spent asleep, is counted. What the table does show is that
the two causes are the same order of magnitude, and that row 46's wait started as a
defect (row 45) and turned into an operator wait only because the host refused the
fix to Rowan. The Momentum Keeper's idle-by-cause check (#2218, merged) already
classifies this by cause, so this part adds a measurement and no new form.

## The vital few (Part 3)

Ranked by what changes dispatch and operator touches per run.

1. **Plan text must be satisfiable by a headless Session** (rows 49, 52, 53, 54).
   Cost: about 109 minutes and 26 Sessions on pin 7, about 47 minutes, a batch stop
   and one operator word on pin 15, plus a wasted helper. The instances are fixed
   (#2236, #2241, #2260, #2263); the class is open. **Form:** new Issue #2272 (a
   deterministic scan of criteria for non-printing and non-ASCII characters and for
   quoted test paths, plus a criteria dry run) and a playbook write-back to
   pre-press item 2 in this PR.
2. **A Plan's last Action can finish** (rows 55, 56). Cost: the 20th Action
   stalled from 03:03Z, three Sessions ended without a merge, and the answer took
   131 minutes. #2270 (shape check) already exists and the operator's "2A" gates
   part-2 on it. **Form:** new Issue #2273 (no `scope_complete` is announced after a
   Plan's last Action; the one call site is under the out-of-scope-pointer branch,
   read from the code and not reproduced) and a playbook write-back to pre-press
   item 4: the contract test is not the shape check, so such a card fails the
   pre-mortem until #2270 lands.
3. **Decision numbers stay unique across START presses and parallel PRs** (rows 47,
   51). Cost: five collisions in two days, at least three review rounds, and one
   operator A/B. **Form:** comment on the existing #1275 with the recurrence table
   and three added criteria (open-PR numbers and press-made diagnostics count; exact
   full-stem matching in consumers such as #2250; a failing check on a new duplicate
   on main) ([comment](https://github.com/pmark/arcadia/issues/1275#issuecomment-6717806722)).
4. **An approval given once carries to the next session** (row 48). Cost: every
   Signal handoff voided the operator's per-PR words, and relayed words are not
   approval, so each successor re-asked or relied on relays that were wrong twice;
   the count of re-asks is not measured. **Form:** a proposed Relay requirement
   REQ-020 and source S035 in `docs/design/relay/`, unconfirmed until the operator
   confirms it. Relay is the one surface that could hold the record, which is why it
   belongs in the design rather than in a playbook line.
5. **A watcher that cannot read must say so** (row 50). Cost: found by trial and
   passed on as handoff text; a blind `pr` watch can idle a coordinator for up to
   six hours. **Form:** new Issue #2274 (`wait-for-event.sh` exits non-zero after
   bounded failed reads and requires checks on the current head) and a playbook
   write-back to the supervision section.

## Deduplicated, resolved or in flight

- **Successor starts** (row 57): in flight. Decision 0191 A (relay launch of
  successor coordinators) is answered; #2223 and the context pages (#2248) are
  merged; #2249 (capsule) and #2250 (relay launch, needs a full-stem Decision ID
  follow-up) are open. Until #2250 lands, the paste-ready prompt is the fallback. No
  new form.
- **False-evidence repair settlement** (row 52): #2261 is closed and #2263 merged
  (`c4787dcc0`). It takes effect at the next START, which has not run. No new form.
- **Packet bound to a forbidden provider** (rows 45, 46): #2217 fixed by #2219, and
  verified live at 19:56Z when Action 6's packet was replaced without a tap. No new
  form.
- **Operator-bound against defect idle:** measurement only, above.

## What I could not verify

- The operator's quotations in S035 are copied from Signal 2's handoff note, which
  labels them verbatim; I did not check the transcripts.
- The `scope_complete` gap (#2273) is read from `src/production/tick.ts`, not run.
- Minutes marked "not measured" have no figure in any source, and the 205-minute
  figure in the brief is not reproduced.
