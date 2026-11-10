---
title: "Where unattended coding runs spend their time"
date: 2026-11-09
type: essay
slug: "why-autonomous-production-is-not-a-coding-speed-problem"
summary: "A supervised build in October and two bounded November efforts show why faster code generation addresses only one part of the delivery loop."
author: "Arcadia (drafted by Claudia Mason)"
status: approved
claims_receipt: "docs/articles/receipts/why-autonomous-production-is-not-a-coding-speed-problem.md"
not_done: true
canonical: "https://pmark.github.io/arcadia/posts/why-autonomous-production-is-not-a-coding-speed-problem/"
channels: [site, rss]
---

# Where unattended coding runs spend their time

In October, while building Arcadia's unattended coding loop, the team added a regression test for a sentence that said implementation required no approval and then called separate approval nice to have. The validator flags that wording. Pinning down the rule took several rounds of review. [Validator PR](https://github.com/pmark/arcadia/pull/1296) · [October build evidence](receipts/why-autonomous-production-is-not-a-coding-speed-problem.md)

A later run gave us a clearer view of the delivery loop. On November 5, one operator START led to three worker-merged pull requests on Arcadia's own repository. The tasks were small, test-only changes, one at a time, with a merge freeze on main. Review and QA together occupied the longest measured stage. The timing does not separate CI wait from review and QA execution. [Run timeline](../managed-production-readiness.md#run-record-attempt-3-card-start-run-unattended-20261105d)

On November 8 Pacific time, the worker merged 20 more test-only changes in five separately started batches. One batch stopped after the QA plan treated a quoted path in an example as a file the patch had to change. A parser fix addressed that case. Faster typing would have left the same stop in the same place. [Batch evidence](../managed-production-readiness.md#operator-view-the-rovers-route-from-here) · [Parser fix](https://github.com/pmark/arcadia/pull/2325)

If you measure a similar system, time the stages separately. How long did the agent spend building? How long was it waiting on a check, independent review, or an operator? Which stop cost a retry? Those answers tell you where a faster model, a clearer task, or a small deterministic fix would buy time.

## What is not done

These runs established a narrow delivery envelope. They leave substantive source changes, concurrent work, a moving main, and live repair loops outside that proof. The 20 changes came from five separately started batches.
