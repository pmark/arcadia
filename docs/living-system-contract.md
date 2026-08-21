# Living-system v1 contract

`docs/living-system.yaml` is a Project-owned declaration of durable meaning.
It names what the Project is made of and which subsets are useful to navigate.
It does not record current status, Action history, Runs, Artifacts, pull
requests, validation results, or projection freshness. Arcadia derives those
facts from their existing authoritative sources.

The parser is `parseLivingSystemManifest` in
`src/livingSystem/contract.ts`. It reads only the repository and makes no model
or network calls. `serializeLivingSystem` emits canonical JSON for stable
hashing and projection inputs.

## Manifest shape

```yaml
arcadia_living_system: v1
project: example-project
purpose: Explain the durable reason this Project's system exists.
topics:
  - id: capture-intent
    title: Capture intent
    why: Preserve what the person actually asked for.
    use_when: A new idea or request enters the Project.
    summary: Record raw intent before planning or implementation begins.
    sources:
      - src/capture.ts
    tags:                 # optional
      - operator-loop
relationships:
  - from: capture-intent
    to: clarify-action
    type: hands-off-to
    summary: Clarification consumes captured intent. # optional
views:
  - id: operator-loop
    title: Operator loop
    purpose: Follow intent into one safe next Action.
    selectors:
      - tag: operator-loop
    order: declaration
```

Pages, Models, Workflows, and Persistence may be Topic ids, tags, or View
concepts when a Project finds them useful. They are not reserved words or
required categories. Topic ids, tags, and Relationship types are Project-
defined kebab-case vocabulary; adding a new value requires no parser change.

## Topics and sources

Every Topic requires a stable kebab-case `id`, `title`, `why`, `use_when`, a
concise `summary`, and at least one `sources` entry. `tags` is optional and
normalizes to an empty list.

Sources are normalized, repository-relative POSIX paths to existing files or
directories. Absolute paths, `..` traversal, non-normal paths, missing targets,
and paths that resolve outside the repository through a symlink are rejected.
The normalized manifest sorts sources and tags byte-stably.

## Relationships

`relationships` is always a list; use `[]` when the Project has none. Every
Relationship requires `from`, `to`, and a Project-defined kebab-case `type`.
Both endpoints must be declared Topic ids. `summary` is optional. Duplicate
`from`/`type`/`to` triples are rejected.

## Views and selectors

Every View requires a stable kebab-case `id`, `title`, `purpose`, a non-empty
`selectors` list, and one deterministic `order`:

- `declaration` preserves the manifest's Topic order;
- `id` sorts by stable Topic id; and
- `title` sorts by title, then id.

Each selector is exactly one of:

```yaml
- all: true
- topic: capture-intent
- tag: operator-loop
```

`all` cannot be combined with another selector. Topic selectors must name an
existing Topic, tag selectors must match at least one Topic, and the combined
selectors must select something. Overlapping valid selectors are de-duplicated.
The normalized View includes the resolved, deterministically ordered
`topicIds`, so downstream projection never has to reinterpret selector rules.

## Validation and normalization

The v1 parser aggregates field-level errors and rejects:

- unsupported versions and a `project` slug that differs from the governed
  Project;
- missing required values, invalid ids, duplicate Topic or View ids, and
  duplicate Relationships;
- dangling Relationship endpoints and selector references;
- ambiguous, empty, or non-matching selectors;
- unsafe or missing source paths; and
- unknown fields, including attempts to copy operational status or history
  into the manifest.

Normalized Topics, Relationships, Views, sources, tags, and validation errors
have stable order. Canonical serialization recursively sorts object keys.
Unchanged inputs therefore produce byte-identical normalized data without a
model call.

## Derived target model

`src/livingSystem/types.ts` defines the shared projection target separately
from the manifest:

- `LivingSystemEpisode` is Action-centered history with its plan, milestone,
  dependencies, continuation, Decisions, Topic impacts, source receipts, and
  freshness receipt.
- `LivingSystemSignal` represents current pointers and evidence from Decisions,
  Runs, Artifacts, pull requests, Git, and validation.
- `LivingSystemSourceReceipt` records the authoritative kind, reference,
  observation time, content hash, and whether evidence is present, missing, or
  conflicting.
- `LivingSystemFreshnessReceipt` records whether evidence is current, stale,
  missing, or unknown and why.
- `LivingSystemImpactProvenance` labels Topic impact as `declared`, `observed`,
  `downstream`, or `unmapped`, with supporting source receipts and the optional
  one-hop Relationship.
- `LivingSystemUnlinkedHistory` preserves Log entries that carry no explicit
  Action reference.

These are normalized target types, not writable manifest fields. The next
derivation layer populates them from managed documents and operational records.

## Explicit Action links in the Log

A dated Log entry may name the governed Action it records:

```markdown
## 2026-08-21 — Defined the living-system contract

- **Action:** `living-system-v1#define-living-system-v1-contract`
- **Did:** Implemented the v1 parser and normalized types.
- **Result:** Both proof Projects validate with deterministic output.
```

The value must be `plan-slug#action-id`. Discovery validates that the plan
belongs to the same Project and that the Action exists in that plan. A bad link
rejects the Log rather than attaching history speculatively. The `Action:`
bullet is optional; when absent, the parsed entry keeps `action: null` so the
projection can show it as unlinked history instead of guessing.

## Proof fixtures

`tests/fixtures/living-system/arcadia/` uses Arcadia's capture-to-governed-build
vocabulary. `tests/fixtures/living-system/private-practice-now/` uses
practitioner-listening-to-trusted-launch vocabulary. Together they prove that
v1 is Project-extensible and that optional fields, selector modes, ordering,
and additive Relationship types do not depend on a fixed software taxonomy.
