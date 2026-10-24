---
title: "Arcadia agent identities: who does what, and why"
date: "2026-10-23"
type: essay
slug: "agent-identities-roles-and-behaviors"
summary: "Arcadia's named identities make responsibilities easier to discuss. Roles, specializations, skills and behaviors give agents a shared way to carry out bounded work."
author: "Arcadia (drafted by Cody Atlas; editorial profile Clara)"
status: draft
claims_receipt: "docs/articles/receipts/agent-identities-roles-and-behaviors.md"
not_done: true
canonical: "https://arcadiamissioncontrol.com/notes/agent-identities-roles-and-behaviors/"
channels: [site, rss]
---

# Arcadia agent identities: who does what, and why

When work stalls, you want to ask, “What is happening, and what should we do?”
You should not have to become an expert in agent orchestration first.

Arcadia's checked-in guidance gives that conversation a familiar shape: ask
Rowan to coordinate, Mira to investigate, or Clara to explain. Behind those names
are explicit responsibilities and working methods. This article explains that
contract; its examples illustrate intended collaboration, not a measured
production result.

## Five terms, one practical purpose

An **identity profile** is the recognizable colleague you address: a name,
purpose and documented set of capabilities. “Mira” means the Investigator
profile. It does not identify a particular model or a permanently running agent.

A **role** defines responsibility and eligibility for an assignment. Arcadia
keeps seven internal roles, including planner, implementer and reviewer roles.
Ellis can plan a correction or implement it, but each assignment specifies which
responsibility applies. A planning assignment does not quietly acquire permission
to change code.

A **specialization** narrows the domain or method: database migration research,
execution-lifecycle architecture, technical writing. It adds focus within the
role, rather than inventing another job title or increasing permissions.

A **skill** packages instructions an agent can retrieve to carry out work.
Mira's release-investigation skill, for example, explains how to follow evidence,
compare possible causes and propose a testable correction. Loading instructions
is preparation; it does not itself launch work or authorize an operation.

A **Behavior** describes a reusable way of working, with scope, evidence and
stopping conditions. Supervision and bounded recovery are examples. Here,
“behavior” means a working contract, rather than a personality trait. A skill
can carry the instructions for following one.

For a useful assignment, these pieces fit together: **Mira** investigates as a
**researcher**, specializes in a particular failure, and follows the relevant
**skill and Behavior**. The brief still names the question, evidence, owner,
expected result and stopping point.

## Meet the colleagues

| Identity | What to ask for |
| --- | --- |
| **Rowan — Coordinator** | Current priorities, blockers, ownership and the next move. |
| **Mira — Investigator** | Evidence-backed explanations and a testable correction. |
| **Ellis — Engineer** | A technical design or an implemented candidate. |
| **Nadia — Critic** | Challenge to a plan's assumptions and missing evidence. |
| **Sage — Reviewer** | Defects in the exact candidate being reviewed. |
| **Quinn — Verifier** | Evidence that acceptance criteria are actually met. |
| **Vida — Health Assessor** | Operational health, freshness, risks and unknowns. |
| **Clara — Technical Writer** | Useful writing, discoverability and approved editorial delivery. |

You can address “Coordinator” instead of “Rowan.” Rowan is the normal contact when
you want an outcome without deciding who should handle every part. The primary
purpose is clear collaboration between agents; the names make it easier to talk
about that collaboration.

## Three ways this helps

**A repair keeps stalling.** Try: “Rowan, find the blocker and get the repair
moving.” Imagine the missing evidence concerns shutdown. Mira investigates why a
process remains alive; Ellis designs the correction. Nadia can challenge whether
the plan covers interruption. Once implemented, Sage examines the candidate and
Quinn verifies the required result. Those judgments answer different questions;
renaming one session does not make its self-review independent. Only the help
needed for this assignment should participate.

**The services are green, but the goal is unfinished.** Ask: “Vida, assess system
health. Rowan, tell me what still blocks delivery.” Vida can report current
operational observations while keeping stale or unavailable evidence unknown.
Quinn's acceptance question remains separate: a responsive service does not
prove that an unattended workflow finished correctly. The distinction helps you
ask for the missing proof rather than another reassuring status summary.

**A change needs an explanation.** Ask: “Clara, explain the shipped change for
someone new to Arcadia.” Clara can use Ellis's technical evidence and Mira's
findings, shape a practical explanation, and preserve uncertainty. Agent-oriented
topics and deep sources belong in `docs/articles/`; polished reader-facing pieces
belong in Arcadia Mission Control. Preparing a guide or social copy does not
establish that it has been published.

## What is not done

Names do not provide automatic routing, shared memory, guaranteed expertise or
model selection. Several sessions can use one profile; task and session
references distinguish them, while receipts retain the actual provider/tier
identity. Continuity comes from evidence.

This is a source draft for later AMC adaptation, not a hosted guide or evidence
that unattended production has succeeded. The frontmatter URL is intended,
unverified and not a publication receipt. No eight-agent pipeline is required.
Start with the outcome and the colleague's name; let the bounded assignment make
the work precise.
