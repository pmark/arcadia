---
arcadia: v1
type: decision
id: "0007"
slug: demo-first-delivery-contract
project: arcadia
plan: demo-first-delivery
status: approved
question: What proof and human responsibility are required before software work can be accepted, released, or delivered?
gap_type: missing-decision
recommendation: Require a demo-first handoff with a stable proof surface, keep the Log as the audit trail, require independent QA evidence before release, and reserve acceptance, merge, deployment, and client delivery for explicit operator Decisions.
confidence: high
decided: 2026-08-01
answer: "Software work with observable behavior must be handed to the operator as a stable runnable demo before the operator is asked to interpret its Log. The operator must exercise the candidate and personally decide whether it is useful; before accepting it, approving merge or release, or delivering it to a client, the operator must read and understand the relevant Log and QA evidence. Arcadia must preserve a known-good stakeholder demo separately from the current candidate, show one exact next thing to inspect, and never promote an unverified candidate to stable. Arcadia QA independently verifies the candidate; release management proves the immutable candidate, performs the approved release, verifies it afterward, and records delivery."
updated: 2026-08-01
---

# Demo-first delivery contract

## Context

The Project Detail view has become a strong control-record surface, but it asks
the operator to infer the usable result from Milestones, Actions, validation,
and Logs. In the Private Practice Now example it can show two different next
actions at once: a stale failed-validation instruction in the Project summary
and the current operator Copy Studio trial in Continuation. Both facts may be
real, but the screen has failed if the operator must reconcile them before
knowing what to open.

The operator also clarified a non-delegable responsibility. It is reasonable
to begin with a hands-on demo, especially when time is scarce; it is not
reasonable to accept, merge, release, or deliver work without understanding
the relevant Log and proof. Arcadia should sequence those duties instead of
conflating them.

## Decision

Every software Action that changes observable behavior uses a demo-first
handoff. Arcadia presents the candidate, the known-good stable target, the
change summary, screenshots, source revision, validation and QA evidence, and
one primary action. The Log remains the durable audit trail below that surface.

The operator's required sequence is:

1. Exercise the candidate and judge whether the product is moving in the right
   direction.
2. Record feedback or indicate that the candidate is ready for QA.
3. Read and understand the relevant Log and QA evidence before accepting,
   merging, releasing, or delivering.
4. Make the explicit Decisions that authorize merge, external deployment, and
   client delivery.

An Action with no observable behavior may state `No runnable demo` only when it
also explains why and supplies the appropriate non-visual Artifact. A missing
demo for observable work is incomplete work, not a documentation inconvenience.

## Consequences

- The Project Detail page becomes a handoff surface first and a control-record
  explorer second.
- `Stable` and `Candidate` are roles of deployment/proof Artifacts, not two
  competing truth systems. Stable remains available while Candidate changes.
- A successful build is not QA, QA is not release approval, and release success
  is not client delivery. Each transition produces its own evidence.
- The coding agent cannot approve its own work. Arcadia QA runs independently
  against the exact candidate revision.
- External deployments, merges, credentials, spending, production data, and
  outbound client communication retain the Constitution's approval gates.
- The first implementation is a Private Practice Now vertical slice using
  manually configured targets and local Playwright proof. Automatic GitHub and
  Cloudflare discovery follows after the handoff UX proves useful.
