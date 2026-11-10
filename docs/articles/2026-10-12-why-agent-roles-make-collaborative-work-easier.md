---
title: "Who writes the change, and who checks it?"
date: "2026-10-12"
type: "essay"
slug: "why-agent-roles-make-collaborative-work-easier"
summary: "Arcadia assigns one writer and keeps implementation review and acceptance verification independent."
author: "Arcadia (drafted by Cody Atlas)"
status: "draft"
claims_receipt: "docs/articles/receipts/why-agent-roles-make-collaborative-work-easier.md"
not_done: true
canonical: "https://pmark.github.io/arcadia/posts/why-agent-roles-make-collaborative-work-easier/"
channels: ["site", "rss"]
---

# Who writes the change, and who checks it?

Imagine asking an agent to add a CSV export. Someone has to decide who may download it, someone has to write it, and someone has to try it with an account that should get denied. A clear assignment tells each agent which question it owns and what evidence to return.

Arcadia registers seven roles. A Lead owns coordination, a Planner proposes an approach, and a Plan critic challenges it. A Researcher investigates, an Implementer makes the change, a Code reviewer looks for defects, and QA checks the agreed outcome. A small change can use just the roles it needs. The development candidate has one writer at a time, and a fresh reviewer examines the exact revision. [Role and review rules](../agent-guidance/session-roles-and-briefs.md) · [Pull request review](../agent-guidance/pull-requests.md#independent-review-gate)

Names make the assignments easier to discuss. Ellis can plan one task and implement another. Clara writes and fact-checks editorial drafts as an implementer. Both still work inside the boundaries of the assignment. [Identity profiles](../arcadia-semantics.md#roles-specializations-and-optional-names)

For a small change, start with a named owner, a concrete acceptance check, and an independent reviewer. In the CSV example, ask QA to verify who can download the file and what comes out. A good code review of the access check and a successful test of the export answer different questions.

## What is not done

The registry and briefing commands define and validate roles. Automatic admission of delegated sessions remains future work. An assigned role by itself supplies no permission to launch a session.
