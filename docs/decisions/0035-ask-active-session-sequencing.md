---
arcadia: v1
type: decision
id: "0035"
slug: ask-active-session-sequencing
project: arcadia
status: approved
question: When should Arcadia activate the Ask active-session plan relative to the living-system v1 review and the promised return to idea-to-managed-build?
gap_type: missing-decision
recommendation: Resolve the current living-system v1 operator review, then activate arcadia-ask-active-sessions before restoring idea-to-managed-build/promote-accepted-plan; this explicitly amends Decision 0032's pointer-restoration sequence because repeated capture, routing, attachment, and intent-calibration friction is now blocking real Living Songbook use.
confidence: high
answer: Resolve the living-system v1 review, then activate arcadia-ask-active-sessions before restoring idea-to-managed-build/promote-accepted-plan.
decided: 2026-08-30
plan: arcadia-ask-active-sessions
updated: 2026-08-30
---

# Decision 0035: Ask Active Session Sequencing

## Context

Arcadia's current Action is the operator-only perceptual review of living-system
v1. Decision 0032 says acceptance restores the pointer to
`idea-to-managed-build/promote-accepted-plan`.

Since that Decision, real Ask use exposed a more immediate core-product gap:
text and attachments take different paths, external links are not presented as
sources with provenance, unknown but meaningful captures fall into Back Burner,
an explicit `--project Arcadia` route lost to a Project name mentioned inside
the payload, special handling is invisible, and the rules driving deterministic
intent extraction are not safely manageable from the product.

Living Songbook turns those failures into one coherent dogfood story. The
operator wants `songbook` as a memorable prefix and prefers the guided
understanding session: durable acknowledgment, visible processing, editable
interpretation, proposed destinations and triggers, and conversation as the
correction channel.

The plan is written at `docs/plans/arcadia-ask-active-sessions.md`. The remaining
question is sequencing, not scope.

## Options

1. **Recommended — after living-system review, before pointer restoration.**
   Resolve the current operator-only Action, activate Ask active sessions, prove
   it with Living Songbook, then return to `idea-to-managed-build`. This is the
   earliest clean trigger and explicitly amends Decision 0032.
2. **Keep the existing restoration sequence.** Finish
   `idea-to-managed-build/promote-accepted-plan` first, then activate this plan.
   This preserves Decision 0032 unchanged but delays a front-door failure that
   now affects real use.
3. **Interrupt the current review now.** Not recommended. The review is short,
   operator-only, and already the final acceptance gate; replacing it would
   strand completed living-system work for no implementation advantage.

## Recommendation

Choose option 1. It honors the current review, names an observable activation
condition, and treats repeated capture friction as core product work rather than
another indefinitely incubating idea.

## Resolution

Approved on 2026-08-30. The current living-system review is already resolved;
the Project pointer therefore activates `arcadia-ask-active-sessions` now. This
changes sequencing only: it does not accept a future Ask Artifact, approve a
Run, modify Living Songbook, merge, deploy, publish, use credentials, spend, or
send messages.
