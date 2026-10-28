# Purpose-first Plans

Design proposal, 2026-10-28. Editorial owner: Clara, technical-writing specialization. Author identity: Claudia Atlas. This proposal changes no Plan, Action, pointer or queue.

## The request

> The plans are so detailed and dense, and there are so many of them, that it's just a lot of reading. What I want is for probably Clara, the technical writer, to write summaries for each action and each plan, especially answering why it's being done and what its purpose is relative to the target milestone or desired outcome or plan, mission, the mission for the plan. I want it to be clear exactly why a plan exists and for each of its actions, why each exists.

## What's wrong today

Measured on `main` at `7b9434b`:

- **Too many Plans.** Arcadia has 50 Plans: 3 active, 32 draft, 12 complete, 2 proposed and 1 superseded.
- **Most Actions have no "why".** The Plans hold 538 Actions, and **455 of them (85%) have no recorded `why`**.
- **The titles and criteria are written for agents.** Titles carry briefing text such as "Recommended role: implementer, standard tier. Size M; execute only after a named source assignment…". Acceptance criteria are precise contracts ("Requirement REQ-004…") written for agents and reviewers, not for deciding what matters.
- **"Active" doesn't mean current.** Two of the three active Plans are not current work. `portfolio-docs-protocol` says in its own body that its milestone was reached and its last Action is deferred. `idea-to-managed-build` has three open Actions that appear to overlap the Go Plan.

The records are right for governance. They are the wrong reading surface for an operator who needs to know why work exists and whether it still matters.

## Principles

1. **Why before what.** Every Plan and Action leads with one sentence on why it exists, tied to the level above it.
2. **A purpose ladder, not a list.** Each level answers to the one above: Mission → Outcome → Milestone → Plan → Action. You can climb from any Action to the reason it exists in at most four short sentences.
3. **One thing in focus.** Go's current Plan and Action lead every view. Everything else is reachable, but quiet.
4. **Density by disclosure.** There are three layers:
   - **Glance:** the title, the why, and progress.
   - **Understand:** what "done" looks like, dependencies, and where it stands.
   - **Audit:** the raw acceptance criteria, references and record.

   Nothing is hidden. It's ordered.
5. **Summaries never govern.** They are derived reading aids in a generated namespace and are never parsed as intent (Decision 0004). The Plan document is the authority, and a summary that disagrees with it loses.
6. **Honest freshness.** A summary written before its source changed says so. Fingerprints cover each Action's title, why, acceptance criteria and dependencies, plus the Plan's milestone, Action list and body prose, so an edit to any of them marks the summary stale. Live state (status, owner, gates, progress) always comes from Arcadia, never from prose.
7. **Plain words, no internal IDs.** Requirement numbers, role tiers and file paths belong in Audit.

## The experience

### Project view

At the top, one line each for the **Mission**, **Outcome** and **Milestone**, from `PROJECT.md`.

Next comes **Now**: Go's current Plan as a card.

> **Go tells the truth, then lets you direct and continue work**
> *Why:* Make Go, the one command that starts or continues work, report exactly who is doing what, so you can direct and continue work from the workspace without opening an agent session.
> *Done when:* You can see Go's real next move, send a direction and see it acted on, and continue one Action or an approved scope.
> ▰▰▰▰▱▱▱ 4 of 7 · Now: **Show what happened to your direction**

After that come **Also marked active**, then **Not yet active** and **Finished**. Each Plan in those groups shows its title and one-line purpose, so scanning 50 Plans means reading 50 sentences, not 50 documents. A `reading_note` such as "milestone reached; candidate to close" shows as a quiet badge.

**Production** is one line in the same view: "Production: Off · START needs your approval · Bounded continuation: waiting on your scope Decision". It links to its readiness checklist. Production is never buried, and it's never a button that skips its approval.

### Plan view

1. A header with the Plan title, its why, what it serves, and what "done" looks like.
2. The Action ladder, in order. Each row shows:
   - the Action's plain title and its one-line why;
   - state from Arcadia (done, current, waiting on, blocked by);
   - a marker on Go's current Action;
   - for a dependency, "after *X*".
3. A closing line: "If this Plan finishes, the milestone *…* is reached."

### Action view

1. The title, why, and what "done" looks like.
2. What Go says: the next step, or the gate and its remedy.
3. Receipts for your directions.
4. Audit, collapsed: the acceptance criteria verbatim, references and the record.

### Chat, Discord and phone

The same summaries power one-line answers such as "Now: Show what happened to your direction, so you know whether your instructions arrived and were acted on." Numbered choices use Action titles, not slugs.

## The summary contract

The contract is in [`docs/generated/plan-summaries/README.md`](../generated/plan-summaries/README.md). It covers:

- **Layout:** one JSON file per Plan, containing a Plan purpose, what it serves, what "done" looks like, an optional reading note, and a title, why and done-when for each Action.
- **Fingerprints:** a source fingerprint per Plan and per Action, so the UI can tell when a summary was written before its source changed.

### Writing rules for Clara

- **Why** is one sentence of at most about 25 words. It names what the Action makes possible, or the risk it removes, for the Plan's purpose. It never restates the title.
- **Done when** is one observable sentence, written as what you would see.
- **Titles** are short verb phrases a person would say, with no slugs.
- **Accuracy:** never invent a reason. When the record doesn't say why, infer only from the Plan's own text, and mark inference as such (see `idea-to-managed-build`'s reading note).
- **Coverage:** write for the operator first. Agents keep the full record.

## Authorship and upkeep

The repository's order of preference applies: deterministic first, then local AI, then frontier models.

1. **Deterministic:** a check compares fingerprints and lists missing or stale summaries. It costs nothing and runs in `docs sync`, CI or the dashboard.
2. **Local AI** drafts missing summaries for draft, finished and superseded Plans, where volume is high and the stakes are low.
3. **Clara** writes or edits summaries for active and current Plans, and whenever a Plan is created or amended through an Agent Ask. Their purpose matters most there.
4. **Planners** write the `why` into new Actions as they plan, so the record itself improves. Summaries stay shorter and plainer than the record.

This fulfils the deferred `portfolio-docs-protocol` Action `narrative-summarization`, whose trigger was "a summary someone actually wants". Its rule, that a summary is never written back into the source, is kept.

## Pilot, in this change

Clara wrote summaries for the three active Plans, covering 24 Actions:

- [`make-arcadia-go-orient-one-caller-truthfully-before-authorized-work`](../generated/plan-summaries/make-arcadia-go-orient-one-caller-truthfully-before-authorized-work.json)
- [`idea-to-managed-build`](../generated/plan-summaries/idea-to-managed-build.json)
- [`portfolio-docs-protocol`](../generated/plan-summaries/portfolio-docs-protocol.json)

## Next steps (proposed, not authorized here)

1. **Show them.** The workspace reads `docs/generated/plan-summaries/<slug>.json` through the Plans read and renders titles, whys and done-whens. It falls back to the record when a summary is missing, and labels stale ones.
2. **Check freshness:** a deterministic missing-or-stale report.
3. **Backfill:** summaries for the remaining 47 Plans, with local-AI drafts and Clara reviewing anything active, upcoming or proposed.
4. **Tidy what "active" means.** Use the reading notes to propose closing or re-scoping Plans that are active in name only, such as `portfolio-docs-protocol`, through the governed path.
