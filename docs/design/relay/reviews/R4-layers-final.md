# R4: Final check of the three Workspace layers
- Reviewer: Critic Claudia Mason (model Claude Sonnet 5.5, effort unknown)
- record_hash: 493cf0260cde4a89d753d85c7e3824d5340ae47429c8a0d9ce671307615dd4bc
- Reviewed head: 29b69ebe7e486450d97c193f00ac821e8666f748
- Lenses: mission, evidence, failure
- Verdict: pass_with_changes

I did not re-run the hash computation, `arcadia design check`, the probe or the tests. The `sha256` values for S022 and `workspace-layers.md` in the record match the files on disk. Everything else was read from the diff `c457c564c..29b69ebe7`, the code and `layers-1-results.json`.

## R3 findings: fixed or not

| Finding | Verdict | Why |
|---|---|---|
| R3-F1 (blocking) | **Fixed.** One note, R4-F1 | The Scene point 5 table uses all five `ProductionDisplayState` values from `src/production/activation.ts:249-275`: `inactive_idle`, `inactive_finishing`, `active_idle`, `active_building` and `observation_unavailable`. The two extra rows use real fields: `observedStatus: stalled` (`production-console.ts:370,570`) and `worker.running` / `heartbeat.fresh` (`ConsoleWorker`, `system-status.ts:328-339`). `observation_unavailable` or a failed read is "Signal loss", and the pill says "Never 'Off'". The text says the heartbeat belongs to the worker, not a Session. The "hangs" row now names the limit: a stall nobody flagged isn't caught. The record's C-066 and the probe write-up agree. |
| R3-F2 (blocking) | **Fixed** | REQ-015 says "never told all is clear when production is off, stalled or unread". The design says a calm sky reads "All clear" only when production is On, and "Nothing waiting" while it's Off. The prototype `SKIES.clear.label` is now "Nothing waiting", with a comment saying why. The pill's second line reads "Production Off". The acceptance list says "none of which may read as All clear". The REQ-015 proof now says "covering each production state in the design's table". These agree. |
| R3-F3 | **Fixed** | Moving against Blocked (3.9 to 6.9) is named in the design, the write-up and the probe table. The keyboard-case pairs are noted too. `layers-1.mjs` adds an "extras" state. The saved JSON now has measurements for `.card h2`, `.chip-btn` and `#pin-text`, and none of the 24 selectors is missing in either viewport. Worst case is still 9.35 on the phone and 8.59 on the laptop. The write-up now says "24 kinds". See R4-F2 for one loose end. |
| R3-F4 | **Fixed** | Worse news shows at the next read, and better news waits for two. The starting proposal is one read a minute, and the budget must cover the production read's real cost. |
| R3-F5 | **Fixed** | Step 2 now says an ordinary Ask can send past an uncertain exchange, and that exchange moves to history with its Retry kept. Directions keep the uncertain gate, and the acceptance list says so. The doc admits "today you have to clear it first". |
| R3-F6 | **Fixed** | Open PRs and steps waiting on others become reasons, a calm sky may carry reasons, and a failing PR stays Needs you. The prototype's clear state now shows an "open pull request" reason. |
| R3-F7 | **Fixed** | S022 now has a separate "Agent note, not the operator's words" heading. C-039 cites S023 and its title is aligned. |
| PR-1, PR-2, PR-5 | Fixed | `brief.md` now defers to CH-05. The proposal's risk bullet and next-step item are updated. The proposal now cites both S022 and S023. |
| PR-4 | Fixed | The prototype toggle offset change is now committed. |

## New findings

### R4-F1 (note, failure): the production table's rows overlap and its precedence is unwritten
- Locator: `workspace-layers.md` Scene point 5 (the table).
- The "Any live Session stalled" and "worker not running or heartbeat stale" rows apply on top of the first four rows. The `observation_unavailable` row can also coincide with a stalled Session. Examples:
  - `active_building` with a stale worker matches both "Work moving" and "Blocked".
  - A stalled Session during an `observation_unavailable` read matches both "Blocked" and "Signal loss".
- Two cases are not covered:
  - `inactive_finishing` with a dead worker. The Blocked row says "Active" only.
  - Production fine but the worker or Sessions part of the core read failed. `ConsoleCoreData` carries `worker: null` and `sessionsError` separately. The last row covers only "the read failed".
- The "worse news shows at once" rule hints at worst-wins, but no rule says it, and the Signal loss against Blocked order is a judgement call.
- Consequence: two implementers could choose differently. Both choices are safe for the main claims, so this doesn't block approval.
- Fix: add one sentence, "rows combine, and the worst Scene status wins, in the order Blocked, Signal loss, Needs you, Work moving, then calm". Add that a failed worker or sessions part reads as Signal loss for that part.

### R4-F2 (note, evidence): one probed text kind was dropped, not measured
- Locator: `layers-1.mjs` `TEXT` list.
- `.muted` was removed from the sampled list, which is why it's "24 kinds" rather than 25 measured. The prototype still has a `.muted` line ("You chose: …", html line 529).
- The probe text doesn't say that kind was dropped. The effect on conclusions is small, since surfaces are 88 to 95% opaque and the worst pair is 8.59.
- Fix: one clause in `layers-1.md`, such as "`.muted` is no longer sampled because the prototype doesn't show it at rest".

## Checked and sound
- Operator text in S022 is byte-identical. The diff touches only the line "Verbatim." (now "The quotation below is verbatim.") and adds the "Agent note, not the operator's words" heading. The operator's quoted paragraphs and the agent summary are unchanged.
- The `sha256` values for S022 (4942a319…) and `workspace-layers.md` (3e952745…) in the record match the files.
- New code claims check out:
  - `activation.ts:249-275` holds the five states.
  - `lib/production-console.ts:370` and `:570` hold the stalled mapping.
  - `system-status.ts:328-339` holds `readManagedRunWorker` and the 20 s heartbeat limit.
  - `types.ts` has `observedStatus: string`.
  - `ConsoleWorker` is at `production-console.ts:~90`. The "92" in the evidence row is inside that interface, so I found no mismatch.
- Numbers in the design match the JSON:
  - The 3.9 Moving/Blocked low is in the probe table (`layers-1.md:40`).
  - Contrast worst cases and per-selector values match.
- The record's R3 entry has seven findings, each with a disposition and a note. No R3 finding is marked `fixed` while its text is still absent from the design.
- Nothing in the diff changes authority, spending, Discord rules or production state. Production stays Off.
- The proposal's three layers section and the handoff changes are consistent with the design.

## Not checked
- Anything on a real phone: iOS Safari, soft keyboard, frame rate, battery, or whether weather reads as status at a glance.
- Re-running the probe (I read the saved JSON only), `arcadia design check`, the `--ready` gate and the tests.
- The record hash computation (I trusted the value you gave) and the tooling's own treatment of the new R4 entry.
- GitHub state for PR 2027 and PR 2028, including checks and CodeRabbit threads.
- The `src/design/record.ts` rules on how a `scrutiny` entry's `record_hash` is verified.
- Whether any state of `ConsoleCoreData` beyond the ones above can occur in practice (for example `worker: null` with production readable).
- Whether anything would stop the operator approving knowingly: I found nothing new. The one open item that bears on the approval is already in the design as "not known" (the real phone). R4-F1 and R4-F2 are fixable in a sentence each.
