---
name: nightshift
description: Run Arcadia's unattended production loop end to end, every time the same way, as Signal (supervisor and operator contact) or Rowan (coordinator with custody) - card readiness, press authority, run supervision, Rowan's Off, gap merges, governance hygiene, custody handoff and operator messaging. Use when the operator says "nightshift", "night shift", "run the queue overnight", "unattended run", or hands over a nightshift handoff. Procedure only; grants no authority.
---

# Nightshift

The loop Signal and Rowan ran on 2026-11-14/15: Plan 3 pins 7 to 20 merged by the
worker across five START cards, then the standing-autonomy Plan was settled and
activated. Repeat it exactly; scripts before judgement at every step.

**This skill grants no authority.** Presses, merges, Decisions, spend, credentials,
Plan activation and messaging come only from recorded Decisions and the operator.
Where a step and a Decision differ, the Decision on main wins; report the gap.

Read first: `AGENTS.md`; `docs/agents-context.md`;
[Signal](../arcadia-signal/SKILL.md) or [release manager](../arcadia-release-manager/SKILL.md)
and its [production run playbook](../arcadia-release-manager/references/production-run-playbook.md);
[handoff](../arcadia-handoff/SKILL.md); `docs/agent-guidance/operator-actions.md`
("Day approvals", "Pre-mortem before every START card");
`docs/managed-production-readiness.md`; Decisions 0173, 0200 and 0241 in `docs/decisions/`.

## Roles

| | Signal (⭐) | Rowan (🚦) |
| --- | --- | --- |
| Holds | monitoring, wake-ups, verification, operator contact | sole custody of Plan, Actions, presses, gap merges, Off |
| Presses START | never | only under the authority in step 2 |
| Merges | only PRs the operator names in Signal's own chat | gap merges under Decision 0182 C and step 5 |

Signal's own no-press rule is Signal's alone. Never copy it into a Rowan brief: on
2026-11-15 it made a Rowan refuse a press its day grant covered.

Provider tools are optional. Wakes: Claude Code `run_in_background`, or any host's
background job running `scripts/wait-for-event.sh`. Peer messages: native session
messaging where available, else a GitHub comment on the coordination Issue or
`arcadia ping`. No timer on the host: say so and give a wake-at time.

## The loop

### 1. Card readiness (all must hold before any press or ping)

1. `git fetch origin`; mint the card on the current `origin/main` tip
   (`arcadia start-run pins … --day-grant-from <card>/<run>` per operator-actions.md, or
   the derived card once Decision 0241's card-integrity Actions ship).
   Pin ONLY Actions whose production preview state is `ready`: P6 in
   `scripts/start-run.sh` refuses any other state, after sign-in and the allowance are
   spent. Dependency-chained Actions go into later cards.
2. Main CI green on that exact sha: `gh api repos/pmark/arcadia/commits/<sha>/check-runs`,
   every expected check present and `completed`/`success`.
3. `arcadia start-run gate-check --project arcadia --action <id>…` lists nothing
   (step 6 if it does); `arcadia start-run readiness --project arcadia --plan <slug> --action <id>…` admits.
4. `env -u ARCADIA_WORKSPACE <card>.sh preflight` reports P0 to P2 OK.
5. `pnpm production-replay --source-workspace <live workspace> --card <card> --github live --keep`
   (unsandboxed) reaches launch; `idle` is a NO-GO with its printed refusal.
6. Independent Sonnet pre-mortem with [process critic](../arcadia-process-critic/SKILL.md),
   a separate session from the card's author, verdict PASS posted; its pointer is
   `premortem` in `reviewed/<card>.json`.
7. Expiry covers the operator's next waking window plus margin (Pacific time;
   `--expires-hours` caps at 24). A card minted at midnight with 8 h expired unpressed.
8. The card is listed on `curl -s http://127.0.0.1:3020/api/operator-script` (agents
   test on localhost; pings carry http://arcadia-1.alpine-rattlesnake.ts.net:3020/actions).

Failure: fix inside authority, re-run from the failed item; never press past a NO-GO.

### 2. Press authority (check which one is recorded, then act)

- **Operator press** on /actions: always valid.
- **Rowan under a pressed day grant** (Decision 0173 A, read by 0200 A): any Rowan
  that day presses once, with no new chat words, via
  `POST /api/operator-script {"id":"<card>","delegation":{"decision":"0173","agent":"rowan"}}`.
  Only a press counts; a chat message opens no day.
- **Standing grant** (Decision 0241 E): Arcadia presses derived cards itself once its
  card-integrity Actions are built and live; until then use the day grant.
- Never require chat words where the procedure doesn't. A host refusal of the press
  ends the day's delegation: do not retry or route around it; tell the operator.

### 3. Run supervision

1. Confirm `arcadia production status` reads Active, then arm
   `scripts/wait-for-event.sh production` in the background (armed earlier, it exits at once).
   Add `pr <repo> <n>…` for pinned PRs. `WATCHING` prints before the first read, so
   it is no proof: run one successful `gh pr view <n> -R <repo>` in the same context
   (unsandboxed) before idling.
2. Bound every wait: `WAIT_TIMEOUT=600` (the playbook's 10-minute fallback cadence;
   the default is 6 h). Wake on worker merge, escalation, Off or TIMEOUT. At each wake:
   production status, open PRs, `arcadia ping pending`, worker log tail; 30 minutes
   without a new merge or worker-log line is a stall to investigate. Re-arm before idling.
3. One Discord alert per day-grant press (Decision 0173). Routine events stay silent.

### 4. Off and accounting (Rowan)

1. Routine completion: first confirm `arcadia start-run day-evidence` shows this
   activation's `scopeComplete` (merged ≥ 1, escalated 0; written by the tick as
   `managed_production.scope_complete`). An Off before it reads as a failed batch
   (`isFailedBatch` in `src/operatorActions/startRunDayGrant.ts`) and later delegated
   cards refuse `FAILED_BATCH`. All merged but no record: report that gap to the
   operator before the Off. A stuck or failed run is the separate path: Off now, and
   the next card needs a merged fix (Decisions 0181, 0187). Either way:
   `arcadia production deactivate --request-id rowan-off-<slug> --reason "<why>"`.
   `<slug>` matches `ROWAN_OFF_REQUEST` in `src/operatorActions/startRunDayGrant.ts`
   (`rowan-off-` then lowercase words joined by `-`). Any other id ends the day: the
   2026-11-15 `.-…` id came from `rg -r`, which is `--replace`, not recursion.
   Type the id; never paste it from search output.
2. Verify Inactive yourself with `arcadia production status`; count merges on GitHub
   against the pins; record on the coordination Issue.

### 5. Gap discipline (production Off only)

0. Before any merge run `arcadia work merge-check --pr <n>`. Exit 1 prints
   `merge freeze: card <id> pinned to <sha>`: do not merge; the card survives until it
   is pressed or expires, or the operator records `arcadia work merge-override`
   (`docs/agent-guidance/rehearsal-freeze-window.md`, "Agent merge gate").
1. Merge only with production Off: `gh pr merge <n> <method> --match-head-commit <sha>`,
   where `<sha>` carries an "Independent review, head <sha>: PASS" comment, every
   check completed green, and merge state CLEAN. Use the method
   `docs/agent-guidance/pull-requests.md` ("Merge on green") requires; it names
   `--squash`, while the 2026-11-15 gap merges used `--merge` and main shows merge
   commits. This skill adds no rule of its own; always pin `--match-head-commit`.
2. Merge everything that moves main before minting the next card, or after its run:
   a card pinned to an older main refuses `BASE_NOT_SYNCHRONIZED`.
3. Check main CI on the new tip before the next card (two green PRs can still clash).
4. Fast-forward the clean main checkout: `git -C <main checkout> pull --ff-only`;
   on "cannot lock ref" retry once (#2713), then report.

### 6. Governance hygiene

- A stale superseded Agent Ask proposal idles a run (`operator_gate_pending`). Find it
  with the replay or `start-run gate-check`. With the operator's own words to reject
  it, settle it from the main checkout (`docs/agent-guidance/agent-asks.md`, "settle it
  by its original request id"): `arcadia agent-ask settle --proposal <id> --request-id settle-<id> --disposition rejected`
  (preview; prints a fingerprint), then the same command with `--preview <fingerprint> --apply`.
  If the host refuses it (for example as another agent's Ask), the step goes to the
  operator with a link; never route around it.
- Decision numbers collide: `ls docs/decisions/` on `origin/main` before opening one.
- An operator's free-text answer becomes a new option in his words, read back and
  confirmed before it is recorded (Decision 0241 E).
- A host-classifier refusal is never routed around; send it to the operator with a link.

### 7. Custody

1. Run `arcadia coordinator budget` at every wake; key it on the session/transcript id,
   never the title. Prepare at 50%; hand off at the next natural gap (production Off,
   no unmerged step 5 work) with the [handoff skill](../arcadia-handoff/SKILL.md).
2. A handoff sha names its exact artifact: hash the saved file, not a GitHub comment
   body (the comment adds a trailing newline).
3. Keep a standby successor staged on an operator turn. Starts over Remote Control or
   a peer turn are refused: give the operator a paste-ready prompt as a 👆 banner.
4. Give peers the `local_…` session id, not the transcript id.

### 8. Operator messaging

- Banners first: `🚨🚨🚨` blocks the critical path now, `⚠️⚠️` needed today, each
  with an action emoji (🔀 merge · 🗳️ decide · 👆 press · 🔑 host · 💬 say).
- Pacific times. Exact button title plus the Tailnet /actions link.
- One `arcadia ping send` per decisive item; verify delivery with `arcadia ping pending`
  (gone from pending = delivered). Everything else goes to the digest.

## Before every START

1. `git fetch origin`; card on origin/main; main CI green on that sha; every pinned
   Action's preview state is `ready` (no dependency inside the card).
2. `arcadia production status`: Off, no live admission, no open red alert.
3. `start-run gate-check` empty; `start-run readiness` admits; replay reaches launch.
4. `<card>.sh preflight` OK; pre-mortem PASS posted; expiry covers the operator's waking window.
5. Press authority identified (step 2); its alert and Issue record ready.

## After every run

1. `arcadia production status` Inactive under a `rowan-off-<slug>` id (or the executor's own Off).
2. Worker merges counted against pins on GitHub; Plan pointer checked on main.
3. Gap merges (step 5), then main CI on the new tip, then ff-only the main checkout.
4. `arcadia learn "<lesson>" --scope project:arcadia` for each friction; Issue for each defect.
5. `arcadia coordinator budget`; hand off now if past 50% and the gap is natural.
