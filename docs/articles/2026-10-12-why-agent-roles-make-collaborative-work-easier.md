---
title: "Why agent roles make collaborative work easier"
date: "2026-10-12"
type: "essay"
slug: "why-agent-roles-make-collaborative-work-easier"
summary: "Arcadia defines seven agent roles with distinct responsibilities. A practical example shows how clear assignments and independent review can make agentic work easier to manage."
author: "Arcadia (drafted by Cody Atlas)"
status: "draft"
claims_receipt: "docs/articles/receipts/why-agent-roles-make-collaborative-work-easier.md"
not_done: true
canonical: "https://arcadiamissioncontrol.com/notes/why-agent-roles-make-collaborative-work-easier/"
channels: ["site", "rss"]
---

# Why agent roles make collaborative work easier

A capable agent can research a problem, suggest a plan, write code and check the result. Giving it a clear role helps you decide which of those jobs it should be doing right now, what it may change, and what evidence it should return.

Arcadia defines seven roles. The **Lead** owns a bounded assignment and coordinates its progress. Where its work contract permits, the Lead can also implement routine changes as the sole development writer. A **Planner** proposes how to approach larger work, while a **Plan critic** challenges that proposal before time is spent building it. A **Researcher** investigates questions and brings back sources and uncertainty. The **Implementer** makes the change. A **Code reviewer** independently examines the candidate for defects, and independent **QA** checks whether it meets the agreed acceptance criteria.

Imagine adding a CSV export to an app. A Researcher might inspect the existing data model and identify sensitive fields. A Planner could propose a small first version; the Plan critic might notice that the proposal never defines who may download it. The Lead keeps the assignment focused, and one Implementer builds it. A fresh Code reviewer examines access checks and tricky inputs. QA tries the actual download and verifies the promised columns and contents.

Each role asks a different question: What do we know? Is this a sensible plan? Is the implementation sound? Does the result satisfy the request? That separation makes omissions easier to notice. It also gives you clearer handoffs: a researcher returns findings, an implementer returns a change, and a reviewer returns a judgment grounded in evidence.

Roles help control access, too. A researcher can investigate a production problem without permission to edit production. A specialization such as “database migration researcher” narrows its subject; it does not expand its authority. Independent review provides another useful boundary: the agent that wrote a change should receive a fresh review from someone else.

You can start with a small version of this approach. Name the assignment, identify its owner, define what success looks like, and arrange an independent review. Add planning, research or QA roles when the task needs them. One agent can take different assignments over time, while ownership and review independence stay clear.

Supervision can help you notice friction and gather lessons. Arcadia treats supervision as a relationship rather than an eighth role. Clear responsibilities make the work easier to inspect and hand over with less repeated explanation.

## What is not done

Arcadia’s role definitions and brief commands are implemented; automatic delegation admission and event-triggered supervision are still future work. You can try these habits today through explicit assignments and independent review.
