# First supervised production run on Arcadia's own repository: what went wrong, why, and what to build

Status: written 2026-10-12 00:50Z while the first Session (`session_d50edc616381449dbb`) was running. Author: Claude (Sonnet 5.5, standard tier), release-manager and supervising role, from one long session. Everything below was observed in this session; where a claim is an inference it says so.

The operator's standing requirement behind this report: Arcadia must (1) avoid problematic states and (2) adapt gracefully to unexpected complications so it keeps moving toward the next Milestone and Outcome, and the operator must never need to act on the host machine (the host is treated as permanently offsite; see `docs/agent-guidance/operator-actions.md`, "The host is offsite").

## 1. Result in numbers

| Measure | Value |
| --- | --- |
| Time from the first production activation (2026-10-11 21:09Z) to the first coding Session launch (2026-10-12 00:40Z) | about 3 h 30 min, for a system meant to launch in seconds |
| Operator touches needed (at least) | 3 START presses (1 refused), 2 broker reinstalls, 1 STOP, 1 host CLI approval (R384), 2 GitHub merges so far (#1268, #1269) with #1282 pending |
| Of those, host-machine touches | 1 CLI `review approve`; the reinstall is a remote button but still a host-state step |
| Coding Sessions launched in that time | 0 until 00:40Z |
| Spend before the first Session | one read-only Codex planning run (`run_1787dd2aa059421e84`) |
| Pull requests opened or merged to make the run possible | #1268, #1269, #1278, #1279, #1282, #1283 plus Issue #1277 |
| Independent review rounds that found a real defect before merge | 4 of the 6 PRs reviewed had at least one blocking finding (#1269, #1278, #1279, #1282); #1268 and #1283 passed first time |

## 2. Timeline

- 21:09Z: START (bug Plan) pressed after a first attempt was refused because the installed broker release lagged main.
- 21:10Z: worker routed Action 1 to a Codex *planning* run (not a build) and queued a Decision (R384). Nothing launched. A red alert appeared only after 51 refused ticks (about 10 minutes).
- 21:21Z: operator approved R384 (by a CLI command I handed over). The planning run finished at 21:22Z with a sound plan.
- 21:22Z: the deterministic validator failed the plan on a false positive (`approval_boundary_contradiction`, Issue #1277). The failed-validation Decision offered only "retry" or "reject".
- After about 21:30Z, and for over an hour: the operator could not find the blocking item: `/review` showed the top 5 of 41, `/todo` listed it read-only with a CLI command, `/production` showed a generic refusal.
- 22:38Z to 22:40Z: another agent session (Cody Atlas) activated a different Plan on the same Project, returning the bug Plan to draft and moving the Project pointer. Production's scope no longer matched the pointer. This was not announced to the supervising session.
- 22:43Z: #1279 (one-click planning blockers, blocked items never capped out of `/review`) merged.
- 23:00Z to 00:30Z: START for the new Plan was built; review found its Plan was unpublished (settlement commits existed only in the primary checkout and on an unopened branch); #1283 published them.
- 00:39Z: START pressed; the worker approved the build packet under the delegation; 00:40:04Z Session launched.

## 3. Findings

Each finding: what happened, why, the rule it implies, status.

### F1. Preconditions fail at press time, not before
- Happened: START refused twice (stale broker release; Plan file not on `origin/main`, discovered by a reviewer, not by the system).
- Why: the button checks its preconditions only when pressed; nothing displays "this will refuse, and here is the one-click fix".
- Rule: every operator button must show its preconditions and their current state before it can be pressed, each with its own remedy button. A refusal is a design failure, not a normal path.
- Status: open (A1).

### F2. A running production policy can stall silently
- Happened: production Active, zero launches, the only signal a generic "The previewed Action is not ready to launch" alert after about 10 minutes, with the cause in a worker log on disk.
- Why: refusals carry a class (`planning_approval_pending`, `build_packet_approval_pending`) in the log but the status surface and the alert drop it, and nothing pings the operator.
- Rule: when production is Active and an in-scope Action has not launched within a few ticks, name the exact gate and the one-click resolution on `/todo` and `/production`, and notify.
- Status: partly fixed (planning Decisions are now one-click on `/todo`, #1279); the stall detector and wording are open (A3).

### F3. Blockers were invisible and answered only by a host command
- Happened: see timeline. Root causes: `/review` focus cap (`maxItems: 5`) ranked the blocker 6th; review items carry `severity: "action"` so a "blocked" bypass never matched (my first fix was wrong, caught in review); `/todo` made every review item except build packets read-only with a CLI answer.
- Rule: exactly one canonical blocker surface (`/todo`); a blocker is never capped, filtered or read-only; resolution is at most 2 interactions and never needs text copied or typed.
- Status: fixed for the four planning kinds (#1279). Other review kinds, Agent Asks and escalations still need the same treatment (A8).

### F4. Execution route is chosen by keywords in prose
- Happened: `planStepsForWorkItem` routes an Action to a build only if its text contains "implement", "code" or "prototype" and not "planning". The bug Plan's Actions (my wording) did not, so each would take a planning run plus validation plus acceptance (up to about 14 operator touches across 7 Actions). The packet-approval delegation I had described as "hands-off" covered only build packets.
- Why: routing was never rehearsed on a real Plan; fixture Actions were worded to route to build.
- Rule: route by an explicit declaration on the Action (`execution: build | planning`), validated at Plan creation, and have the START preview state the route and the expected operator touches per Action before the operator presses.
- Status: open (A5).

### F5. The validator rejects correct plans (false positive)
- Happened: the artifact said "Planning requires no approval. Implementation requires a separate approved goal." and was failed for a "contradiction"; the prompt itself requires an "Approval Needs" section, so this recurs.
- Why: `approvalContradictionEvidence` matches per line, not per sentence, and adds "implementation" as a keyword for every planning-only packet.
- Rule: a deterministic gate must be precision-tested against the planner's own standard phrasing; a failed gate must offer a path forward other than a re-roll.
- Status: Issue #1277 (A5).

### F6. Concurrent sessions rewrite shared governed state with no coordination
- Happened: a second agent activated a different Plan on the same Project and returned ours to draft while production was Active on ours; the supervising session learned it by reading the worker log. Earlier the same pattern left two governed settlement commits only in the primary checkout, so `main` was not level with `origin/main` and START could not pass.
- Why: Project pointer and Plan activation are single-writer state with no lease, no "production is Active on this scope" guard, and settlements are not published automatically.
- Rule: (a) activating or pausing a Plan whose scope an Active production policy covers must be refused or require STOP in the same action; (b) a governed settlement lands on `origin/main` via PR as part of settling, never as a local-only commit; (c) a scope-versus-pointer mismatch is a red alert with its remedy.
- Status: open (A6, A7).

### F7. Host-touching steps keep reappearing
- Happened: broker reinstall after a `src`/`apps` change (the freshness check covers `apps/` even though a dashboard change does not alter the broker), CLI approvals, checkout fast-forwards, the need for worker restarts to load merged code. The worker now fast-forwards the checkout itself, which worked.
- Rule: a host step is a defect (recorded) until a remote button or automatic self-heal replaces it.
- Status: open (A4).

### F8. Authority tooling was built per run, mid-run, under a safety classifier
- Happened: the production START was a bespoke script and descriptor per Plan; each needed authoring, three review rounds, a PR and an operator merge, and the auto-mode classifier blocked authoring or merging production-activation code until the operator typed explicit approval in chat. Relays from another session were (correctly) not accepted as operator approval.
- Rule: build generic, parameterized, once-reviewed authority entry points ("START production for Plan X", Plan selected from a reviewed list, no new code per Plan) so that a new Plan costs the operator one click and costs agents no authority-bearing code. Keep the classifier friction for new authority code; remove the need to write it repeatedly.
- Status: open (A1).

### F9. Decision versus live configuration drift
- Happened: Decision 0123's recorded answer was "gate on", the workspace config stayed gate off (an operator choice relayed through a session), and the heaviest Action (heavy tier, high effort) now runs unmetered.
- Rule: a Decision whose answer prescribes configuration must show a visible drift marker when the live config disagrees, and an operator-confirmed exception is a recorded record, not a relay.
- Status: open (A9).

### F10. Noise buries signal
- Happened: the to-do list carries items from rehearsals dated 2026-09-24 to 2026-10-06; the tick prepares build packets and Decisions for Actions of other Projects (out of this policy's scope) every few seconds; 41 open Decisions; escalation text is repeated per tick.
- Rule: out-of-scope Projects get no packets or Decisions from a scoped policy; stale rehearsal items expire or archive themselves.
- Status: open (A8).

### F11. Agent-side process lessons (mine)
- I announced "approves its own build packets" as if the run needed no further touches without checking the route (F4).
- My START preview check read the live workspace, so it passed while the real precondition (Plan on `origin/main`) failed. A preflight must test the same state the script will read.
- I handed the operator host commands and then told them `/review` had the control without checking it was visible there (F3).
- My first cap fix keyed on a severity the data never emits; tests used an unreal fixture. Fixtures must come from the real emitter.
- Watcher scripts must not match substrings of the thing watched (the word "completed" inside an Action id ended one early).
- Independent read-only review was the single most effective control in this session: it found a real defect in 4 of the 6 PRs it reviewed.

## 4. What held

- Authority guards: START refused rather than act on drift; STOP stayed one click and Off-only; no PR was merged by the worker; the capacity of the worker to approve packets was bounded to the named Action.
- The worker fast-forwarded the checkout itself and auto-prepared packets deterministically.
- The planning run produced a high-quality, evidence-grounded plan at low cost.
- Preview-before-activate with an identical fingerprint twice prevented any scope surprise.

## 5. Principles distilled

1. **No refusals at press time**: show every precondition and its remedy first.
2. **One blocker surface, one or two clicks, no typing**; nothing a scoped run is waiting on is ever hidden, capped or read-only.
3. **The host is offsite**: a host step is a defect until automated or a remote button exists.
4. **Silence is a failure**: an Active policy that does not launch within a few ticks names its gate and notifies.
5. **Shared state has a single writer or a lease**; changes to a scope under an Active policy are refused or sequenced.
6. **Route by declaration, not by keyword**; preview shows the route and expected touches.
7. **Gates are precision-tested against the system's own phrasing** and always offer a forward path.
8. **Generic reviewed authority paths, parameterized per run**, instead of new authority code per run.
9. **Decisions and live config must not silently disagree.**
10. **Measure the run**: touches, time to first launch, refusals; make those the success metric of every rehearsal.

## 6. Action plan

Ordered by what unblocks unattended runs first. Sizes are S (hours), M (a day), L (several days). "Acceptance" is the observable condition for done.

| # | Step | Size | Acceptance | Depends |
| --- | --- | --- | --- | --- |
| A1 | One generic **START production for Plan <slug>** entry (Plan chosen from a reviewed list; transitions, provider and expiry from one reviewed manifest) plus the generic STOP, replacing per-Plan scripts | M | A new Plan is startable from `/actions` with no new script or descriptor; the old bug-Plan and governance-overlap buttons are retired | none |
| A2 | **Readiness panel** on `/production` and on the START button: each precondition (release freshness, `main` level, Plan published and active, production Inactive, capacity read, Decision) with a one-click remedy | M | Pressing START can no longer fail on a precondition that the panel showed red | A1 |
| A3 | **Stall detector**: Active policy plus in-scope ready Action with no admission for N ticks raises an alert naming the exact gate (planning approval, packet approval, validation, scope drift, capacity) with its one-click resolution on `/todo` and `/production`, and pings Discord once | M | The 21:10Z stall would have produced a named, one-click alert within 3 minutes | none |
| A4 | **Release freshness**: narrow the staleness check to broker-relevant paths or reinstall automatically when idle; no worker restart needed to load merged code | M | A dashboard-only change never makes START refuse; no reinstall button press is required for docs, artifacts or dashboard merges | none |
| A5 | **Route declaration and validator fix**: explicit `execution` on Plan Actions (validated at creation, shown in the START preview); sentence-level approval check (#1277) with a golden test of the planner's standard phrasing | M | Every Action in a START preview shows its route and expected operator touches; the #1277 sentence pair passes and "Implementation requires no approval." still fails | none |
| A6 | **Scope-drift guard**: activating, pausing or re-pointing a Plan inside an Active policy scope is refused or requires STOP in the same action; a pointer/scope mismatch is a red alert with a remedy | M | The 22:40Z event is impossible without an explicit, recorded STOP | none |
| A7 | **Publish on settle**: `agent-ask settle --apply` lands its commits on `origin/main` through a PR automatically, or reports the exact open PR; `main` is never left ahead with unpublished governed commits | M | After any settlement, `origin/main` equals local `main` within minutes without an agent remembering to open a PR | none |
| A8 | **`/todo` completeness**: one-click for every operator-answerable kind (Decisions with options, Agent Asks, escalations), stale rehearsal items auto-archived, no packets or Decisions for out-of-scope Projects | L | `/todo` lists only live, in-scope blockers; each has a button; list length stays bounded | #1279 |
| A9 | **Decision-versus-config drift marker** in `/production` (and the START readiness panel) | S | Decision 0123 versus `capacityGateEnabled: false` shows as a drift row requiring an operator-recorded exception | none |
| A10 | **Run scoreboard**: record operator touches, host touches, time to first launch and refusals per run in the work metadata and show them on `/production` | S | The next run reports its own touch count; target is zero host touches and at most 2 operator touches before the first launch | none |
| A11 | **Coordination**: a visible registry of live sessions and the governed state each intends to change (pointer, Plan activation), checked by A6 | L | Two sessions cannot both change the Project pointer; the second is told who holds it | A6 |

Suggested order: A3, A5, A6 (stop the silent stalls and wrong routes first), then A1 with A2 (removes per-run authority code and press-time refusals), then A4, A7, A8, A9, A10, A11.

## 7. Open questions for the operator

1. Should a scoped production policy be allowed to prepare packets and Decisions for out-of-scope Projects at all (F10)?
2. Is "STOP before changing a Plan inside an Active scope" acceptable friction (A6), or should activation of the new Plan replace the policy automatically with a recorded replacement?
3. Should the capacity gate be turned on for runs of heavy-tier Actions, with the exception recorded, or stay an operator-config choice (F9)?
4. May the generic START (A1) take its Plan from the Project's `active_plan` pointer alone, so that one press always means "run what the Project says is current"?
