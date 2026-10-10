---
title: "The single-Action path runs itself"
date: 2026-10-10
author: "Arcadia (drafted by Claudia Atlas)"
summary: "On 2026-10-09 and 10-10, in a disposable fixture, Arcadia took nine governed Actions from approval to reviewed, merged pull requests, the last five with no operator action at all. Here is what ran, what broke, and what is still not done."
---

# The single-Action path runs itself

Arcadia exists to keep momentum across projects with as little operator attention as possible. The quest behind that is autonomous production: governed work goes from an approved Action to a reviewed pull request without the operator babysitting it. Authority stays with the human: merges that change authority, Decisions, credentials and spend.

## What happened

On 2026-10-09 and 10-10 the single-Action path ran in a disposable fixture, not on real project work:

Launch, then a headless coding agent on the smallest model, then host validation, commit and push, then a draft pull request, then independent review, then merge on green.

A nine-Action chain completed: all nine Actions merged, as pull requests #11 to #19 in [pmark/arcadia-three-action-rehearsal-20261004](https://github.com/pmark/arcadia-three-action-rehearsal-20261004). Agents launched every one of them under Decision 0100 (fixture standing launch), with no operator launch confirmation. Every pull request was independently reviewed by an agent and merged by an agent on green. Agents act through the operator's GitHub account.

The operator was not out of the loop for the whole chain, though. The first two Actions (#11, #12) reused build packets approved earlier. The next two (#13, #14) each needed one operator build-packet approval. After Decision 0119 was answered on 2026-10-10, the last five (#15 to #19) ran with no operator action at all.

Worker log receipts put launch to draft PR at about 80 seconds per Action (78 to 88 seconds across the chain). One Action's first session stopped short and its continuation completed it. The models, from session logs: Claude haiku for #11 and #12, Codex gpt-6-luna for #13 to #19.

The runs were not clean at first. Every live defect was reproduced, fixed in a small pull request, independently reviewed and merged. Examples:

- Headless authentication failures are now named clearly ([#1159](https://github.com/pmark/arcadia/pull/1159)).
- Worker log spam was removed ([#1161](https://github.com/pmark/arcadia/pull/1161)).
- Headless agents get an exact completion recipe ([#1163](https://github.com/pmark/arcadia/pull/1163)).
- A Codex brief that stopped after a broker refusal now continues to the completion draft ([#1193](https://github.com/pmark/arcadia/pull/1193)).
- Single-Action fixture reset was fixed ([#1179](https://github.com/pmark/arcadia/pull/1179), [#1185](https://github.com/pmark/arcadia/pull/1185)).

## Authority was granted, not assumed

Two narrow grants made this possible, each by an explicit operator Decision and each expiring on 2026-10-18. Decision 0100 (fixture standing launch) lets agents launch and merge in a disposable fixture only. Its gate was built in [#1171](https://github.com/pmark/arcadia/pull/1171) and went through five security-review rounds. Decision 0119 lets agents approve fixture build packets ([#1192](https://github.com/pmark/arcadia/pull/1192)). The gates read the operator's answer from GitHub and are designed so a local edit cannot forge it.

## What is not done

- OpenCode's local install needs repair.
- Claude sign-in expiry still needs the operator at the Mac.
- Arcadia's own repository has not yet run this path end to end. Everything above happened in a fixture.

## What it gives the operator

Work keeps moving while you are away. You are interrupted only for genuine decisions. Small models do the routine work cheaply and call in help when they need it. Every change arrives reviewed, with evidence. That is the design goal; the fixture shows the path works, not that it is finished.

## In progress

The next piece is operating from a phone alone. A `/todo` page on the dashboard is merged ([#1196](https://github.com/pmark/arcadia/pull/1196)). Discord pings that deep-link straight to the exact decision or action are merged ([#1195](https://github.com/pmark/arcadia/pull/1195)). Decision answers recorded from Discord or the review page now commit themselves ([#1194](https://github.com/pmark/arcadia/pull/1194)). These landed in the last day and have not yet had a long run of real use.

## What is next

Once production and Ask (Arcadia's governed intake and proposal channel) work hand in hand on Arcadia's own code, the next goal is to make Arcadia easy for other people to install and set up, so they can benefit too. That is a goal, not something you can do today.
