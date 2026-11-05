# R3: Re-check of the three Workspace layers, and PR 2027 head review
- Reviewer: Critic Claudia Mason (plan-critic, read-only, depth one; model Claude Sonnet 5.5, effort unknown)
- record_hash: fe0a16dd346bbd46478149f0f47a35a2806259d39a2c536d455f0553b6ec10f3
- Reviewed head: c457c564c22c6f7dcb34560df93e79de1287cdf9
- Lenses: mission, evidence, failure
- Verdict: pass_with_changes

I recomputed the hash with the `src/design/record.ts` rules, with `scrutiny` removed and keys sorted, over the committed `record.yaml`. It matches the hash above. The `sha256` values for S022, S023, S024 and S025 match the files on disk. Cited dashboard files have no diff between this branch and `origin/main` (`bd72ccd02`), so the `path:line` checks below hold on main as well. I could not run `arcadia design check` or `tsx` in this sandbox, because local binding is denied. I also could not run `gh`, because TLS verification fails.

## R2 findings: fixed or not

| R2 finding | Verdict | Why |
|---|---|---|
| R2-F1 (blocking) | **Fixed** | REQ-015 to REQ-018 are `proposed`. REQ-016's statement and proof now defer to CH-05. REQ-018's proof is a schema test. The design says approving confirms them. |
| R2-F2 (blocking) | **Partly fixed.** See R3-F1 and R3-F2 | The production-console source is now cited correctly, and "moving" means live Sessions or missions. But the production states the design names do not exist in the code, and the requirement text contradicts the pill. |
| R2-F3 (blocking) | **Fixed in the design. One loose end, R3-F5** | Directions keep their gates, name the exact target and are refused for an unverified or vanished target. This is in the table, in "Directions keep their gates" and in the acceptance list. The Uplink is distinct and drops Relay to Resting. |
| R2-F4 | **Partly fixed** | The `break` is gone and the loop now samples every matching element. But not all weak pairs are named, and four of the 25 selectors are never sampled. See R3-F3. |
| R2-F5 | Fixed | The simulated keyboard case, the Artifact dropping Relay to Resting, and the consumed lowering tap are all present. The prototype has `swallow`. The doc and the record both say the real keyboard is untested. |
| R2-F6 | Fixed | The chip names the Project only, and the subject and scope used move to step 3. The go requests have step 5. |
| R2-F7 | Fixed | Cues to the Journey and the Stage wait for addresses. |
| R2-F8 | Fixed in the design, with a new problem. See R3-F4 | |
| R2-F9 | Fixed | Step 4 is now "a new record pointing to Ask's receipt". |
| R2-F10 | Fixed | The narrowing paragraph, the freeze override in 2B, "taste" on the build order and the staged vocabulary are all there. |

## New findings

### R3-F1 (blocking, evidence and failure): the production vocabulary is not the source's, and "a hung run reads as Blocked" is not what the heartbeat shows
- Locators:
  - `workspace-layers.md`, Scene point 5, and the "production run hangs" row of "When things go wrong".
  - Record C-066.
  - `src/production/activation.ts:249-275` (`ProductionDisplayState`).
  - `apps/dashboard/lib/production-console-server.ts:37-59`.
  - `lib/system-status.ts:328-339`.
  - `lib/types.ts:373-410`.
- What I checked:
  - **States.** The core read returns only these display states: `active_building`, `active_idle`, `inactive_finishing`, `inactive_idle` and `observation_unavailable`. The design's "Running", "stopped", "failed" and "Off" do not exist as production states. The design gives no mapping from the real states to its words.
  - **Unreadable store.** `observation_unavailable` is documented in the code as "never rendered as Inactive" and "not a confirmed Off". The design never mentions it. A literal reading of "Off draws no weather and says Production Off" would call an unreadable production store "Off".
  - **Whose heartbeat.** The heartbeat in the core read belongs to the managed run worker process (`readManagedRunWorker`, 20 s limit). It is not a Session's or a run's heartbeat.
  - **A hung Session.** A Session that hangs under a healthy worker keeps `live: true`, so the new rule "moving means live Sessions" would draw it as Work moving. The code already has a per-Session stall signal, `observedStatus === "stalled"` (used at `production-console.ts:370,570`). The design does not use it.
- Scenario: production is Active, the worker beats normally, and one agent Session hangs. The Scene reads Work moving, which differs from All clear only by motion (colour distance 1.2 to 1.8). The probe's accepted risk rests on exactly the sentence that is untrue here: "a hung run reads as Blocked".
- Consequence: the safety net for the weakest pair in the design has a hole, and R2-F2 is only partly fixed.
- Smallest fix:
  - Add a mapping table from `displayState`, `worker.running`, `heartbeat.fresh` and `observedStatus` to Scene status and pill words.
  - `observation_unavailable` maps to Signal loss and is never called Off.
  - A live Session with `stalled` maps to Blocked.
  - Say that the heartbeat covers the worker only.
  - Reword the "run hangs" row.

### R3-F2 (blocking, mission): REQ-015 forbids what the pill says
- Locators: REQ-015 statement and proof; `workspace-layers.md` Scene point 5 ("the pill reads 'All clear · Production Off'"); the prototype pill.
- What I checked:
  - REQ-015 says the operator is "never told all is clear when production is off".
  - The design's Off state shows the words "All clear" in the pill, with "Production Off" beside them.
  - The design's own wording is weaker ("never shown alone"), and the acceptance list says "plain All clear".
  - The requirement is stricter than the design, and the operator is asked to confirm the requirement. Production is Off and is meant to stay Off for now, so this is the state the operator will see every day.
- Consequence: a tester written from REQ-015 can fail the recommended design. This is the same mismatch R2-F1 caught.
- Smallest fix: either reword REQ-015 ("never told all is clear without production's state beside it"), or change the pill so Off never says "All clear". The second is more honest and is one line.

### R3-F3 (note, evidence): the probe write-up and the disposition notes claim more than the data shows
- Locators: `layers-1.md` Reading and Results; `workspace-layers.md` Evidence "Weak pairs"; record R2-F4 note; `layers-1-results.json`.
- What I checked:
  - **Figures.** Every figure re-derives from the JSON. These all match: open sky 38.8, 11.4, 9.1 and 11.3 on the phone, and 75.8, 65.3 and 52.3 on the laptop; worst contrast 8.59 on the laptop (9.35 on the phone); draw cost 0.29 to 0.78 ms; keyboard geometry 135 and 491 px.
  - **Weak pairs.** The note says "all the weak pairs are named". The weakest non-motion pair is Work moving against Blocked: 3.9 on the keyboard case (light palette, day), and 4.8 to 6.9 elsewhere. That is weaker than two of the three named pairs, and it is the pair the accepted risk relies on (see R3-F1). The probe's own table has it, but the Reading section and the design do not list it. Work moving against Signal loss (4.5) and Needs you against Signal loss (5.1) are also under 6 on the keyboard.
  - **Unsampled text.** The probe text and the doc say "25 kinds" of visible element are sampled. In both viewports `.card h2`, `.muted`, `.chip-btn` and `#pin-text` produce no measurement. `#pin-text` is the line that tells the operator a pinned draft kept its original target.
- Smallest fix: list Moving/Blocked as a weak pair. Say "21 of 25 kinds were visible and measured" and name the four. Add a state that shows the pinned draft and the chip button.

### R3-F4 (note, failure): "hold for two reads" delays bad news
- Locators: Scene point 4; `hooks/use-pull-request-inventory.ts` (60 s timer, per R2); `production-console-server.ts` (core read takes 2.5 to 5 s and may be served up to 20 s stale).
- Scenario: the rule is symmetric. A change from clear to Blocked or Needs you therefore waits for two reads. On a 60 s poll that is up to about two minutes, while the pill and sky still read clear or moving.
- Consequence: it makes the false-clear window longer, which is the thing Scene point 4 is meant to prevent.
- Smallest fix: make it asymmetric. Worse states show at once, and better states (especially to clear) wait for two reads. State the polling interval the Scene will use, and the 2.5 to 5 s CLI cost per core read that the budget line must cover.

### R3-F5 (note, evidence): "works while an earlier send is uncertain" is not "receipt loop unchanged"
- Locators: "Always available means always"; build step 2; `workspace-ask.tsx:170,185,209-212`.
- What I checked:
  - Today the state holds one `exchange`, and `submit` and the button refuse while `phase === "uncertain"`. The operator must first tap "Keep in history and start a new Ask". Retry is offered only for the current exchange.
  - The design promises that the earlier exchange keeps its own Retry while a new message goes out. Step 2 promises the receipt loop is unchanged.
  - These conflict, and nothing in the design says what happens to a direction. A second direction typed while the first is uncertain could be a duplicate instruction.
- Smallest fix: say that ordinary Ask may send past an uncertain exchange (which moves it to history, with its Retry kept), and that directions keep the uncertain gate. Move the multi-exchange change out of "unchanged".

### R3-F6 (note, failure): the redefinition of "moving" leaves open PRs reading as All clear
- Locators: Scene point 6; `system-sky.ts:85`.
- Scenario: pull requests are open and waiting on review or checks, but no Session is live. Under the new rule that reads All clear. The design says an open PR "becomes a reason on the pill", but `readSky` says reasons are empty when clear.
- Consequence: R2 said "clear instead of moving" is the stall signal when production is On. The design chooses an answer without saying so.
- Smallest fix: state what an open PR, a "waiting on others" item and a failing PR do to the status, and whether a clear sky may carry reasons.

### R3-F7 (note, mission): provenance in the record
- Locators: S022 file; record `frame.confirmed_ref: S022` and CH-03 (`decision_ref: S022`); C-039.
- What I checked:
  - S022 is labelled "Verbatim", but its last paragraph is an agent gloss. Only that gloss maps the answers "3A" and "4A" to "the revised frame" and "existing Ask surfaces".
  - CH-03 records the operator as choosing C-039. C-039's statement was rewritten to "through Arcadia Workspace", and its title still says "existing Ask surfaces". What the operator picked in S022 ("existing Ask surfaces, starting with the dashboard") was refined by S023, but C-039 cites S022 only.
- Smallest fix: split the gloss from the verbatim text, cite S023 in C-039's origins, and align its title.

## PR head review
Scope: `git diff 977fc351e c457c564c`.

**Authority and files.**
- The 15 changed files are all under `docs/`: design, proposals and the handoff. No Plan, Decision, `PROJECT.md`, queue, pointer or Action file changed.
- Every new document says it authorizes nothing, and production stays Off.
- The handoff states that no Decision was filed and that the operator's answers are recorded as sources.
- The operator-quote sources S022 and S023 carry the operator's own words. S026 to S028 are links to the project's own repository at a pinned revision. I found no emails, tokens, absolute paths or third-party text in the added lines.
- The "Private, outside this public repository" note in the proposal still holds.

**Stated facts I checked and found true.**
- The malformed-output figure in the proposal, "9 of about 1,000, 7 from Hermes 3 in terse format", matches the `valid` flags across the routing-3 result files: 1,000 rows, 9 invalid, 7 of them Hermes terse (80-row run).
- The "Decisions answered" list matches the proposal's own question list: 1 first slice, 2 precision, 3 revised frame, 4 Ask surfaces, 5 bake-off models.
- The handoff statements that REQ-015 to REQ-018 stay `proposed`, that CH-03 is settled, that R1's eight blocking findings are still open and that `--ready` still refuses are consistent with the record. I could not run the check itself.
- All relative links in the new documents resolve.

**Findings.**
- **PR-1 (note): the brief still pre-decides CH-05.** `brief.md`, the REQ-016 row: "only the operator's taps or words move it". The record's REQ-016 was reworded to defer to CH-05, so the brief reintroduces R2-F1's problem. Fix: make the row say the view moves only as CH-05 decides.
- **PR-2 (note): the proposal is stale against the handoff.** "Open risks" still says the proposal "hasn't had independent review" and that "a fresh critic round hasn't run", and "Next steps" item 2 says to run one. The handoff says rounds at `977fc351e` found no blocking finding, and this R3 is a further round. Fix: update both, or mark them historical.
- **PR-3 (note): PR-state claims in the handoff cannot be checked from here.** The handoff says both PRs are "mergeable with green checks at their last read", that CodeRabbit threads are resolved, and that the earlier capacity concern no longer applies. I could not read PR state (`gh` fails), and the head has moved since any such read. Fix: say "at the previous head" or re-read before relying on it.
- **PR-4 (note): "everything is committed and pushed" is currently untrue.** The working tree shows a modified `docs/design/prototypes/relay-workspace-layers.html`. The change is trivial (the prototype toggle's left offset moves from 92 to 104 px). The branch is otherwise level with `origin/claude/relay-proposal-20261103`. Fix: commit it or revert it before relying on the sentence.
- **PR-5 (note): attribution.** The new proposal section "The interface: three layers" links S023 for "mobile-first, with XR as the horizon". That wording is from S022. Fix: cite both.
- **PR-6 (note): the next-session prompt in the handoff.** "Record my answers to CH-05 and CH-06, then start step 1" presumes approval that has not been given. It authorizes nothing by itself, and it names production-first. Consider rewording it to "if I have approved".

## Checked and sound
- Every locator I checked in the code matches: `layout.tsx:14,17`, `feed-view.tsx:132,146`, `system-sky.ts:49-56,85,88`, `workspace-view.tsx:153`, `workspace-ask.tsx:15,121,170,185`, `workspace-artifact-viewer.tsx:13`, `lib/types.ts:252`.
- The code claims hold: the Feed passes no missions (so any open PR counts as moving), the first load draws clear weather under the label "Reading", the production-console core read exists with a cache and heartbeat, and the Ask route takes only `request`, `requestId` and `projectId`, with Plan and Action only via `directionTarget`.
- The probe's contrast and separation figures re-derive from the JSON.
- The design honestly says draw cost is not phone evidence, and it labels the freeze override in 2B.
- Rejections C-075 and C-076, and the parked items with revival conditions, match S023.
- Hostile-input handling is sound: text never rendered as markup, a fixed table of `control` targets, only code sets `move: go`, and `prepare` only shows a card.
- The Constitution's hard stops are not crossed: reads only, no spend, and no change to Discord rules.

## Not checked
- Anything on a real phone: iOS Safari, soft keyboard, frame rate, battery, or whether weather reads as status at a glance. I did not run the prototype or the probe; I re-derived from the saved JSON.
- `arcadia design check` (and `--ready`), and tests, because local execution is blocked in this sandbox.
- GitHub state for PR 2027 and PR 2028, including checks and review comments.
- Whether `captureOperatorDirection` validates targets server-side.
- Whether Ask's routing can recognise go-to requests at Decision 1A's precision.
- The real latency and cost of `loadProductionStatus` and `loadRunsSnapshot` when called from many views.
- The full text of the conversational-workspace, Downlink and operator-presence specs, beyond the quoted passages.
- Mira's inventory beyond its hash and a skim.
- Whether the committed prototype is byte-identical to the one the probe ran, because the working tree has an uncommitted prototype edit.
