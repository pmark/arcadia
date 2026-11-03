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

## The design: a ladder

Each message climbs only as far as it has to.

| Rung | What answers | Cost |
|---|---|---|
| 1. Ask, deterministic | Patterns, Project names, Decision answers | Free, under 1 ms |
| 2. Arcadia's tools | Code runs the tool and writes the answer | Free |
| 3. Local model | Chooses a tool from a short list, or chats | Free, about 5 s |
| 4. Project supervisor | A resumed read-only coding session with that Project's context | Allowance or spend |
| 5. Frontier model | Hard reasoning | Allowance or spend |

- **The knowledge lives in the tools, not the model.** The local model routes and chats.
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
| Terse output against JSON with the 27B | Same accuracy on unseen messages, faster by a margin that varied | probe 3 |
| Malformed model output across routing runs | 2 of about 700, so grammars alone won't fix routing | raw results in probe 3 |
| Ask's intake today on 60 messages | About 0.2 ms, 58 low confidence | probe 3 |
| Rough rule prototype on unseen messages | Decided 46%, 81% of those right, and it lowered the 27B's accuracy | probe 3 |
| Rules plus a three-option menu | About 79% resolved instantly or in one tap; optimistic, not truly held out | `menu` test, below |
| Way lookup on first-timer questions | 16 of 30 top-three hits, 9 of 20 matches wrong | [probe 1](../design/relay/probes/way-knowledge-1.md) |
| Answers from guidance alone | 73% fully correct, wrong on stopping, so it failed the default pass mark | probe 1 |

The menu figure comes from a rough script, `probes/routing-3-menu.py`. Treat it as a hint.

**Not yet known:** the Hermes 3 8B result, idle latency, sustained use, real operator messages, resume speed
and cost for supervisors, and whether the 27B can stay loaded beside coding agents. Hermes 3 is installed at
`~/.omlx/models/mlx-community/Hermes-3-Llama-3.1-8B-4bit`, and its bake-off run hadn't reported when this was
written.

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
candidates: Hermes 3 8B (downloaded), Qwen3.5-2B and 4B, Gemma 4 E2B and E4B, and a smaller Qwen3.6 build. The
protocol is in [probe 2](../design/relay/probes/local-model-2.md).

## Decisions for the operator

1. **Approve the first slice as ordered above?** It takes capacity from production, though it stays off the
   production worker's path and is read-only.
2. **Is 94% precision the right pass mark,** with coverage tracked rather than required?
3. **Confirm the revised frame,** still marked proposed in the record: the operator's own critical path first.
4. **What is Relay made of?** The author recommends existing Ask surfaces, starting with the dashboard, because code
   answers first and a coding agent runs only for code. CH-03 in the record remains open.
5. **Download more bake-off candidates, or will the operator install them?**

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
  `design-sources/relay/`. S018 is in the record. S020 isn't yet.
- **Not yet in the record:** the operator's "Did you mean" idea and their approval to fetch Hermes. Both are in
  this proposal.
