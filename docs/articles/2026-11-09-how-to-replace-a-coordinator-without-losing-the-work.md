---
title: "How to replace a coordinator without losing the work"
date: "2026-11-09"
type: essay
slug: "how-to-replace-a-coordinator-without-losing-the-work"
summary: "Arcadia is building a coordinator handoff that snapshots work, checks prompt delivery, and transfers custody. Core pieces are on main and the automatic rollover still needs live proof."
author: "Arcadia (drafted by Cody Mason as Clarissa)"
status: draft
claims_receipt: "docs/articles/receipts/how-to-replace-a-coordinator-without-losing-the-work.md"
not_done: true
canonical: "https://pmark.github.io/arcadia/posts/how-to-replace-a-coordinator-without-losing-the-work/"
channels: [site, rss]
tags: [automation, agent-workflows, reliability]
---

# How to replace a coordinator without losing the work

During a November Arcadia run, a new coordinator took over and the operator had to retype an approval in the new chat. The goal is for Arcadia to start the successor itself and give it enough verified state to pick up the work. An approval should have a durable record the successor can check. [Run record](../managed-production-readiness.md) · [Day approval decision](../decisions/0200-decide-how-a-day-approval-under-decision-0173-reaches-a-rowan-that-takes-over.md)

The monitoring code already measures how full a coordinator's context is and can send alerts at 50%, 60%, and 75%. The separate launch command is designed to save the current plan, decisions, and watchers in a state capsule, pin its snapshot by hash, and give the new session a resume prompt pointing to that snapshot. [Context budget](../COMMANDS.md#coordinator-context-budget-2242) · [Capsule and launch code](https://github.com/pmark/arcadia/pull/2250)

Next comes proof of delivery. The launcher checks the successor's transcript for the exact resume prompt as its first user message. In the test with a stand-in for Claude Code, a truncated prompt leaves the outgoing generation in charge. The successor has to register its inherited watchers and verify the snapshot before accepting custody. Acceptance changes the recorded custodian in one transaction, after which guarded commands refuse the old relay generation. [Delivery test](https://github.com/pmark/arcadia/blob/8e740dd1793fa83d21caa205a1606b59c43ead64/tests/coordinator-relay-launch-proof.test.ts#L84-L114) · [Custody transfer](https://github.com/pmark/arcadia/blob/8e740dd1793fa83d21caa205a1606b59c43ead64/src/coordinator/generations.ts#L466-L497)

## What is not done

The November 9 hardening change is on main. First-custodian registration, timer-driven renewal, and automatic shutdown of the outgoing session are still open. The launch decision also requires two separately approved Claude Code probes. The next convincing result is a real rollover that starts at the context threshold and ends with a verified successor taking charge. [Merged change](https://github.com/pmark/arcadia/pull/2338) · [Open launch gates](../agent-guidance/coordinator-handoff-design.md#gates-before-real-renew-and-tick-wiring-2286) · [Launch decision](../decisions/0191-may-arcadia-s-deterministic-relay-launch-successor-coordinator-sessions-signal.md)
