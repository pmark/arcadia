---
title: "Give agents a way to suggest work without starting it"
date: 2026-11-09
type: essay
slug: "how-an-idea-becomes-governed-work"
summary: "A preview receipt, a separate activation, and revision-bound completion evidence give agents room to propose work while keeping the queue deliberate."
author: "Arcadia (drafted by Claudia Atlas)"
status: approved
claims_receipt: "docs/articles/receipts/how-an-idea-becomes-governed-work.md"
not_done: true
canonical: "https://pmark.github.io/arcadia/posts/how-an-idea-becomes-governed-work/"
channels: [site, rss]
---

# Give agents a way to suggest work without starting it

An agent debugging a release can spot a useful cleanup. If it can start every cleanup it spots, the queue can change faster than anyone can review it. If the only place to leave the idea is chat, the next session may never see it.

Arcadia gives the agent a structured request called an **Agent Ask**. A proposal preview records the request and returns a receipt while leaving the Project's documents and queue as they were. The receipt tells the next reader that the idea was captured. [Agent Ask preview contract](../agent-guidance/agent-asks.md)

A separate step creates a draft Plan with Actions, each with a next step and an observable acceptance criterion. Activation selects the Plan and sets its first current Action. The record stays explicit about which work can run and which change needs an operator Decision. A completion Ask then binds evidence for every criterion to a candidate revision. [Settlement contract](../agent-guidance/agent-asks.md#asking-arcadia-to-change-project-state)

The November test-pin Plan shows what happens at the other end. After the final test change passed review and the worker merged it, the checked-in Plan became complete and lost its `current_action`. The Project could still point at that completed Plan while the operator chose a successor. A finished queue item and authority to start the next Plan are separate facts. [Completed Plan](../plans/record-run-unattended-test-pins-20261107-part-2.md) · [Final pull request](https://github.com/pmark/arcadia/pull/2351)

You can borrow the idea with three records. Keep a place for suggestions, an explicit record of what may run, and completion evidence tied to the exact output. Each record answers a different question when an agent comes back after an interruption.

## What is not done

The November example proves a test-only Plan completion. Choosing a successor and approving a new production START remain separate steps.
