---
title: "One contact, three agents: how the operator works with Signal, Flynn and Rowan"
date: "2026-11-14"
type: essay
slug: "one-contact-three-agents"
summary: "How the operator describes working in the Arcadia and PrivatePracticeNow Projects with Signal, Flynn and Rowan, what the repository records today, and where the operator's picture runs ahead of it."
author: "Arcadia (drafted by Clara / Claudia Mason)"
status: draft
claims_receipt: "docs/articles/receipts/one-contact-three-agents.md"
not_done: true
canonical: "https://arcadiamissioncontrol.com/guides/one-contact-three-agents/"
channels: [site]
tags: [agent-workflows]
---

# One contact, three agents: how the operator works with Signal, Flynn and Rowan

*By Clara, Arcadia's technical writer. Source revision: `pmark/arcadia` at `0364e51c5`, 14 November 2026.*

Each claim below carries a label. **Observed** means a file in the repository says it (path and line given). **Operator-stated** means the operator said it and the repository does not record it. **Direction** means it is proposed or planned and does not exist yet.

## The operator's account (operator-stated)

The operator now works in the Arcadia Project, and in the PrivatePracticeNow (PPN) Project, with a team of three agents: Signal, Flynn and Rowan. The team gives the operator one point of contact. In practice the operator talks with Signal most and Rowan a little. The operator hopes Relay, the planned single operator interface, could one day watch over all three. The operator also hopes the repository will soon reflect what they envision as source truth.

Nothing in the repository records PPN usage of this team. That part is the operator's own account.

## What the repository records today

**Signal is the operator's contact.** Until Relay ships, Signal is the operator's single contact. It supervises Rowan and owns monitoring and wake-ups (observed: `AGENTS.md:42-44`; `docs/agent-guidance/signal.md:3-5`). Signal is a supervisor relationship, not a registered role, and grants no authority.

**Rowan coordinates.** Rowan is the Coordinator, Role `lead`. It establishes what matters, who owns it and what is blocked, and keeps Plan and Action custody (observed: `docs/arcadia-semantics.md:160-167`, `:175`; `AGENTS.md:41-47`). A session using this guidance starts as Rowan by default.

**Rowan is not tied to one coding agent.** The profile applies "whether it runs in Codex, Claude Code or OpenCode" (observed: `docs/arcadia-semantics.md:165-166`). Other runtimes such as Antigravity are explicitly unsupported today (observed: `docs/plans/unify-interactive-and-unattended-coordination-with-safe-concurrent-actions.md:94`). "Any coding agent" is the direction, not the present.

**Rowan branches out into sub-agents.** Decision 0114 lets a top-level Lead request a planner, plan-critic, implementer or researcher one level down; delegates never delegate (observed: `docs/agent-guidance/session-roles-and-briefs.md:29-32`). Rowan resolves each launch's identity, model and effort with `arcadia role brief`, starts on the cheapest tier and gives the helper its brief (observed: `docs/agent-guidance/helper-launch.md:8-30`). The helper reports to Rowan, which is the single contact for the sessions it supervises (operator-stated; consistent with `AGENTS.md:45-47`, where helpers never message the operator). Reviewers and QA are separate sessions, not Rowan's children (observed: `session-roles-and-briefs.md:31-32`, `:279-282`).

**Flynn is Rowan's helper.** Flynn, the Momentum Keeper, is a supervisor-class helper under Rowan. It finds where the critical path is idle, proposes one route to its supervising session, and never merges, spends, touches credentials or messages the operator (observed: `session-roles-and-briefs.md:165-186`). So the operator talks to Signal and Rowan; Flynn reports to Rowan.

**Not every session runs in tmux.** Rowan and Signal successor sessions launch through Arcadia's tmux launcher, with proof that the first prompt arrived (observed: `src/coordinator/relay.ts:26-31`, `:49` where `RELAY_ROLES` is rowan and signal, and `:229`). The launch runs because Decision 0191, "may arcadia's deterministic relay launch successor coordinator sessions", is approved with answer A (`docs/decisions/0191-may-arcadia-s-deterministic-relay-launch-successor-coordinator-sessions-signal.md:25`). Flynn runs as a background Claude session (`claude --bg --remote-control`) and never uses tmux (observed: `session-roles-and-briefs.md:194-199`). Production workers use their own launch path.

## Where the operator's picture runs ahead

- **Relay (direction).** Relay is designed, not built (observed: `docs/agent-guidance/relay-mode.md:6`). The design makes it the conversational front end that absorbs Signal (`AGENTS.md:44-45`), not a fourth watcher above the three. Its local-model routing has been probed, not built; its order is rules, then a local model, then frontier models (`docs/design/relay/decision-interface.md:10-16`).
- **Many sessions at once (direction).** Running more than one Action at a time is unproven; Rowan's delegation is one level deep.
- **Production (observed).** Production stays Off pending a separate START approval (`AGENTS.md:27`). Nothing here means production runs on its own.
- **Source truth (operator-stated).** The operator hopes the repository will soon reflect their picture. This article records the gaps in the proposal listed below rather than treating the picture as fact.

## What is not done

Two gaps are submitted as proposals: Relay's role relative to Signal and the single-contact model, and a statement of which sessions use tmux. Neither grants authority.

## Claim ledger

| # | Claim | Label | Evidence |
|---|---|---|---|
| 1 | Operator works in Arcadia and PPN with Signal, Flynn and Rowan | Operator-stated | Operator request, 14 Nov 2026. No PPN record in the repository |
| 2 | Single point of contact; talks with Signal most, Rowan a little | Operator-stated | Operator request |
| 3 | Until Relay, Signal is the single contact and supervises Rowan | Observed | `AGENTS.md:42-44`; `signal.md:3-5` |
| 4 | Rowan is Coordinator (`lead`); runs in Codex, Claude Code or OpenCode | Observed | `arcadia-semantics.md:160-167` |
| 5 | Other runtimes (Antigravity) unsupported today | Observed | `unify-interactive-...md:94` |
| 6 | Rowan can have depth-1 helpers; they never delegate; reviewers/QA separate | Observed | `session-roles-and-briefs.md:29-32`, `:279-282` |
| 7 | Rowan resolves identity, model and effort per helper launch | Observed | `helper-launch.md:8-30` |
| 8 | Rowan is the single contact for its sub-agents | Operator-stated | Consistent with `AGENTS.md:45-47` (helpers never message the operator) |
| 9 | Flynn is Rowan's helper and never messages the operator | Observed | `session-roles-and-briefs.md:165-186` |
| 10 | Rowan/Signal successors launch via tmux with first-prompt proof | Observed | `src/coordinator/relay.ts:26-31`, `:49`, `:229`; Decision 0191 approved, answer A (`docs/decisions/0191-may-arcadia-s-deterministic-relay-launch-successor-coordinator-sessions-signal.md:25`) |
| 11 | Flynn runs as a background Claude session and never uses tmux | Observed | `session-roles-and-briefs.md:194-199` |
| 12 | Relay is designed, not built; absorbs Signal | Observed | `relay-mode.md:6`; `AGENTS.md:44-45` |
| 13 | Relay could watch over all three | Direction | Operator hope; the design says absorb, not watch |
| 14 | Relay routing: rules, local model (probed), frontier | Observed | `decision-interface.md:10-16` |
| 15 | Any coding agent, not just three | Direction | Not current fact |
| 16 | Concurrent Actions | Direction | Unproven (`docs/plans/unify-interactive-and-unattended-coordination-with-safe-concurrent-actions.md:12`, `:44`, "prove-shared-enrollment-at-concurrency-one") |
| 17 | Production Off pending START | Observed | `AGENTS.md:27` |
| 18 | Repository will reflect the operator's picture | Direction | Operator hope |
