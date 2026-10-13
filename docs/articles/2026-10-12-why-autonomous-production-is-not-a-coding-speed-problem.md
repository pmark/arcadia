---
title: "Why autonomous production is not a coding-speed problem"
date: "2026-10-12"
type: essay
slug: "why-autonomous-production-is-not-a-coding-speed-problem"
summary: "In one day a supervised team of Claude agents merged more than twenty pull requests toward unattended software production. The code was the fast part. Here is what was slow, why Claude Code's multi-agent 'ultracode' mode would speed up less than it seems, and where it would help."
author: "Arcadia (drafted by Claudia Mason)"
status: draft
claims_receipt: "docs/articles/receipts/why-autonomous-production-is-not-a-coding-speed-problem.md"
not_done: true
canonical: "https://arcadiamissioncontrol.com/notes/why-autonomous-production-is-not-a-coding-speed-problem/"
channels: [site, rss]
---

# Why autonomous production is not a coding-speed problem

Arcadia's goal is software production that runs for long stretches without the
operator, while the operator's attention is treated as the scarcest resource. On
2026-10-12 a supervised team of agents (a Lead model, Sonnet Drivers that wrote
the code, and fresh read-only Reviewers) built a large part of the machinery
for that. Someone fairly asked: for the sake of argument, couldn't we just use
Claude Code's "ultracode" to do all of this much more quickly?

The honest answer is "partly, and for the cheaper half of the work." This note
says why, using what the day actually produced.

## What was built, and what it cost

In about a day the team merged more than twenty pull requests: a platform
token ceiling, an in-Session environment probe, a validated per-session ledger,
one-click clears for two blocker kinds, a per-sentence approval validator, a
guard that refuses Plan changes inside an Active production scope, role and
brief guidance, and the first decision-card contract. The first supervised run on
the same repository, the day before, had taken about three hours to launch one
Session and then spent about 11.1 million input tokens (98% cache re-reads) with
no diff, because the Session's sandbox could not write the workspace database.

The code in those pull requests was written by Sonnet Drivers in minutes. That
is the part a faster or more parallel coding tool improves. It was not where the
time went.

## Where the time went

**Defects, not typing.** Four of the eight guard or validator pull requests (the
approval validator, the scope guard, the Session probe and the decision-card
contract) were blocked by an independent adversarial Reviewer, and two of
those (the approval validator and the decision-card contract) were blocked in
successive rounds. The approval validator needed three reviews: one of its
regression tests is the string "Implementation requires no approval, but a
separate approval is nice to have", which it must now flag, and later rounds
added more bypass classes. The Session probe was repaired across several commits
for packaging, nonce binding and an overly broad allow rule. The
decision-card contract failed open on a garbage clock and accepted invisible
characters as "non-empty" text. Each time the Driver's own tests passed. The
reviewer ran an attack string and found the hole.

**Authority and decisions.** Writing a guard is easy; deciding what the platform
may do without a person is not. Which pull requests may a Lead merge on green?
Which changes adjust approval text, permission allow rules or the active Plan,
and so must wait for the operator? Every one of those lines is a Decision, and
every wrong guess costs trust, not time. An agent does not author and activate a
Plan in one stretch, and no amount of coding speed changes that.

**Ceremony and state.** A single checkout, a single queue and a single pointer
meant that completing an Action, splitting a remainder, activating the next Plan
and repairing the queue order were each governed settlements that had to run in
the right place in the right order. Much of the day's friction table (about
twenty-five rows) is this: settle commits that carry the operator's name, a split
that cannot be recorded in a draft Plan, a local main that drifts after every
merge. These are serial by design.

**The live environment is the unknown.** Nothing has yet run as a real unattended
Session with the ceiling, probe and capacity gate switched on. Sandboxes,
provider sign-in, and the way each provider reports usage (some only at the end
of a run) are facts you only learn by running.

**Attention.** The operator's touches were counted by hand: more than a dozen
merges plus several chat answers over the day. The program's target is at
most one touch per merged Action, from a phone, from one page. Reaching it is a
product problem (cards, batching, default-and-veto), not a code-volume problem.

## What "ultracode" would and would not change

As described in the Claude Code harness, ultracode is an explicit opt-in to run
a scripted, multi-agent workflow: many agents, fan-out and verification passes,
likely long-running and expensive. We did a hand-rolled version of this all day. It would help
in three places:

1. **Parallel build of independent Actions.** Several Actions in the draft
   Plans touch disjoint files. Fanning them out saves wall-clock time.
2. **Mechanical review fan-out.** Running many attack-string passes in parallel
   against a diff is cheap for a script.
3. **Replaying receipts into fixtures.** A deterministic fan-out for the
   Replayer role.

It would not change the five things above, and it carries costs of its own:

- **More defects reach review per hour, and review is the limit.** Parallel
  Drivers multiply the pull requests the operator and Reviewers must clear, and
  the day showed that review, not generation, is where correctness comes from.
- **Spend scales with agents.** The first run's 11.1M tokens came from one
  Session. A fan-out multiplies the exposure; the platform ceiling and the
  probe exist precisely because prompt discipline is not a spend bound.
- **Serial state does not parallelise.** The queue, pointer, settlement and
  active-Plan surfaces are one-writer by design; more agents contend for them.
- **Decisions are not generated by more agents.** A sharper Lead cannot approve a
  policy, grant authority or spend on the operator's behalf.

The right use is to treat ultracode as an accelerator for the middle of the
loop, after the gates are deterministic: cards for decisions, a ceiling and
probe for spend, a situation registry for exceptions, a close-out record and
selector for handoff. Without those gates, a faster generator is a faster way to
produce pull requests that need the operator's attention.

## What is not done

- No unattended multi-Plan run has happened. All of the above ran supervised, as
  a simulation of unattended sessions.
- The decision-card contract is a schema only: no rendering on /todo, no batch
  merge button, no default-and-veto, no delegation policies yet.
- A first live Codex Session with the ceiling, probe and capacity gate on has not
  run; sandbox, provider-usage and preservation behaviour are untested live.
- Plan-to-Plan handoff, red-main rollback, a poison-Plan breaker and orchestrator
  recovery are drafted as Plans, not built.
- The claim that ultracode "would help in three places" is a judgement from this
  day's work, not a measurement; it was not run on this problem.
