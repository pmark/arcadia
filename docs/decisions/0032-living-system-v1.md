---
arcadia: v1
type: decision
id: "0032"
slug: living-system-v1
project: arcadia
status: approved
question: What must Arcadia's first living-system view contain so it becomes a trusted, frequently used way to understand both what a Project is and how it became that way?
answer: Build capability maps and Action-centered evolution timelines as equal, cross-linked projections over one deterministic model of Topics, Relationships, Views, Episodes, and Signals; keep routine creation and refresh free of model calls; and prove the v1 on both Arcadia and Private Practice Now.
recommendation: Activate a dedicated living-system-v1 plan that amends Decision 0031 by replacing its fixed Pages, Models, Workflows, and Persistence taxonomy with Project-defined Topics and Views, adding the Action timeline as a co-primary surface, and deferring local-AI enrichment until measured use shows that deterministic manifest maintenance is the limiting cost.
confidence: high
decided: 2026-08-21
updated: 2026-08-21
---

# Living system v1

The useful product is not a diagram of repository nouns. It is an immediately
legible, living explanation of a Project: what human problems it solves, what
capabilities make that possible, what is changing now, why earlier changes
happened, and what evidence supports every status claim.

Two views are therefore equal parts of v1:

- the **capability map** explains the system's present shape; and
- the **Action timeline** explains the causal path that produced it.

They share one projected model and cross-link in both directions. A Topic opens
its relevant Actions. An Action opens the Topics it affected. Home links
directly to the current Action and its affected Topics, so the operator does not
have to reconstruct the path from long documents.

## Shared model and authority

Each adopting repository owns `docs/living-system.yaml`. It declares durable
meaning, not operational state:

- **Topics** name capabilities, user journeys, responsibilities, boundaries, or
  other concepts that matter to that Project. They carry stable ids, a concise
  reason to care, when to use the Topic, a short summary, and repository source
  paths.
- **Relationships** connect Topics with Project-defined relationship types.
- **Views** select and order useful subsets of Topics for a particular audience
  or question. The default view is capability-first, but no universal category
  list is imposed.

Arcadia's existing managed and operational records remain authoritative for
change over time. The projector derives:

- **Episodes** from Milestones, Actions, Action-linked Mission Log entries, and
  their continuation links;
- **Signals** from current pointers, Decisions, Runs, Artifacts, pull requests,
  Git revisions, validation evidence, and projection freshness when those
  sources exist.

The manifest must not copy status or history that already has an authoritative
Arcadia source. Mission Log entries gain an optional explicit `Action` reference
of the form `plan-slug#action-id`. Unlinked history stays visible as unlinked; v1
never asks a model to guess where it belongs.

## The v1 experience

The generated Project home answers, at a glance: What is this Project for? What
is happening now? What changed recently? Where should I go next? From there:

- one click reaches any major capability;
- one click reaches the current Action and its directly affected Topics;
- every Topic links to its evolution history;
- every Action episode answers why it existed, what changed, what proof exists,
  which Decisions mattered, what Topics were affected, and what came next; and
- an Obsidian Canvas places the map and timeline side by side, while ordinary
  Markdown, WikiLinks, transclusions, and source links remain useful without a
  plugin.

Progressive disclosure serves four attention levels: glance at Home, orient in
a map or timeline, understand through a Topic or episode note, and audit through
the linked source and proof. Dense exhaustive diagrams are not a v1 success.

Action-to-Topic impact is deterministic and labelled by provenance. Explicit
Action references matching Topic sources are **declared**; changed files
matching those sources are **observed**; one-hop effects through declared Topic
relationships are **downstream**; and anything not supported by those rules is
**unmapped**, never silently inferred.

## Pareto scope and proof

The highest-impact v1 consists of:

1. a small validated repository manifest for Project meaning;
2. one normalized, zero-model projection model;
3. linked Home, capability-map, timeline, current-work, Topic, and episode notes
   plus one split-view Canvas;
4. preview-first synchronization with explicit apply and automatic non-blocking
   refresh after accepted Action transitions when vault sync is enabled; and
5. real dogfood on Arcadia and Private Practice Now.

Arcadia must make its own capture-to-delivery loop understandable. Private
Practice Now must make the practitioner-interview-to-launched-site journey
understandable and expose missing or weak links rather than hiding them. V1 is
accepted only if a fresh reader can understand purpose and current focus in
about ten seconds, reach a major capability in one click, traverse map to
timeline and back, understand the primary journey in about two minutes, and
audit status provenance and freshness.

Routine create and update operations make zero model calls and require no paid
Arcadia service. Generated Markdown and JSON Canvas remain usable even when the
Markmap viewer is absent.

## Explicit deferrals

V1 does not include a custom Obsidian plugin, animated highlighting, semantic
inference, AI reconstruction of old history, a real-time filesystem watcher,
full historical snapshots, exhaustive repository coverage, automatic
multi-hop impact analysis, collaborative editing, or a universal ontology.

- Add an explicit Action `affects` field only if Arcadia and Private Practice
  Now dogfood shows that reference and changed-file matching misses important
  impact.
- Add richer filters or highlighting only after repeated real navigation shows
  which filters are needed.
- Add historical snapshot playback only when an operator needs to reconstruct
  a prior system state that the Action timeline cannot explain.
- Add local-AI suggestions only after measured use shows that manifest upkeep
  is a recurring burden; suggestions must remain optional, labelled, and unable
  to rewrite truth automatically.
- Build a custom visual UI or plugin only if ordinary Obsidian Markdown,
  Markmap, WikiLinks, transclusion, and Canvas repeatedly limit the workflow.

This Decision preserves Decision 0031's Project-owned manifest, deterministic
projection, vault isolation, preview/apply safety, and pointer-restoration
sequence. It supersedes 0031 only where that Decision prescribed four fixed
software categories or put local-AI enrichment inside v1.
