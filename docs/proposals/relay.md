---
arcadia: v1
type: proposal
project: arcadia
question: Should Arcadia build Relay, its conversational front door, starting with visible Ask answers, read-only lookup routes, a "Did you mean" menu and a scorecard?
---

# Relay: Arcadia's conversational front door

Status: proposal, 2026-11-03. It authorizes nothing and moves no pointer or queue. Unattended production
stays the first priority and stays Off. The full evidence is in [docs/design/relay/](../design/relay/brief.md).

## What Relay is

The operator sends any text and gets a fast reply, at no cost much of the time, from something that knows
their Projects, Plans, Actions and the Arcadia Way. From there they go from an idea to planned work that gets
produced autonomously, using Arcadia Design, scaffolding, templates, continuous integration and Cloudflare
deployment, and they manage production through it.

The operator named it Relay. First-time-operator onboarding is deferred, but nothing built now should require
special knowledge.

## The rule that governs everything

**Ask must be complete with no model at all. The local model is a companion that only adds to what Ask already
produced.** Ask alone is reliable and free. Relay is Ask plus the companion, and that's where it should feel fast and
magical. The operator asked for this, and Ask's whole test suite should always run with the model off to hold it.

Four things in Ask make this work, and they should be built from the first PR:

1. **A structured outcome, not just text.** Every Ask returns its route, confidence, facts, any menu options and a
   plain-text answer. Ask shows the text, and Relay gives the companion the rest.
2. **An instant answer first.** Code replies right away, and the companion may then add to it. If the model is slow,
   busy or unloaded, the answer still stands.
3. **A small context packet.** Ask records what's in play for that message: the current Project, Plan or Action, the
   recent exchange, and the facts it just fetched. The companion reads only that.
4. **Effects declared in code.** Each route says `read`, `prepare` or `write`, so adding a companion can't widen what
   Relay may do.

## The design: a ladder

Each message climbs only as far as it has to. **Ask goes first and may ask you to clarify.** The model comes after
that: when you pick "Something else", when no option fits, or when the message is plainly conversation. It may also
add to an answer Ask already gave, or work outside the message path.

| Rung | What answers | Cost |
|---|---|---|
| 1. Ask, deterministic | Patterns, Project names, Decision answers | Free, under 1 ms |
| 2. Arcadia's tools | Code runs the tool and writes the answer | Free |
| 3. Local companion | Conversation, extraction, rewording, drafting | Free, seconds |
| 4. Project supervisor | A resumed read-only coding session with that Project's context | Allowance or spend |
| 5. Frontier model | Hard reasoning | Allowance or spend |

- **The knowledge lives in the tools, not the model.** The companion handles messy language and never supplies facts.
- **Decision engines plug in behind one seam.** Rules and the local model come first. Laya or Jev can be added
  later without changing callers. None is added now, by the operator's direction. Hosted engines need a Decision.
- **Tools declare `read` or `prepare` in code.** A `prepare` tool only produces a card the operator confirms, so
  no model can pull a production lever.
- **Warm supervisors are resumable, not running.** Live sessions spend while idle and need a keep-alive service.
  This is the author's call, for the operator to overrule.

The contract is in [decision-interface.md](../design/relay/decision-interface.md).

## Evidence so far

All local, at no cost, on the operator's MacBook Air M4 with 32 GB, under uncontrolled load.

| Finding | Result | Source |
|---|---|---|
| Qwen3.6 27B routed unseen messages | 94% right, about 5 s, no wrong production lever, 18 GB | [probe 3](../design/relay/probes/routing-3.md) |
| Older or smaller models on the same messages | 78 to 83% | probe 3 |
| Hermes 3 8B and Qwen3.5-9B on the same unseen messages | Hermes 66% terse and 81% JSON, about 10 s; Qwen3.5-9B 81% terse, about 7 s. Neither came close to the 27B | [results](../design/relay/probes/routing-3-results-bakeoff.json) |
| Terse output against JSON with the 27B | Same accuracy on unseen messages, faster by a margin that varied | probe 3 |
| Malformed model output across routing runs | 9 of about 1,000, 7 of them from Hermes 3 in terse format, so grammars alone won't fix routing for most models | raw results in probe 3 |
| Ask's intake today on 60 messages | About 0.2 ms, 58 low confidence | probe 3 |
| Rough rule prototype on unseen messages | Decided 46%, 81% of those right, and it lowered the 27B's accuracy | probe 3 |
| Rules plus a three-option menu | About 79% resolved instantly or in one tap; optimistic, not truly held out | `menu` test, below |
| Way lookup on first-timer questions | 16 of 30 top-three hits, 9 of 20 matches wrong | [probe 1](../design/relay/probes/way-knowledge-1.md) |
| Answers from guidance alone | 73% fully correct, wrong on stopping, so it failed the default pass mark | probe 1 |

The menu figure comes from a rough script, `probes/routing-3-menu.py`. Treat it as a hint.

**Not yet known:** idle latency, sustained use, real operator messages, resume speed
and cost for supervisors, and whether the 27B can stay loaded beside coding agents. 

## The proposed first slice

Independent investigation changed the order. Its report is
[here](../design/relay/reviews/investigation-first-slice.md), and the main code claims were checked.

1. **Answers you can see.** `show_status` and `show_review` already run, but the dashboard and Discord show only
   "Status shown." Add compact answers, with how fresh the data is, reusing the status formatter already in the
   Discord bot.
2. **Name matching and lookups.** Match Project names only in a bounded slot or as a whole word, because any name
   of four or more letters inside a message scores 0.96 today. Add read-only `IntakeAction` kinds for what needs
   me, what's next, production status, PRs, Plan and Action details, earlier requests and Way lookup. All use the
   existing `status` heard type, with a golden case and a near-miss for each, and no second router.
3. **The "Did you mean" menu.** Up to three plain-language options plus "Something else", with a menu ID and a
   fingerprint so stale menus and double taps are safe. In Discord, a number only counts as a reply to that menu.
   It appears only when there's a real candidate; otherwise today's clarifying question applies. Taps are recorded
   and counted but never replayed.
4. **The scorecard.** A held-out test written by someone other than the rule author, frozen first, inside the
   existing Ask report.

**Acceptance:** at least 94% precision on what rules claim, zero wrong routes to a production lever or Decision,
and coverage reported per class. The operator's goal of 50% to 80% stays visible as a tracked number.

**Cut from this slice:** remembering menu taps, which needs memos that carry a route and expire; new `reason` and
`capture` routes; a keyword filter for hostile text; and production levers in Discord until its allowlist stops
failing open.

## Later

1. **Local model chat and tool choice,** behind the seam. Requires the bake-off.
2. **Production levers as confirm cards,** with the Discord allowlist closed first.
3. **Idea to Plan** through Arcadia Design, extending the existing Astro-to-Cloudflare staging path.
4. **Resumable Project supervisors,** with one measured probe first.
5. **Relay as the default session shell,** through a Decision. Relay's read-and-propose limit doesn't fit a
   default coding session as written, so this needs two tool regimes.
6. **First-timer onboarding.** Guidance defects are in [Issue 2013](https://github.com/pmark/arcadia/issues/2013).
7. **A blog post** on the bake-off, once results are complete, under existing publishing authority.

## Bake-off, to finish

Compare tuned models on prompts from a separate author, judged blind, through the live oMLX and LiteLLM path, at
idle and production-like load, with repeats. Choose the smallest model that meets the operator's budgets. Next
candidates: Qwen3.5-2B and 4B, Gemma 4 E2B and E4B, and a smaller Qwen3.6 build. The
protocol is in [probe 2](../design/relay/probes/local-model-2.md).

## The companion's jobs

| When | Example | The companion's job |
|---|---|---|
| Ask has already routed it | Ask finds three items waiting | Optional: say which one to do first. Code's answer works without it. |
| You picked work on a menu | "maybe a seasonal menu page for the bakery" | Fill in the name and Project on your confirm card |
| You picked "Something else" | "What should I think about for a portfolio site?" | Hold the conversation |
| You picked "how Arcadia works" | "how do I make everything quit?" | Reword it so Way lookup finds "stop production" |
| You asked for a draft | "Okay, let's do it" | Draft an Outcome or Agent Ask for approval |
| Outside your messages | Overnight logs, a month of corrections, group-chat triage | Summarize, propose rules for a reviewed PR, or triage privately |

**It shouldn't:** supply facts, change state, answer a Decision, diagnose hard problems, or run ahead of rules that
work. **The menu stays deterministic for now,** so that it's instant. If it keeps missing the right option in real use,
a model could suggest options for that case, once the scorecard shows that.

## Local model advice

- **Use one as the third thing that runs, not the first.** Code first, then the menu, then the companion.
- **The starting model is Qwen3.5-9B** behind LiteLLM, kept swappable: 5.8 GB, about 1 s to first word, faster than
  reading speed. Its strength at the companion's jobs is mostly untested.
- **Qwen3.6 27B was the best router by far,** at 94%, but it takes 18 GB and routing now matters less than it seemed.
  Test whether it can sit beside coding agents, and look for a smaller Qwen3.6 build.
- **Avoid Qwen2.5-Coder 1.5B** for answers; it reversed the meaning of a stop-related one. Hermes 3 gave no reason to
  choose it. Qwen3-4B 8-bit is fast but weak at routing.
- **Never send raw tool output.** Today's commands return up to 717 KB.
- **Keep prompts short, cache their start, and keep the model loaded.** Caching cut first-word time from 3.6 s to
  0.77 s where measured, and loading took about 2 to 6 s.
- **Tune before comparing.** Pick output format per model: terse suited the 27B and JSON suited smaller ones. A grammar
  is a cheap safeguard and would have helped Hermes 3 in terse format, but it won't fix wrong choices, which were
  nearly all of the errors.
- **Don't trust headline numbers.** Save real messages from use, and replace the test sets with them.
- **Memory is the biggest risk:** free memory fell to about 11% during runs on this shared 32 GB laptop.
- **The next bake-off should score the companion's real jobs,** which are extraction, conversation, rewording and
  drafting, not mainly tool choice. A smaller model may be enough, because Ask takes the common lookups and a few
  seconds is acceptable for what's left. That's unmeasured.

## Recommended order

1. **Review and approve this proposal.** An independent agent reviews it, and the operator answers the decisions below.
2. **Run a fresh critic round,** on a model other than the author's, against this version.
3. **Ship visible answers,** using the structured outcome.
4. **Add name matching and lookups, then the menu and scorecard.** That finishes Ask alone, useful even if no model
   ever ships.
5. **Rerun the bake-off** on the companion's jobs, before choosing its model.
6. **Add the companion** behind the seam, starting with conversation after "Something else" and filling in cards.
7. **Then** production levers as cards, idea to Plan, and supervisors, as listed under "Later".

Unattended production stays first throughout. Steps 3 and 4 stay off its worker path and help manage it from a phone,
but they do use capacity.

## Corrections to earlier advice

So that nobody relies on superseded statements from earlier in this work:

- The model doesn't sit in front of Ask, and it doesn't rank the menu's options.
- Remembering menu taps was overstated, and it's cut for now: memos can't hold a route and don't expire.
- The 27B's 94% is less decisive than it first sounded, because routing is no longer the model's main job.
- "Talk first" was replaced by read tools first, and then by visible answers first.
- The 79% from rules plus a menu came from a rough prototype, and the real figure will start lower.

## Decisions for the operator

1. **Approve the first slice as ordered above?** It takes capacity from production, though it stays off the
   production worker's path and is read-only.
2. **Is 94% precision the right pass mark,** with coverage tracked rather than required?
3. **Confirm the revised frame,** still marked proposed in the record: the operator's own critical path first.
4. **What is Relay made of?** The author recommends existing Ask surfaces, starting with the dashboard, because code
   answers first and a coding agent runs only for code. The rule above assumes this. CH-03 in the record remains open.
5. **Download more bake-off candidates, or will the operator install them?** Qwen3.5-2B (1.75 GB), Qwen3.5-4B (3.06 GB),
   Gemma 4 E2B (3.58 GB) and E4B (5.18 GB) are listed in probe 2, plus any smaller Qwen3.6 build.

## Open risks

- **Critic R1's hold stands,** against the earlier frame, with eight blocking findings open. A fresh critic round on
  this proposal hasn't run, and the ready gate refuses the design. That critic also shared the author's model, so
  a different agent should run the next round.
- **This proposal hasn't had independent review** of its own, because the session ran out of capacity.
- **Local model memory:** 18 GB on a laptop shared with coding agents and production.
- **Native discovery** of the `arcadia-design` and `arcadia-relay` skills in fresh sessions hasn't been run.

## What exists today

- **Merged:** the `arcadia-design` skill and `arcadia design check`, Relay mode (`arcadia-relay`), `arcadia way
  lookup` as evidence tooling, the STOP guidance, and the Relay design record.
- **Not built:** the conversation, lookup routes, compact answers, the menu and the scorecard.
- **Private, outside this public repository:** two pasted Gemini suggestions in the workspace, under
  `design-sources/relay/`, recorded as S018 and S020.
- **Handoff:** [the next session starts here](../reports/handoffs/20261103T0000Z-relay-proposal.md).
