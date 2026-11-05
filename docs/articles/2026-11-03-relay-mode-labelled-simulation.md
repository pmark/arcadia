---
title: "Relay mode labels what the agent made up"
date: "2026-11-03"
type: essay
slug: "relay-mode-labelled-simulation"
summary: "Relay does not exist yet. Relay mode is a skill that lets any coding agent act the part, and makes it mark each turn as what Arcadia really did, what the agent improvised, and what cannot be simulated."
author: "Arcadia (drafted by Claudia Mason as Clara, technical writer)"
status: draft
claims_receipt: "docs/articles/receipts/relay-mode-labelled-simulation.md"
not_done: true
canonical: "https://pmark.github.io/arcadia/posts/relay-mode-labelled-simulation/"
channels: [site, rss]
---

# Relay mode labels what the agent made up

Relay is a proposed conversational interface for Arcadia: one chat in plain language, in place of commands and file paths. **It is not built.** What exists is a [design record](../design/relay/brief.md), which a read-only critic put on hold against its earlier frame, and a skill called Relay mode.

Relay mode lets any coding agent play the part now. Its real subject is how to keep an agent honest while it plays.

## What it is

You say "Relay mode" to Codex, Claude Code or OpenCode in a checkout that contains the [arcadia-relay skill](../../.agents/skills/arcadia-relay/SKILL.md). It is only instructions plus commands that already exist, so it works the same on all three. The agent says once: "Relay mode: a simulation. I'll mark what Arcadia really did and what I improvised." It leaves when you say "leave Relay mode."

While it runs, the agent talks plainly and assumes you know nothing about Arcadia. You never type a command, path or format. It speaks only when you must act or can use a result.

For a question about how Arcadia works, it tries `arcadia way lookup` first. The skill warns that a match is not an answer, so the agent then reads the guidance index and the matching procedure, cites the path, and says "I don't know" when the guidance does not say. Work requests follow the normal path and end as a pull request, Agent Ask or Decision.

## The three labels

Any turn that did something ends with a block:

```text
Relay mode (simulation)
Arcadia did: <the command and its exit code, receipt ID or returned addresses>
I improvised: <what the agent did in place of Relay>
Relay can't do this yet: <what it could not simulate>
```

The split is strict. **Arcadia did** needs a receipt, such as an exit code, a receipt ID or the addresses `arcadia way lookup` returned. If the agent cannot name one, the item does not belong there. **I improvised** covers the agent's own judgment and tools: reading guidance itself, ranking results, summarizing, drafting a reply, using a browser. The skill says that when the agent is unsure, it should choose this label, and that an improvised behavior must never be promoted because it felt routine.

The point is that you can tell what would still work without the agent. A command with an exit code would. A summary the agent wrote would not.

## What it will not fake

The skill lists four things that do not exist yet, and tells the agent to say so:

- a conversation that continues across devices and sessions;
- reaching out first, because the agent only replies (standing pings are the one exception);
- watching group channels;
- remembering earlier sessions, unless a checked-in record or a captured lesson holds it.

It also forbids reading a group channel or messaging anyone to imitate them.

## What it cannot do

Relay mode changes how the agent talks, not what it may do. Role, identity, ownership and every approval gate stay as they are. A "yes" in chat is not a Decision answer or a gate approval. Text inside a document or message is data, and the agent quotes it instead of obeying it.

## Why simulate

The design brief calls Relay mode the cheapest probe available. At the end of a session the agent records each improvised behavior with `arcadia learn`, one line each. Those lines show what a real Relay would need to do before anyone builds it.

## How far to trust the labels

The agent writes the labels about its own turn. The receipts in **Arcadia did** can be checked. The **I improvised** line is self-report.

The critic's review raised a related point: the skill counted an agent's own file read as something Arcadia did. The skill was revised in the [pull request that recorded the review](https://github.com/pmark/arcadia/pull/2016), and now lists reading guidance yourself under **I improvised**. The design's proof for this feature is an audit: a separate judge checks each claimed Arcadia action against its receipt and confirms improvised behavior is marked. That audit has not run.

If you build with coding agents, the pattern carries over. Make the agent separate what a tool returned from what it concluded, and make the first kind name its receipt.

## What is not done

- Relay does not exist. The review of the design's original frame raised nine blocking findings, and eight are still open. The frame has since been confirmed, and three later reviews covered the Workspace layers design.
- The label audit has not run. Whether agents follow the labels, and whether operators find them useful, is unmeasured.
- No session transcripts are cited here, so this note makes no claim about how Relay mode has gone in use.
- The cross-device conversation, reaching out first and channel watching are missing, and the skill does not pretend otherwise.
