# Go workspace prototype

An interactive, explicitly simulated mockup of the Arcadia Go workspace, built from this package's [brief](../README.md), [navigation outline](../navigation.md) and [Claude prompt](../claude-prompt.md).

Everything in it is fictional and simulated:
- It makes no network requests and loads no external scripts.
- It calls no Arcadia API, provider, credential or production control.
- It does not change the live workspace routes.

## Open it

Open [`go-workspace.html`](go-workspace.html) directly in a browser, for example `open docs/reports/go-workspace-design-2026-10-27/prototype/go-workspace.html`. There is no server and no build step. It works offline.

**Console** in the header opens the simulation console. Use it to trigger events and failures, to switch automatic timing off, and to **Reset the demo**. The demo state, including your draft, is kept in this browser's local storage, so a reload resumes where you were.

## What it shows

The layout has three persistent concepts:

- **Context:** where you are. It holds the scope outline and an optional map lens, plus the Journey overview.
- **Work:** what matters and what you can shape. It holds the activity feed and the crafting table.
- **Direction:** what you want to happen next. It holds the recommended next move, contextual moves, your directions with their delivery states, and the explicit-target composer.

On desktop the three sit side by side. On a phone you get one focused work area, a compact scope trail, a **Feed / Work** switch and a pinned composer. Direction and Context open as sheets.

### The primary PPN walkthrough

Private Practice Now copywriting, with fictional practitioner evidence E1–E4:

1. Open **Hero/Recognition copy r2 needs your review** in the feed.
   - The crafting table shows the recommendation, its consequence, the alternatives and the blocked work.
2. Compare r2 with the evidence. Three claims are flagged as having no evidence.
3. Choose **Write a revision direction**.
   - The composer is addressed to the Action, shown by the "To" chip.
   - **Cite E1–E3** inserts evidence references.
4. While you type, a feed event arrives about 3.5 seconds in. It shows as a "1 new item" pill and moves nothing: not your focus, your selection, your scroll position or your draft.
5. Open the **Practitioner evidence** topic, or switch the lens to **Map** and follow a node.
   - The draft and its target stay put, and the composer says so.
   - Return with **Back** or the map.
6. **Send direction.** The receipt moves through **Submitted → Delivered → Acknowledged** as separate simulated states.
   - An acknowledgment produces no revision.
   - r3 then arrives with a word-level diff.
7. About six seconds later, new evidence E4 arrives.
   - The "Approve r3" recommendation goes stale and says which facts changed.
   - It offers no approval until you review the new choices.
8. Choose **Approve r3 anyway**, or ask for a softer line. Then intervene again: each new direction produces another revision (r4, r5, …). There is no one-correction limit.

### Secondary flows

- **Preview continuation** compares continuing one Action with continuing a bounded plan (A3 → A5, stopping at the A4 gate). It shows target, owner, agent, limits and approval scope.
  - **Launch** records a simulated launch only.
  - A repeated or overlapping launch creates no second writer.
- **Project → Adopt a plan developed elsewhere** parses pasted Markdown into candidate Actions and records them only as a proposal.
- **Portfolio** shows the next eligible work across Projects, with blocked reasons. It also has a simulated proposal form for a new Project or feature.
- **Landing preview** opens an artifact viewer with the current revision.
- **Pause** shows **Pause requested** until a checkpoint, then **Paused**. **Resume with current evidence** says what changed while paused.
- **Audit** holds IDs, receipts and the log. It also shows Open in Claude Code and Open in Codex disabled, with the reason: this fictional Session has no verified native destination.

### Adversarial cases

These are in the simulation console, or reachable in the flow:

| Case | What happens |
| --- | --- |
| Stale recommendation | It names the changed facts and withholds the old choice. |
| Duplicate send | Caught before sending; you can keep one, or send again deliberately. |
| Contradictory follow-up | Asks whether to send it as a follow-up, replace the earlier direction, or cancel. |
| Stopped or paused recipient | The direction is held, not delivered. One already acknowledged produces no revision until A3 resumes, and the next move says to resume. |
| Connection lost during a send | Marked unknown and never resent automatically. **Check receipt** confirms it without sending twice. |
| Reload mid-send | The unconfirmed direction comes back unknown and is not resent. A stale recommendation stays stale across a reload. |
| Copying an old direction back | Asks before it would replace a different draft. |
| Approval answered after the feed snapshot | The Decision says it was already answered; **Refresh** updates the feed item. |
| Direct operator edit (source change) | The comparison re-bases on your edit and flags any conflicting direction still in flight. |
| Pull request source unavailable | A notice appears, and items from that source are marked with their last good read. |
| Empty feed | An honest empty state. |
| Fictional versus live data | Every screen carries the Simulation badge. |

## Validation

[`validate.cjs`](validate.cjs) drives the prototype in Chromium with the repository's Playwright. It covers the walkthrough above, every adversarial case, the secondary flows, keyboard navigation and visible focus. It also covers a 390 px phone with reduced motion, and checks that the page makes no network requests. Run it from the repository root:

```sh
node docs/reports/go-workspace-design-2026-10-27/prototype/validate.cjs [screenshot-dir]
```

Set `PW_CHROMIUM` to a Chromium binary when the pinned browser is not installed. The script writes screenshots and `results.json` to the given directory, or to a temporary one by default, and exits non-zero on any failed check. The latest run passed 78 of 78 checks. Breaking the copy-back guard, the stop-after-acknowledgment hold, or the automatic-timing switch each makes at least one check fail.

The [screenshots](screenshots/) folder has four of those captures: desktop drafting with an arrival, the stale recommendation, the phone feed and the phone work area.

## Limits

- **The map is a local lens, not Markmap.** Markmap is not a repository dependency, and the brief rules out loading scripts from a CDN. The lens is a small dependency-free SVG: ancestors above, the selected node, then children and dashed cross-links. **Expand broader relationships** adds siblings. The accessible outline is the primary navigation.
- **Revisions come from a fixed fixture.** The text of your direction is recorded verbatim on its receipt. Revisions r3 to r5 are fixed, and later revisions repeat r5.
- **Timing is simulated with fixed delays.** Turn off "Advance simulated transitions automatically" to step each transition by hand.
- **Prototype only.** There is no chatbot or XR presentation, no live data, and no real launches, approvals, pauses or Discord integration.
