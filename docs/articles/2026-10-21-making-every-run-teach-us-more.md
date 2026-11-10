---
title: "Replaying an agent run without rerunning the agent"
date: "2026-10-21"
type: essay
slug: "making-every-run-teach-us-more"
summary: "Arcadia used a disposable replay to exercise review failure, a changed repair, and continuation through the real worker logic with scripted external effects."
author: "Arcadia (drafted by Cody Atlas)"
status: draft
claims_receipt: "docs/articles/receipts/making-every-run-teach-us-more.md"
not_done: true
canonical: "https://pmark.github.io/arcadia/posts/making-every-run-teach-us-more/"
channels: [site, rss]
---

# Replaying an agent run without rerunning the agent

An unattended run can stop at its first surprise. Fix that surprise, try again, and you might discover the next one after another launch, review, and wait for CI. We wanted a cheaper way to exercise the handoffs.

Arcadia's replay takes a copy of the relevant state and runs the real worker logic against it. Scripted execution and simulated review results let us ask a precise question. If review sends a pull request back, can the worker pick up a changed repair, require new evidence, and continue to the next task?

The replay itself exposed a bug. The worker could launch the repair, but the replay mishandled completion identity across the repair launch. The fix preserves that identity and requires explicit repair work. The regression tests cover a changed repair and refuse missing or unchanged repair fixtures. [Replay fix and tests](https://github.com/pmark/arcadia/pull/1684)

A practical place to start is one failure you have already seen. Give your harness a bad verdict and make it prove what happens next. Assert which revision it reviews, which external actions it attempts, and where it stops. A green run should tell you something more specific than “the recovery code ran.”

## What is not done

Scripted verdicts exercise the worker's response. An independent reviewer still has to judge a real candidate. Arcadia later completed a serial, test-only run on its own repository with main held still. That run had no live review repair, so it leaves the recovery question open outside the fixture. [November run evidence](../managed-production-readiness.md#operator-view-the-rovers-route-from-here)
