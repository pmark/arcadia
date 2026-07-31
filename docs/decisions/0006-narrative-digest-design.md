---
arcadia: v1
type: decision
id: "0006"
slug: narrative-digest-design
project: arcadia
plan: narrative-digests
status: approved
question: "How should Arcadia's automatic narrative digests be composed, delivered, and scheduled?"
gap_type: missing-decision
recommendation: Local AI narration (matching narrative-summarization's own local-preferred design), stored as an Artifact and exported to Obsidian and posted to Discord, scheduled by extending the Discord bot's existing orientation scheduler.
confidence: high
decided: 2026-07-31
answer: "Local AI narrative composition, queued through the existing local-preferred Intelligence job queue. Delivered to all three surfaces: stored as a narrative_digest Artifact, exported to the Obsidian vault, and posted to Discord. Scheduled by extending the Discord bot's existing orientation scheduler (interval tick, idempotent per period) rather than a new standalone daemon."
updated: 2026-07-31
---

# Narrative digest design

## Context

After the fourth `dispatch-contract-enforcement` PR merged, the operator asked
for a narrative account of the session -- a story, not a diff list. One was
written by hand as a proof of concept. The operator then asked for this same
thing automatically, for Arcadia's own project and for every Project Arcadia
manages, not as a one-off.

Three genuine design forks existed and none were the operator's to infer
silently:

## Options considered

**Composition: deterministic template vs. local AI narration vs. hybrid.**
The daily orientation packet is proof a deterministic composer can produce a
readable packet with no model call at all, and it is the pattern this
protocol prefers by default ("no judge agent for what a script can check").
But a *story* is a different kind of artifact than a planning packet: turning
"3 review_items closed, 2 decisions approved" into prose that reads the way
the hand-written one did is a generative-writing task, not a judgment call a
script can make deterministically. Local AI narration was selected, matching
the reasoning `narrative-summarization` (deferred under Decision 0004)
already used: local-preferred, and the model narrates facts it is handed
rather than inventing them.

**Delivery: Artifact only vs. Discord vs. both vs. Obsidian too.** The
operator chose all three. This is the highest-friction answer to build but
the most honest to the actual ask -- "for myself as a project and all the
projects it manages" implies wanting to encounter this without going looking
for it, which argues for a push surface (Discord) alongside the pull surfaces
(Artifact, Obsidian) that already exist for other Arcadia output.

**Scheduling: extend the Discord bot's existing scheduler vs. a new
standalone daemon.** The orientation scheduler already solves exactly this
problem -- an interval tick, idempotent per local period, self-catches-up
after a missed tick -- for one packet across the whole workspace. Extending
it to also fire per-Project digest cadences was chosen over standing up new
infrastructure that would duplicate that exact machinery.

## Consequences

- A new Artifact type, `narrative_digest`, scoped to one Project and one
  window (day/week/month). Never written back into that Project's own
  repository -- the same one-way posture `docs sync` already holds.
- The Obsidian export gains a second record shape alongside the existing
  deterministic progress review: an AI-narrated one, clearly marked as such,
  reusing `exportProgressReview`'s atomic-write and content-hash-dedup
  machinery rather than a parallel implementation.
- The Discord bot's scheduler gains digest cadences that iterate every active
  Project, not just Arcadia's own -- one Project's composition or delivery
  failure must not block any other Project's.
- This is adjacent to, but does not replace, the deferred
  `narrative-summarization` Action in `portfolio-docs-protocol`, which is
  specifically about summarizing static narrative documents (`architecture.md`
  and similar), not activity history. Both stay separately scoped rather than
  merged, so neither's acceptance criteria get diluted by the other's.
- Whether a single cross-project "state of the portfolio" digest should also
  exist, distinct from each Project's own, is not decided here -- see the
  `narrative-digests` plan's open question.
