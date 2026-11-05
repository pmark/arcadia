---
title: "Arcadia Design checks the trail, not the truth"
date: "2026-11-03"
type: essay
slug: "arcadia-design-checked-archive"
summary: "Arcadia Design turns pasted plans into an archive that a command can check for traceability, not correctness. Its first real use, the Relay design, passed the plain check and still got a hold from a read-only critic."
author: "Arcadia (drafted by Claudia Mason as Clara, technical writer)"
status: draft
claims_receipt: "docs/articles/receipts/arcadia-design-checked-archive.md"
not_done: true
canonical: "https://pmark.github.io/arcadia/posts/arcadia-design-checked-archive/"
channels: [site, rss]
---

# Arcadia Design checks the trail, not the truth

If you build with coding agents, you end up with several plans for one piece of work. One came from you, one from an agent, one from a document you found. Choosing between them is easy to do badly and hard to audit.

Arcadia Design is a skill for this. It works in Codex, Claude Code and OpenCode and comes with a command, `arcadia design check`. This note covers what each does, and what the command cannot tell you.

## Three depths

**Quick** is the default: a bounded answer, no record. **Sustained** keeps a design brief, only when you ask. **Large module** adds the stages below, for work with more than one source or more than one session.

## What the large-module stages do

The frame comes first. Before comparing anything, the skill writes down the outcome, the experience target, the non-goals and the requirements. Each requirement points to the mission quotes it serves. You confirm the frame. It comes first so the pasted plans do not set the bar they are judged against.

After that you paste anything, at any time, and the skill asks no question. Each paste gets an ID, its origin and a hash. Third-party and client text stays outside the repository by default, and analysis of it paraphrases with a locator. The operator's and agents' own words are kept verbatim.

Each source is then split into concepts, one source at a time. Concepts describing the same mechanism are merged, keeping every origin. Each is audited against the codebase as existing, partial, missing or conflicting.

Then comes choosing. A choice a reasonable person could make differently goes to you as a Decision. A concept serving no requirement is cut. Rejected ideas keep a reason; parked ones keep a revival condition.

## What the command checks

`arcadia design check <path>` is read-only and reports every problem it finds, not only the first. It checks that:

- every ID is unique and every reference resolves;
- every source kept in the repository matches its recorded hash;
- every mission quote appears word for word in the Project file it cites;
- every rejected concept has a reason, every parked one a revival condition, and every chosen one a requirement it serves.

With `--ready`, it also wants a confirmed frame, settled choices, and independent reviews of the current record covering mission, evidence and failure modes.

The skill is explicit about what a pass means: every piece traces to a source and the mission, load-bearing claims were checked, and independent critics failed to break the design or you accepted the risk. It does not prove the design is right.

The record format also lists what the check cannot catch: a paste mislabelled as yours, a wrong `rights` value, and a mission quote that exists but does not really support its requirement. Those are for the author and the critics.

## The first real use

The first design kept this way was the [Relay design](../design/relay/brief.md). As of 2026-11-05, at commit `74dc1f07c`, its record holds 31 sources, 213 concepts, 18 requirements, 6 choices and 4 reviews.

The plain check passes. At that commit the `--ready` check fails with 67 problems, among them: several requirements have no chosen concept, many concepts are still undecided, and blocking findings from the first review are still open.

The first review came from a read-only critic who wrote none of the design, though the record marks it as not independent of the authors, so it does not count toward `--ready`. Its [report](../design/relay/reviews/R1-relay-critique.md) returned `hold`, with 18 findings, 9 of them blocking. The frame has since been confirmed, and three later reviews covered the Workspace layers design, passing with changes. The first review's open blocking findings have not been judged again. Two of its findings show why the check is not enough:

- The riskiest assumption was that the existing guidance could answer a newcomer's questions. A probe missed its pass mark, but the brief had called the result inconclusive.
- A default was recorded as the operator's choice when it had been settled by the operator's silence.

The command could not catch either, because both are facts about the world, not the record's structure. The critic caught them by reading the sources and the code. The record now marks that assumption as contradicted.

## What this does and does not show

This is one design, written by one agent. No one has compared it with planning without the archive, and its cost is unmeasured. The claim that holds is narrow: the archive gave the critic a trail to follow, the check kept the trail intact, and the critic found the problems.

## What is not done

The Relay record is the only one in the repository, and it has not passed `--ready`. Relay itself, the conversational interface, is not built. Parts of the Workspace layers design have shipped, such as system status on every Workspace view.
