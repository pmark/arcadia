# R2: Critique of the three Workspace layers
- Reviewer: Critic Claudia Mason (plan-critic, read-only, depth one; model Claude Sonnet 5.5, effort unknown)
- record_hash: a91c72a99710eaa6d1df8ee1102bfbdc8af545058f86c22aa223cee77cbf90d6
- Lenses: mission, evidence, failure
- Verdict: pass_with_changes

I recomputed the hash with `src/design/record.ts` rules (scrutiny removed, keys sorted). It matches the hash above. The S022, S023, S025 and S024 `sha256` values in the record match the files on disk.

## Findings

### R2-F1 (blocking, mission): REQ-015 to REQ-018 were added after the frame was confirmed, and REQ-016 pre-decides CH-05 and contradicts its own recommended option
- Locators: `record.yaml` frame (`status: confirmed`, `confirmed_ref: S022`); REQ-016 statement and proof; CH-05; `workspace-layers.md` Decision 1.
- What I checked: the frame was confirmed by S022, which predates the layers design. `git diff` shows REQ-015 to REQ-018 appear only in the uncommitted changes, so the operator has not confirmed them.
  - The statement of REQ-016 says only the operator's taps or words move the view. That rules out option C of CH-05, which the design offers the operator as live.
  - The proof of REQ-016 says "answers move nothing" and "a cue moves the view only when tapped". That contradicts option A, the recommended one, where a code-matched "take me to the Plan" moves the view. A test written from the proof would fail the recommended design.
  - REQ-015 and REQ-018 also copy design mechanisms. REQ-015 writes in the "fresh read" rule. REQ-018's proof is a review that "blocks hold no rendering details", which is not an observable test.
- Consequence: the bar is derived from the design it judges, and the frame still reads as operator-confirmed. If the operator picks C, the frame is already violated.
- Smallest fix:
  - Mark REQ-015 to REQ-018 `proposed` until the operator confirms them.
  - Reword REQ-016 so it is neutral between the CH-05 options: the view moves only as CH-05 decides, never from a status change or a model's choice.
  - Make the proof match: under A, a code-matched go-request moves the view and shows Back.
  - Give REQ-018 a testable proof, such as a schema check that answers carry no layout fields.

### R2-F2 (blocking, mission and evidence): the Scene's status vocabulary does not answer "is unattended production alive?", and the design misstates what exists
- Locators: `workspace-layers.md` "What's there today" row 2, Scene points 4 and 5, accepted-risk bullet; `lib/system-sky.ts:49-56` and the id ladder; `feed-view.tsx:132`; `app/api/production-console/route.ts` and `lib/production-console-server.ts:37-59`.
- What I checked:
  - **"Work moving" means open PRs today.** `readSky` returns `active` when `moving || others || prs` is true, and the Feed passes no missions, so `moving` is always 0. A stalled production run therefore shows as "Work moving" because a PR is open. The design's "stopped or failed run counts as Blocked" does not cover a hung or silent run.
  - **A production source exists.** `/api/production-console?part=core` returns production state, worker heartbeat and Sessions, behind a TTL and stale-while-revalidate cache (`cachedStale`). The design's "Missing: no production source" is false, and the cache and heartbeat already answer the freshness and read-cost questions it defers to build time.
  - **Production Off shows "All clear".** "Production Off draws no weather", and the standing directive keeps production Off. With nothing else pending, the Scene and pill read "All clear" while the Project's main capability is stopped. The reason appears only on tap, which conflicts with REQ-015 ("never told all is clear").
  - **"Costs nothing" is false once production is On.** The design accepts that All clear and Work moving differ only by motion and says mistaking them "costs nothing". Per M3 and the north star, "clear" instead of "moving" is exactly the stall signal.
  - **"Reading" still draws clear weather.** `readSky` returns `id: "clear"` while loading, so the canvas still draws clear skies. The design never says what "Reading" looks like. The freshness limit is also left unmeasured and absent from the acceptance list.
- Smallest fix:
  - Source the production line from `production-console` core, using its heartbeat for staleness.
  - Define "moving" as live Sessions or missions, not open PRs.
  - Let the pill label carry "Production Off" so "All clear" is never shown alone.
  - Give "Reading" and stale reads a non-clear look.
  - Add first-load, staleness and production-Off cases to the step 1 acceptance.

### R2-F3 (blocking, failure and mission): the old composer's write paths and gates have no stated home in Relay
- Locators: `workspace-layers.md` ("The Direction panel dissolves", build step 2 "remove the availability gates"); `workspace-ask.tsx:159-186` (`available`, `directionMode`, the `draftTarget` pinned in localStorage); `downlink.md:205-262` (Uplink, Watch and Talk).
- What I checked: today the checkbox "Send as a direction to this context" records a durable direction on a Plan or Action, and `submit()` returns early unless `available` holds. The design never mentions direction mode. It also never mentions the Uplink, which is a second always-present text input aimed at a live Session.
- Scenarios:
  - **Gate removal.** Step 2 removes the gates, and the design's fallback for an unverified view is "whole portfolio". If direction mode survives, a pinned draft target for a Plan or Action that has since vanished, or a stale or failed View read, could still be sent as a direction. "Scope is a hint, never authority" is false for that path, because there scope selects the write target.
  - **Two inputs.** On the Uplink Stage with Relay above it, the operator sees two text fields with different recipients. Typing "merge it" into the wrong one is a plausible slip that the design leaves open.
- Consequence: the design touches the one path that records instructions to agents without saying where it goes, and its acceptance never tests it.
- Smallest fix:
  - State that direction becomes a `prepare` card that names the exact target and is confirmed, and that it is unavailable whenever the target is unverified. Alternatively park it with a revival condition.
  - Replace "remove the availability gates" with "remove the gates on read-only Ask, keep them on direction".
  - Say that the Uplink input is distinct and labelled, or that it is parked.
  - Add a test: a direction cannot be sent against an unverified or vanished target.

### R2-F4 (note, evidence): the probe's "one weak pair" is the wrong pair, and some text sampling is thinner than stated
- Locators: `layers-1.md` Results and Reading; `layers-1.mjs` (the `break` at the end of the text loop; `opaque()` at alpha 0.3); `layers-1-results.json`; prototype `--surface .88` and `--surface-strong .95`.
- What I checked: I re-derived every minimum from the JSON and the figures match. The interpretation does not:
  - Work moving against Needs you is 5.9 at rest and 4.7 in peek and open, on the phone, light palette, day. That is as weak as Needs against Blocked and weaker at rest (8.5). Mistaking "Needs you" for "Work moving" means missing an approval, which costs more than mistaking Needs for Blocked.
  - All clear against Signal loss is 5.7 to 6.9 on the light palette at dusk. That is the "falsely clear" confusion the design says it prevents, and it is not named.
  - The distances are means over open-sky points, and the "about 2 is perception" yardstick applies to side-by-side patches, so the numbers are indicative only.
  - The text loop `break`s after the first visible element per selector, so only one `.row span`, `.card dt` and so on is measured.
  - Unsampled: the reasons panel, Back, cue and menu buttons, the retry button, error text, and the pill weather word (hidden on phones).
  - The contrast floor passes largely because the surfaces are 88 to 95% opaque, which is also why "open sky" is only the gaps between them.
- Smallest fix: list Needs/Moving and Clear/Signal loss as weak pairs, widen the text sampling to every element and every control, and reword "text holds everywhere" to "holds for the sampled elements".

### R2-F5 (note, failure): phone geometry with the keyboard and with an Artifact is unproven, and the acceptance cannot test it
- Locators: `workspace-layers.md` Relay heights table, "top strip stays open sky at every Relay height", Artifact row, Not known list, Acceptance; probe Limits.
- What I checked:
  - Focusing the field is the Answer height. The probe measured Answer on a phone at 12.5% open sky with no keyboard. A soft keyboard takes roughly 40% of an 844 pt phone, so the "View visible above it" and "strip never covered" promises are untested for the commonest phone state.
  - The Artifact viewer is opened only from receipt trail cards inside Relay's own answer. At Thread height on a phone (modal, 10% sky) the Stage would sit behind the thread, yet the table says Relay "stays usable above it".
  - "Tapping the View puts Relay down" does not say whether the tap also activates the control under it.
  - Acceptance lists "keyboard" (apparently the hardware keyboard), and Playwright at 390 px cannot reproduce iOS Safari behaviour. The design does say "Not known" and relies on the operator's phone test.
- Smallest fix:
  - Add a visual-viewport-resized case, about 390 by 500, to the probe and the acceptance.
  - Specify that opening an Artifact drops Relay to Resting.
  - Specify that the lowering tap is consumed.

### R2-F6 (note, evidence): step 2 "no backend change" conflicts with sending the View's subject, and the scope chip would overstate
- Locators: build step 2; `workspace-layers.md` evidence row "Relay gets the whole scope"; `app/api/ask/route.ts:7-12,41-45`; `lib/arcadia-cli.ts:1116-1120`.
- What I checked: `runAsk` and the route accept only `request`, `requestId` and `projectId`, and Plan or Action travel only via `directionTarget`. Step 2 says the Ask backend does not change while the View's subject is published and sent with each message. Until step 3, the chip would say "this Action" while the server routes by Project only.
- Consequence: step 2 sizing is wrong, and REQ-016's "each answer names its scope" is client-asserted until the response carries the scope used. The `move: go` route, which Decision 1A needs, has no build slot or precision target.
- Smallest fix:
  - In steps 1 and 2, the chip names only what is actually sent (the Project).
  - Move the subject fields and `scopeUsed` into step 3 with a route change.
  - Give `move: go` its own step and a measured precision before the operator chooses 1A.

### R2-F7 (note, evidence): "the URL stays the scope" does not cover Feed, Journey or the Stage
- Locators: View section; `feed-view.tsx:117-118` (Journey is `useState` plus `sessionStorage`); `workspace-artifact-viewer.tsx:13` and the `TrailCards` open state.
- What I checked: only `/workspace/projects/...` routes carry scope. The Journey screen and the Artifact are component state, so the cue kinds `journey` and `artifact` have nothing to point at, and Back and Forward cannot restore them. No build step makes them addressable.
- Smallest fix: either add routes or query params for them, or restrict the first cue set to `scope` and `control` and park the other two with a trigger.

### R2-F8 (note, failure): read cost and multiple windows are deferred, and a claim runs ahead of its build step
- Locators: Scene points 1, 4 and 5; Across devices row "Several monitors"; build step 4; `hooks/use-pull-request-inventory.ts` (60 s timer plus focus and visibility triggers; 2 s polling up to 30 times while refreshing); `workspace-ask.tsx:15,72`.
- What I checked: moving the Feed's three reads into the layout multiplies them by the number of open windows, each also running three canvases. The server caches (the inventory cache, and `cachedStale` for production), so cost is bounded, but the design measures nothing and has no budget or acceptance line for it.
  - Until step 4, two windows share one `localStorage` key but hold separate React state, so one window can overwrite the other's draft and history. "One thread on the server, in whichever window" is claimed for a state that exists only after the last step.
  - Status flips crossfade the weather on every poll with no hysteresis. The prototype's pill is `aria-live="polite"`, which would announce each flip and conflicts with "the Scene never speaks".
- Smallest fix: add a read-count and frame-cost line to the step 1 acceptance; decide hysteresis and a pill live-region policy; qualify the multi-window row as arriving with step 4.

### R2-F9 (note, mission): step 4 is both "a projection over Ask's own records" and "the typed answer saved as given"
- Locators: build step 4; "The history doesn't get rewritten"; Constitution Truth ("one authoritative home").
- What I checked: if old answers keep their original facts, they must be stored, which is a second store. If they are projected, they change over time. These are incompatible as written.
- Smallest fix: name the record that stores the typed answer, or say plainly that it is a new record with Ask's receipt as its pointer.

### R2-F10 (note, mission): narrowings of S022 and S023 that the operator should see
- Locators: S022 (cued "as needed to serve and adapt to dynamic contextual shifts"); S023 item 2 (freeze); `workspace-layers.md` Who may move what, Decision 2B, build order, closed vocabulary.
- What I checked:
  - **Dynamic shifts.** The design treats only operator navigation as a contextual shift. A system event cues nothing, and the pill's "reasons on tap" give no path to the item. This is defensible under the attention budget, but it narrows S022 and should be said as a narrowing. Smallest fix: let the reasons link to the existing feed items and controls (which the Feed already links), and state the narrowing.
  - **Freeze.** Decision 2B puts Relay on six control pages the operator froze (C-061, "get nothing new"). If kept as an option, it should be labelled as overriding the freeze.
  - **Build order.** Status plumbing (production source, freshness) runs ahead of the conversation (REQ-012 to REQ-014 are the frame's Outcome). Step 1 is also the least bounded. This is taste, and the operator should choose it knowingly.
  - **Vocabulary.** Five block types and five cue views are specified before one answer exists. Under the Economy rule, step 3 should ship only what the first answers use (text, `facts` and a `scope` or `control` cue).

## Checked and sound
- Locators verified in code: `layout.tsx:14,17`; `feed-view.tsx:132,146`; `system-sky.ts:49-56,88`; `workspace-view.tsx:153`; `workspace-ask.tsx:15,121,170,185`; `workspace-artifact-viewer.tsx:13` (the native `showModal`); `lib/types.ts:252`.
- Structural claims verified: the Feed has no composer, and the provider mounted in the layout survives navigation. The six `control` targets (`/todo`, `/review`, `/actions`, `/production`, `/now`, `/mission-control`) exist as routes.
- The probe's numbers and shares re-derive from the JSON: open sky 40.9, 12.5, 10.2 (phone) and 78.5, 65.4, 52.4 (laptop); worst contrast 9.49; draw cost 0.3 to 0.51 ms. The design honestly calls the draw cost weak evidence.
- Hostile-input handling is sound:
  - Text is never rendered as markup.
  - Control targets come from a fixed table.
  - Only code can set `move: go`.
  - `prepare` only shows a confirm card.
- The receipt loop and idempotent request ids (`workspace-ask.tsx:112-131`) are correctly reused. "Outcome unknown, never resend" is consistent with the code.
- Rejections C-075 and C-076 match S023, and the parked items each carry a revival condition. The Constitution's hard stops are not crossed: reads only, no spend, and Discord rules unchanged.

## Not checked
- Anything on a real phone: iOS Safari, soft keyboard, frame rate, battery, and whether weather reads as status at a glance. I did not run the prototype or the probe, only re-derived from the saved JSON.
- The earlier "17.1% with stacked cards" figure, because that version is not in the repository.
- Mira's inventory (S024) beyond its hash, the full text of the conversational-workspace and operator-presence specs, and whether `captureOperatorDirection` validates targets server-side.
- Whether Ask's routing rules can recognise go-to requests at the precision Decision 1A needs.
- Latency and cost of `loadProductionStatus` and `loadRunsSnapshot` from many views.
- PROJECT.md was checked only for the quoted mission lines.
