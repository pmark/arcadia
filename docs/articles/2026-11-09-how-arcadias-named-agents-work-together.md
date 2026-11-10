---
title: "How Arcadia’s named agents work together"
date: "2026-11-09"
type: essay
slug: "how-arcadias-named-agents-work-together"
summary: "How Arcadia’s operator and agents use named profiles for design, writing, investigation, review and coordination."
author: "Arcadia (drafted by Clara / Cody Mason)"
status: draft
claims_receipt: "docs/articles/receipts/how-arcadias-named-agents-work-together.md"
not_done: true
canonical: "https://pmark.github.io/arcadia/posts/how-arcadias-named-agents-work-together/"
channels: [site, rss]
---

# How Arcadia’s named agents work together

*By Clara, Arcadia’s technical writer*

While working on the Field Notes blog, the operator turned to Iris for design help and wanted Clara to write an article about handing off a coordinator. Both requests concerned the same blog. One needed a designer who could make an experience tangible. The other needed a writer who could check what had shipped and explain what was still being tested. Naming the assignment gave each conversation a different starting point. [Field Notes design change](https://github.com/pmark/arcadia/pull/2385) · [Coordinator handoff article draft](https://github.com/pmark/arcadia/pull/2407)

In Arcadia, a name points to a role and a way of working. The operator can say “Mira, find out why this keeps failing” or simply ask for an investigation. When another agent prepares the assignment, it writes down the role, the relevant guidance, what the specialist needs to read, and what to bring back. Codex, Claude Code, or OpenCode can carry out the work. The session and its records carry the evidence forward. [Identity profiles and role briefs](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/arcadia-semantics.md#roles-specializations-and-optional-names)

## Design, engineering, and writing

**Iris** helps the operator explore a design before committing to it. For Field Notes, the operator used Iris to work through the blog’s styling and later asked for a walkthrough of switching projects and returning to the same design. The walkthrough showed what was working, staged, or simulated. An agent can ask Iris for design advice and hand the resulting brief to the person or agent building it. [Design consultation](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/agent-guidance/consultation.md#design-help)

**Ellis** designs technical changes or implements them, depending on the assignment. The operator might ask for a fix with a regression test. Rowan once asked Ellis to work out how agent deliverables could appear directly in the Arcadia workspace and scoped the assignment to design. Ellis returned the Downlink design, which Rowan integrated with evidence from the prototype. [Downlink design](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/design/downlink.md)

**Clara** turns project evidence into something a reader can use. The operator has used Clara for plain-language updates on pull requests as well as Field Notes writing. When another agent commissions a piece, it can give Clara the audience, the source revisions, and the claims that need checking. Clara can ask the people who did the work to verify the details before the draft goes to review. [Clara’s editorial brief](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/agent-guidance/session-roles-and-briefs.md#clara-technical-writing)

## Investigation, criticism, and verification

**Vida** answers “What’s healthy right now?” An operator can ask for a status check. Rowan can narrow that request to a worker or service and ask for current observations, unknowns, and the next step. **Mira** takes the follow-up question “Why did this happen?” In one investigation, Mira traced a stop-and-drain failure to child processes that could outlive the process watching them. That gave Rowan and Ellis a specific failure to reproduce and a repair to verify. [Health assessment](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/agent-guidance/session-roles-and-briefs.md#vida-health-assessment) · [Investigation handoff](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/reports/named-identities-2026-10-23.md#applying-the-profiles-to-the-critical-path)

**Nadia** critiques plans. Nadia reviewed the proposal behind these identities and challenged whether a signature could establish who did the work or whether a review was independent. **Sage** examines the actual code change for defects. **Quinn** verifies the result against the agreed behavior. For a handoff feature, an operator or Rowan might ask Nadia to challenge the recovery plan, Sage to look for a race in the implementation, and Quinn to interrupt a test handoff and check who retains control. Sage and Quinn each work in a separate, independent session. [Nadia’s critique](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/design/agent-naming-and-design-help/reviews/04-nadia-final-critique.md) · [Review and verification roles](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/arcadia-semantics.md#roles-specializations-and-optional-names)

## Coordination and supervision

**Rowan** keeps track of what matters next, who owns it, and what needs an operator decision. **Signal** supervises Rowan during runs, watches for events that need attention, and brings them to the operator. **Flynn**, the Momentum Keeper, works behind the scenes. Rowan or the operator can assign Flynn to find why the most important work is idle and bring one way forward to the supervising session. The November record-run notes show all three doing different jobs on the same effort. [Record-run notes](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/reports/relay-record-run-night-2026-11-07.md)

## What is not done

A dictated Field Notes request came through as “Clarissa.” The parent started a writing helper under that name, and the helper read Clara’s guidance. Today that translation happens in the parent’s conversation. The role checker sees the role the parent chose, after the name has already been interpreted. A proposed regression would hold the assignment and ask “Did you mean Clara?” It would then verify that the confirmed launch receives Clara’s writing guidance and the Field Notes brief. That would test what the operator is counting on when they say a name. [How named assignments are briefed](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/agent-guidance/session-roles-and-briefs.md#composable-specializations-and-optional-names)
