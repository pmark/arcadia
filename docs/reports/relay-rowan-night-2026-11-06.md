# Relay Rowan night, 2026-11-06: what it taught

On 2026-11-06 a Relay-mode coordinator, Rowan (Haiku, Claudia Swift), was
supervised by a Signal session. The run pressed one START card
(`start-run-overnight-keep-unattended-20261106g1`). The worker merged two of
its three test-only Actions with no operator merge (#2143, #2144). The third,
#2145, hit a structural deadlock (#2147), and production was turned Off at
17:05Z. The night took about 17 operator touches.

**Sources.** Signal's observation log (rows 1–29), the two Signal handoffs,
[#1929](https://github.com/pmark/arcadia/issues/1929) from 2026-11-05 22:00Z,
the lessons listed below, and the Issues and PRs cited. Session transcripts
were not read: the log and #1929 settled every open question. The minutes come
from timestamps in the log and on #1929, so they are estimates. Times marked
~ are the log's own estimates and may be out of order.

Classes: (a) authority ambiguity or re-ask, (b) missing wake, (c) Way gap,
(d) product defect, (e) Plan or card design error, (f) a gate that worked,
(g) Relay or UX gap.

## Extraction

| # | UTC | Actor | Event | Operator touch | Min lost | Class | Evidence |
|---|---|---|---|---|---|---|---|
| 1 | ~07:47 | Rowan | Resolved identity, took custody | no | 0 | f | #1929 c6679942472 |
| 2 | ~08:00 | Rowan | Refused #2131: the review verdict was only in Signal's chat | no | ~10 | f | log 2 |
| 3 | ~08:20 | Rowan | Host merge check refused #2131 under a standing order that names no PR | yes ("D1 A1 B1") | ~15 | a | log 3, 5 |
| 4 | — | Rowan | Built a Relay mockup when the operator spoke to it directly; no progress on the critical path | no | unknown | g | log 4 |
| 5 | 08:34 | Rowan | Merged #2131 once relayed words named the PR | — | 0 | f | #1929 c6680721973 |
| 6 | ~08:40 | Rowan | Asked about `planActivation`, which A1 already covered; Signal answered from precedent | avoided | ~15 | a | log 6 |
| 7 | ~08:55 | Rowan | Activation Ask previewed; #2133 opened with review | no | 0 | f | log 7 |
| 8 | ~09:00 | Rowan | Went idle on pending CI with no wake source | no | ~15 | b | log 8 |
| 9 | ~09:05 | Signal | Relayed an auto-merge default from its own memory; Rowan rightly refused it | no | ~10 | g | log 9 |
| 10 | ~09:15 | Operator | Said it in Rowan's chat; auto-merge armed on #2133 | yes | 0 | b | log 10 |
| 11 | after 08:46 | Rowan | Asked again about card preparation, which A1 covered | yes | ~10 | a | log 11 |
| 12 | ~09:30 | Rowan | Preflight refused P0, "ARCADIA_WORKSPACE is set"; the fix existed only in transcripts | — | ~15 | c | lesson_33417e29386c21d3c204 |
| 13 | 09:02 | Operator | "A. Definitely A.": the variable is a session override | yes | 0 | c | #1929 c6681196261 |
| 14 | 09:04 | Pre-mortem | FAILED the card: draft-Plan creation dropped `execution: build` | no | ~30 | d / f | #2134, #1929 c6681231281 |
| 15 | 09:07 | Rowan | Asked A/B/C on the repair; scope readings differed | yes | ~5 | a | #1929 c6681290373 |
| 16 | ~09:20 | Rowan | Repair took two PRs (Ask file, then settlement) | no | ~20 | c | #2135, #2136 |
| 17 | 09:44 | Card | P6 refused: Action 2 `depends_on` Action 1, so not all `ready` | yes (press, "G1") | ~185 | e | #1929 c6682187239, #2138 |
| 18 | ~11:00 | Rowan | Its host forbids timed `gh` polling, so it asked for an exception to run the waiter | yes | ~10 | b | log 18 |
| 19 | 12:41 | Rowan | Pre-mortem PASS, preflight OK, one exact ping | yes (press) | 0 | f | #1929 c6685065316 |
| 20 | 12:58 | Operator | "Yes" to the waiter in Rowan's chat | yes | 0 | b | #1929 c6685352150 |
| 21 | 13:10 | Worker | Merged Actions 1 and 2 (#2143, #2144) | no | 0 | f | #1929 c6685640604 |
| 22 | 13:28–14:33 | Waiter | Missed #2145's red check: neither state nor revision changed | no | ~65 | b | log 22 |
| 23 | 14:41 | Worker | Settling the last in-scope Action drops `current_action`; the contract test fails | — | ~215 (Active, blocked, to 17:05) | d | #2147, lesson_3ce0660e23f2bc4c89a6 |
| 24 | 14:40 | Signal | The open #2132 collided with a press-made Decision number; redone as #2146 | yes (close #2132) | ~40 | d | log 24, #1275 |
| 25 | 15:20 | Rowan | Verified the diagnosis itself; put hold-or-Off to the operator | yes ("a") | 0 | f | #1929 c6688319908 |
| 26 | ~15:30 | Rowan | Counted pre-existing pointers as blockers and proposed a Decision for a rule already in code | yes (asked for Signal) | ~45 | c | log 26 |
| 27 | 16:15–17:05 | Rowan | "D", then "B": Off at rev 99 | yes ×2 | 0 | f | #1929 c6690625793 |
| 28 | 17:50–19:03 | Rowan | Recovery took a different route from the one recorded on #1929 (#2148, #2149) | yes ("A") | unknown | c | log 28 |
| 29 | ~19:00 | Signal | Offered "record as given"; `decision approve` takes only an option label | yes ×2 | ~20 | c / g | log 29 |

## The vital few

These are ranked by operator touches and dispatch behaviour removed, not by
build cost.

1. **The pre-mortem simulates the states after activation and after the last
   Action settles** (rows 17, 23; row 14 is related). Cost tonight: 5 touches
   (the refused press, "a", "D", "B", "A") and about 6.5 hours (the refused
   press to the good press, plus 3.6 hours Active and blocked). Form:
   a write-back to the playbook's pre-press gate, in this PR. The product
   defect stays tracked in #2147.
2. **The production waiter wakes on a new in-scope escalation** (row 22).
   Cost: about 65 minutes asleep on a red check. Form: a fix to
   `scripts/wait-for-event.sh` with tests, in this PR.
3. **Menus list the answers in force first, and each option names the PRs,
   cards and steps it covers** (rows 3, 6, 11, 15, 29). Cost: 5 touches and
   about 1 hour. Form: a write-back to the playbook's operator communication
   section, in this PR.
4. **Preflight in a coding session: `env -u ARCADIA_WORKSPACE`, as the
   operator ruled** (rows 12–13). Cost: 1 touch and about 15 minutes, and it
   recurred in four earlier Rowan transcripts. Form: a write-back to the
   playbook's Host item, in this PR. Deferred: a clearer refusal message in
   `scripts/start-run.sh` would change card hashes while Rowan is preparing a
   card. Revival trigger: the refusal recurs once the playbook is in place.
5. **The Signal role** (rows 6, 7, 19, 23 and 26 resolved without the
   operator; rows 9 and 29 were errors). Form: an Agent Ask proposal,
   `agentask_8987d5095d8366361a`, capture
   `capture_ab4bdfd6-8d11-4d9b-b9f8-837791c28d1f`.

**Counterfactual for item 1.** Suppose the 09:38Z pre-mortem had applied both
simulations. It would have failed the card before the first press, on the
dependency and on #2147. Removing the dependency (row 17) would have come
before any press. #2147 would have reached the operator as one menu at about
12:40Z instead of four touches between 15:20Z and 17:50Z, and production would
not have sat Active and blocked from 13:28Z to 17:05Z. Net saving: about 4
touches and about 6.5 hours.

**Deduplicated or deferred.**
- Decision numbers racing with an open Decision PR (row 24): added to #1275,
  since the allocation it plans reads only origin/main.
- The two-PR draft-Plan amendment (row 16). Revival trigger: the next draft-Plan
  amendment.
- New Relay brief requirements (rows 4, 9, 10). Revival trigger: the Signal
  proposal is adopted.
- Notes To Self is at its 25-entry cap, so these went to the playbook instead.

## Part 2: the evening and the night after (to 2026-11-07 05:30Z)

This part covers what happened after #2153 merged at 19:58Z. **Sources:** Signal's
log rows 30–32, #1929 from 19:00Z, PRs #2148–#2176, the lessons captured
since, host state at 05:30Z, and one transcript search to confirm S034's
wording. The records this part filed are dated up to about 05:40Z. On #1929, 2026-11-06 took **23 operator touches** across the UTC day
(Part 1 counted about 17 up to 19:00Z). About 8 more followed before 05:30Z.

| # | UTC | Actor | Event | Operator touch | Min lost | Class | Evidence |
|---|---|---|---|---|---|---|---|
| 30 | 19:19–19:30 | Rowan | Asked to apply Action 3's completion from main, then to merge settlement #2150 | yes ×2 | ~100 | a | #1929 c6693360819, c6693570948 |
| 31 | 19:58–20:37 | Rowan | Clarifying `narrative-summarization` took four menus: amendments could not set `clarified` (#2154, fixed by #2155) | yes ×4 | ~40 | d | #1929 c6694157845 to c6694951628 |
| 32 | 21:32 | Rowan | Asked to merge clarification settlement #2157 | yes | ~55 | a | #1929 c6696197050 |
| 33 | 21:37 | Rowan | Offered a one-Action card for a `src/` build Action, outside playbook item 5; the operator chose it | yes | — | e | #1929 c6696306590 |
| 34 | 23:00 | Pre-mortem | Caught the missing `execution` route again (#2134's class, through clarification) | no | — | f | #1929 c6697926224 |
| 35 | 23:08 | Rowan | Asked for `execution: build`, the same answer the operator gave at 09:07Z | yes | ~10 | a | #1929 c6698053645, #2161 |
| 36 | 23:29 | Pre-mortem | Caught Rowan's own stale clarification draft holding the Action | no | ~20 | f | #1929 c6698520619 |
| 37 | 23:38–00:03 | Worker | Two light-tier attempts refused the async design; a third opened #2171 | no | ~25 | e | log 32, lesson_7402dccc04d598b9fa6f |
| 38 | 23:48–00:10 | Waiter, worker | The escalation wake caught the red check in 4 minutes; the worker repaired to #2173, and its review failed it as unwired | no | 0 | f | #2171, #2173 |
| 39 | ~00:20 | Operator | "Where is the OFF button? I wish I had better UI for this" | yes | ~23 | g | [S034](../design/relay/sources/S034-where-is-the-off-button.md) |
| 40 | 00:43–02:12 | Operator | Off on `/production`, then three re-plan answers | yes ×4 | ~90 | e | #1929 c6699774532, c6700677201 to c6700850227 |
| 41 | 02:15 | Pre-mortem | FAILED the re-minted card: it reused a consumed one-shot id, and the start tier was light | no | ~10 | f | #1929 c6700881859 |
| 42 | ~02:20 | Operator | Decision 0184 A: the checked-in waiter is standing direction. Neither `arcadia timeline --wait` nor the bootstrap line exists yet | yes | — | b | #2175, #2176 |
| 43 | ~03:53 | Host | After a reboot, legacy `com.arcadia.worker` (release `fad7493e`) took the pidfile; the governed worker exited 0 and stayed down | no | ongoing (≥95) | d | #2179 |
| 44 | 04:29 | Card | Preflight P2 refused, "no running PID", while `work monitor` still says "ready to press" | yes (the press) | ongoing | d | #1929 c6702255085, #2179 |

### The vital few (Part 2)

Ranked by what changes dispatch and operator touches per run.

1. **One worker owns the pidfile, and a lost race fails loudly** (rows 43–44).
   Cost: every START card is unpressable from 03:53Z until someone restarts
   the worker on the host, and the operator is off-site. That's one refused press
   and at least 95 minutes so far, and it recurs at every reboot. **Form:**
   Issue #2179, relayed to the current custodian on #1929. Restarting the worker
   is runtime recovery, so it's the operator's call.
2. **Pinned Actions are buildable unattended as written** (rows 33–37, 40, 41).
   Cost: the narrative-summarization run took about 6 touches (23:08, 00:20,
   00:43 and three re-plan answers), three worker attempts and about three
   hours. **Form:** a write-back to the playbook's Action-shape item, in this
   PR. The deterministic half, a card check that refuses a pinned Action with
   no route, is added to #2134
   ([comment](https://github.com/pmark/arcadia/issues/2134#issuecomment-6702901972)).
3. **How far the standing order reaches** (rows 30, 32, 35). Cost: about 4
   touches and 3.5 hours of waiting for steps the operator answered "A" each
   time. **Form:** decision Ask `decide-standing-order-routine-governed-steps-20261107`
   (`agentask_78c813508229ba5275`), file in this PR, with options A to C. It
   is previewed, not settled: a press during the open run window can take
   the next Decision number (row 24, #1275), so settle it after the window
   closes.
4. **Off is one obvious step** (row 39; Signal's log row 27 records Rowan asking how).
   Cost: 2 questions. **Form:** a proposed REQ-019 and source S034 in the
   Relay brief, in this PR, unconfirmed until the operator confirms it.
5. **Signal Behavior.** **Form:** proposal Ask
   `propose-signal-supervising-session-role-spec-20261107`
   (`agentask_0a623403acd3df5829`). It refines `agentask_8987d5095d8366361a`
   with method lines 5–7: check the worker's own repair state, diff main
   against the candidate before proposing a Decision, and dry-run before
   offering. It also adds a per-night tally of touches avoided against touches
   caused, with a stop rule.

**Counterfactual for item 1.** Suppose the governed install had retired the
legacy agent, or a lost race had failed loudly. After the 03:53Z reboot,
either the governed worker would hold the pidfile, or liveness would have
flagged the gap at about 03:55Z. Either way the 04:29Z press would not have
refused at P2, so one touch is saved. The card would also not have spent
more than 95 minutes unpressable, and the custodian who took over at 05:29Z
would not have been about to hit the same refusal. Each future reboot saves
one off-site host action.

**Deduplicated, resolved or in flight.**
- The wake source (row 42) is in flight: Decision 0184 A, the design in
  [session-notifications.md](../design/session-notifications.md) and build step
  `agentask_8a6c9afce7244f904b`. It also covers the waiter's re-baseline and
  the timeline's blind spots (lessons `lesson_0d1bbef8955979bf0be7` and
  `lesson_f731c3ea1c7116e59154`).
- The start tier is resolved: the live workspace now sets `sessionStartTier:
  standard`, per the operator's 02:12Z answer. Revival trigger: a light-tier
  Session refuses a build design again.
- The two-PR amendment from Part 1 is resolved in practice: #2157, #2161 and
  #2174 each landed as a single PR.
- Still open, with no new form: #2129 (blocked in round 2, idle since 05:02Z on
  2026-11-06), and #2173 (draft, superseded by the re-plan). #2171 is closed.
- The Ask `propose-relay-workspace-switches-and-perpetual-rowan-20261106` is
  missing from checked-in records and from the pending list. Signal 1's
  transcript says it was saved, but no receipt was found. Revival trigger: the
  operator restates it, or its receipt turns up.
