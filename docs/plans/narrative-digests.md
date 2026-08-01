---
arcadia: v1
type: plan
slug: narrative-digests
project: arcadia
status: active
milestone: Arcadia narrates its own recent history automatically, for itself and every Project it manages
current_action: export-digest-to-obsidian
token_impact: large
token_budget: "Composition uses one bounded local-preferred narration per Project and period; gathering, deduplication, export, scheduling, and empty-window handling are deterministic."
updated: 2026-08-01
actions:
  - id: compose-project-digest
    title: Compose one Project's narrative digest for a window, narrated by local AI
    status: done
    responsibility: codex
    effort: session
    next_action: Delivered as the explicit-window digest composer and `arcadia digest compose`; no further work.
    expected_artifact: A composer producing one narrative_digest Artifact per (Project, window), idempotent on re-run
    clarification: clarified
    confidence: high
    source: Decision 0006
    acceptance_criteria:
      - Given a Project and a window (day/week/month), the composer gathers that Project's mission_logs, dispatch_events, and Decision activity strictly within the window -- nothing before it, nothing after.
      - The gathered facts are handed to a local-preferred Intelligence job whose prompt instructs it to narrate, not invent: every claim in the output must trace to a gathered fact, and the job must not fabricate outcomes the data does not support.
      - The result is stored as a narrative_digest Artifact scoped to that Project and window, and is never written back into the Project's own repository.
      - Re-running for a (Project, window) that already has a stored digest updates it in place, keyed on the pair, rather than creating a duplicate.
      - A window with no activity at all produces an honest "nothing happened" digest, not a fabricated one.
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: project
        required:
          - Read access to mission_logs, dispatch_events, and review_items for one Project
          - The local-preferred Intelligence job queue
          - Artifact persistence
        staging: forbidden
      phases:
        planning:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    decisions: ["0006"]
    references:
      - src/digests/composer.ts
      - src/digests/contract.ts
      - src/commands/digest.ts
      - tests/narrative-digest.test.ts
    depends_on: []
  - id: export-digest-to-obsidian
    title: Export a composed digest into the Obsidian vault
    status: open
    responsibility: codex
    effort: short
    next_action: Extend the Obsidian export with a second record shape alongside the existing deterministic progress review -- an AI-narrated one, clearly marked as such -- reusing exportProgressReview's atomic-write and content-hash-dedup machinery.
    expected_artifact: A vault Record for each composed digest, written the same safe way progress reviews already are
    clarification: clarified
    confidence: high
    source: Decision 0006
    acceptance_criteria:
      - A composed digest exports into the vault using the same atomic-write, content-hash, ownership-checked pattern exportProgressReview already uses.
      - Re-exporting an unchanged digest writes nothing, verified by content hash.
      - The vault record is clearly marked as AI-narrated, distinguishing it from the deterministic progress review record type already in place.
    decisions: ["0006"]
    references:
      - src/memory/obsidian.ts
    depends_on: [compose-project-digest]
  - id: schedule-portfolio-digests
    title: Schedule daily, weekly, and monthly digests across every active Project
    status: open
    responsibility: codex
    effort: session
    next_action: Extend the Discord bot's existing orientation scheduler with digest cadences that iterate every active Project, idempotent per Project and period, composing, storing, exporting, and posting each one.
    expected_artifact: The Discord bot automatically produces and delivers every active Project's due digests, unattended
    clarification: clarified
    confidence: medium
    source: Decision 0006
    acceptance_criteria:
      - Each cadence (daily, weekly, monthly) fires at most once per Project per period, using the same missed-tick self-catch-up pattern the orientation scheduler already uses.
      - A digest is composed, stored, exported, and posted for every active Project on each due cadence -- not only Arcadia's own.
      - A failure composing or delivering one Project's digest is logged and does not block any other Project's, or any other cadence's.
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: cross_system
        required:
          - Discord bot process and its existing scheduler
          - Every mechanism compose-project-digest and export-digest-to-obsidian deliver
        staging: forbidden
      phases:
        planning:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    decisions: ["0006"]
    references:
      - apps/discord-bot/src/orientation/scheduler.ts
    depends_on: [compose-project-digest, export-digest-to-obsidian]
questions:
  - id: portfolio-rollup
    question: Should there also be a single cross-project "state of the portfolio" digest, distinct from each Project's own -- and if so, on what cadence?
    gap_type: missing-definition
  - id: digest-window-boundaries
    question: Should "weekly" and "monthly" windows align to calendar weeks/months, or roll on a fixed N-day/N-week lookback from the moment they fire?
    gap_type: missing-definition
decisions: ["0006"]
---

# Narrative Digests

## Why this plan exists

Every other capability shipped this session made Arcadia's own history more
structured: mission-Log entries became rows, the dispatch journal became
queryable, acceptance criteria became checked facts instead of trusted
claims. None of it was readable as a story until one was written by hand.
This plan is that hand-written pass, turned into a standing capability: the
same story, for every Project, on a schedule, without being asked.

## What "digest" means here

A `narrative_digest` Artifact, scoped to exactly one Project and one window
(day, week, or month), composed from that Project's own `mission_logs`,
`dispatch_events`, and Decision activity strictly inside that window, and
narrated into prose by a local-preferred Intelligence job instructed to
report what the data says, never to invent what it doesn't.

It is not a substitute for `MISSION_LOG.md`, which stays the operator- and
agent-authored record of intent and result. A digest is read-only derived
output, the same posture `docs sync` already holds toward every managed
document: informed by the Project, never written back into it.

## Relationship to already-designed work

`narrative-summarization`, deferred in `portfolio-docs-protocol` under
Decision 0004, is adjacent but distinct: it summarizes static narrative
documents (`architecture.md` and similar), not activity history, and its own
trigger ("a second foreign repository, or a summary genuinely wanted") is not
treated as satisfied by this plan. Both stay separately scoped.

`prepare_weekly_update_draft` (`src/execution/skills.ts`,
`src/markdown/weeklyReview.ts`) already gathers a deterministic weekly window
of facts for one work item, on request rather than on a schedule. Its
gathering logic is a candidate the digest composer can read from rather than
reimplement, though the digest's own scope (day/week/month, portfolio-wide,
AI-narrated) is broader than what it was built for.

`exportProgressReview` (`src/memory/obsidian.ts`) already writes a
deterministic, non-Decision record into the Obsidian vault with atomic
writes and content-hash dedup. The digest export reuses that machinery rather
than inventing a second way to write safely into the vault.

The Discord bot's orientation scheduler
(`apps/discord-bot/src/orientation/scheduler.ts`) already solves "check on an
interval whether something is due, compose it idempotently per local period,
self-catch-up after a missed tick, deliver it" for one packet across the
whole workspace. Digest scheduling extends the same mechanism to iterate
every active Project instead of composing once.

## Ordering

`compose-project-digest` first: it is the one piece genuinely worth building
in isolation, since it answers the real open risk (can local AI narrate
Arcadia's own structured history honestly, without inventing outcomes the
data doesn't support) before anything is wired to a schedule or a delivery
surface. `export-digest-to-obsidian` next, since it is small and has nothing
to export until the composer exists. `schedule-portfolio-digests` last,
because scheduling something that cannot yet compose or export correctly
would just automate reproducing the same mistake three times a day across
every Project.

## What this plan deliberately does not do

- **No portfolio-wide roll-up digest, yet.** Each digest is scoped to one
  Project. Whether a single cross-project story should also exist is the
  `portfolio-rollup` open question, not assumed.
- **No write-back into a managed Project's own repository.** A digest is
  Arcadia's own derived record of a Project, not a document sync produces or
  consumes -- the same one-way posture the rest of the protocol holds.
- **No judgment layer beyond narration.** The Intelligence job reports what
  happened; it does not grade whether the Project is going well, rank
  Projects against each other, or recommend what to do next. That would be
  a different, unrequested capability wearing this one's clothes.
